import { describe, expect, test } from 'bun:test'
import { x25519 } from '@noble/curves/ed25519.js'
import {
  answerPhoneHello,
  createPhoneHandshake,
  encodePairingOffer,
  encodeBase64,
  toBase64Url,
  type HarnessState,
  type RemoteRoute
} from '@zomfy/protocol'
import { AskStore } from './asks'
import type { FetchLike, SocketLike } from './gateway-client'
import { HostConnection } from './host-connection'
import { pairFromOffer } from './host-registry'
import { readOffer } from './pairing'
import { relayDeviceId, RelaySession } from './relay-client'
import { FakeRelay } from './relay-testing'
import { FakeGateway, FakeTimers, flush, testRandomBytes } from './testing'

// The app's relay route (docs/specs/mobile/app.md#connection, relay.md): the end-to-end channel,
// LAN → tailnet → relay with fall-back and return, presence without reconnecting, and wakeups.

const LAN = 'http://192.168.1.20:7802'
const RELAY = 'https://relay.example.com'
const RELAY_HOST = 'h_relayhost01'
const random = testRandomBytes

const harness: HarnessState = { host: { id: 'local', label: 'Desk', platform: 'win32' }, projects: [], workspaces: [], floatingWorkspaceId: 'float' }

describe('end-to-end channel', () => {
  const hostSecret = random(32)
  const hostPublic = toBase64Url(x25519.getPublicKey(hostSecret))
  const open = () => {
    const phone = createPhoneHandshake({ hostPublicKey: hostPublic, transport: 'relay', relayHostId: RELAY_HOST, random })
    const host = answerPhoneHello(JSON.parse(JSON.stringify(phone.hello)), { hostSecretKey: toBase64Url(hostSecret), transport: 'relay', relayHostId: RELAY_HOST, random })!
    const channel = phone.accept(JSON.parse(JSON.stringify(host.ready)))!
    return { phone: channel, host: host.channel, hello: phone.hello, ready: host.ready }
  }

  test('both sides derive the same keys and transcript, and frames are ciphertext', () => {
    const { phone, host } = open()
    expect(encodeBase64(phone.transcriptHash)).toBe(encodeBase64(host.transcriptHash))
    const frame = phone.seal('{"marker":"plain-text-5d2"}')
    expect(atob(frame)).not.toContain('plain-text-5d2')
    expect(host.open(frame)).toBe('{"marker":"plain-text-5d2"}')
    expect(phone.open(host.seal('back'))).toBe('back')
  })

  test('a replayed, reordered or tampered frame breaks the channel for good', () => {
    const replay = open()
    const first = replay.phone.seal('one')
    expect(replay.host.open(first)).toBe('one')
    expect(replay.host.open(first)).toBeNull()
    expect(replay.host.broken).toBe(true)
    expect(replay.host.open(replay.phone.seal('two'))).toBeNull()

    const reorder = open()
    const a = reorder.phone.seal('a')
    const b = reorder.phone.seal('b')
    expect(reorder.host.open(b)).toBeNull()
    expect(reorder.host.open(a)).toBeNull()

    const tamper = open()
    const bytes = Uint8Array.from(atob(tamper.phone.seal('hello')), (c) => c.charCodeAt(0))
    bytes[bytes.length - 1]! ^= 1
    expect(tamper.host.open(encodeBase64(bytes))).toBeNull()

    // A frame for the other direction does not open either.
    const mirror = open()
    expect(mirror.phone.open(mirror.phone.seal('mine'))).toBeNull()
  })

  test('a host without the pinned key, or another relay host, gets no channel', () => {
    const phone = createPhoneHandshake({ hostPublicKey: hostPublic, transport: 'relay', relayHostId: RELAY_HOST, random })
    const impostor = answerPhoneHello(JSON.parse(JSON.stringify(phone.hello)), { hostSecretKey: toBase64Url(random(32)), transport: 'relay', relayHostId: RELAY_HOST, random })!
    expect(phone.accept(impostor.ready)).toBeNull()
    expect(answerPhoneHello(phone.hello, { hostSecretKey: toBase64Url(hostSecret), transport: 'relay', relayHostId: 'h_otherhost01', random })).toBeNull()
    const { ready } = open()
    expect(phone.accept({ ...ready, clientNonce: phone.hello.clientNonce, extra: 1 })).toBeNull()
  })
})

async function relaySetup(options: { lanLive?: boolean } = {}) {
  const gateway = new FakeGateway('host-1', 'Desk')
  if (options.lanLive !== false) gateway.live.add(LAN)
  gateway.grants.add('grant-1')
  gateway.handlers.set('initialize', () => ({ protocolVersion: 1, agentCapabilities: {} }))
  gateway.handlers.set('_harness/state/get', () => harness)
  gateway.handlers.set('_harness/sessions/list', () => [])
  const relay = new FakeRelay(RELAY, RELAY_HOST, gateway)
  const fetch: FetchLike = (url, init) => (url.startsWith(RELAY) ? relay.fetch(url, init) : gateway.fetch(url, init))
  const createSocket = (url: string): SocketLike => (url.startsWith(RELAY.replace(/^http/, 'ws')) ? relay.createSocket(url) : gateway.createSocket(url))
  const routes: RemoteRoute[] = [{ kind: 'lan', url: LAN }, { kind: 'relay', url: RELAY, relayHostId: RELAY_HOST }]
  const link = encodePairingOffer({
    v: 1,
    hostId: 'host-1',
    hostName: 'Desk',
    routes,
    relayUrl: RELAY,
    hostBoxPublicKey: relay.hostBoxPublicKey,
    grant: 'grant-1',
    expiresAt: Date.now() + 600_000,
    scopes: ['chats:read', 'chats:operate']
  })
  return { gateway, relay, fetch, createSocket, offer: readOffer(link) }
}

describe('pairing through the relay', () => {
  test('with no direct route answering, the grant goes inside the channel, unseen by the relay', async () => {
    const s = await relaySetup({ lanLive: false })
    const host = await pairFromOffer({ offer: s.offer, name: 'Pixel', model: null, fetch: s.fetch, randomBytes: random, createSocket: s.createSocket })
    expect(host.hostId).toBe('host-1')
    expect(host.hostBoxPublicKey).toBe(s.relay.hostBoxPublicKey)
    expect(s.relay.devices.has(relayDeviceId(host.deviceId))).toBe(true)
    expect(s.relay.seen.join('')).not.toContain(btoa('grant-1').slice(0, 6))
    expect(s.relay.seen.some((d) => atob(d).includes('grant-1'))).toBe(false)
  })
})

async function connected(s: Awaited<ReturnType<typeof relaySetup>>, lanAtPairing = true) {
  if (!lanAtPairing) s.gateway.live.delete(LAN)
  const host = await pairFromOffer({ offer: s.offer, name: 'Pixel', model: null, fetch: s.fetch, randomBytes: random, createSocket: s.createSocket })
  s.relay.register(host.deviceId)
  const timers = new FakeTimers()
  const connection = new HostConnection(host, { fetch: s.fetch, createSocket: s.createSocket, asks: new AskStore(), clientVersion: 'test', timers, random: () => 0, randomBytes: random, relayOpenTimeoutMs: 5000 })
  return { host, timers, connection }
}

describe('relay route', () => {
  test('falls back to the relay when the LAN is gone, and returns to the LAN when it answers again', async () => {
    const s = await relaySetup()
    const { connection, timers } = await connected(s)
    s.gateway.live.delete(LAN)
    connection.start()
    await flush(40)
    expect(connection.state.get()).toMatchObject({ status: 'connected', route: { kind: 'relay' } })
    expect(await connection.request('_harness/sessions/list')).toEqual([])
    expect(s.relay.seen.length).toBeGreaterThan(2)

    s.gateway.live.add(LAN)
    await timers.advance(10 * 60_000)
    await flush(40)
    expect(connection.state.get()).toMatchObject({ status: 'connected', route: { kind: 'lan' } })
    // Off the relay: its socket is closed.
    expect(s.relay.openSocket).toBeUndefined()
    connection.stop()
  })

  test('host-offline ends the channel but not the socket; host-online connects again on it', async () => {
    const s = await relaySetup()
    const { connection } = await connected(s, false)
    connection.start()
    await flush(40)
    expect(connection.state.get().status).toBe('connected')
    const sockets = s.relay.sockets.length
    s.relay.setHostOnline(false)
    await flush(20)
    expect(connection.state.get().status).toBe('offline')
    s.relay.setHostOnline(true)
    await flush(60)
    expect(connection.state.get()).toMatchObject({ status: 'connected', route: { kind: 'relay' } })
    // No new socket: the same one carried the new channel.
    expect(s.relay.sockets.length).toBe(sockets)
    expect(await connection.request('_harness/sessions/list')).toEqual([])
    connection.stop()
  })

  test('a channel the relay breaks (4400) reconnects; a revoke (4403) unpairs', async () => {
    const s = await relaySetup()
    const { connection, timers } = await connected(s, false)
    connection.start()
    await flush(40)
    s.relay.openSocket!.close(4400, 'replayed frame')
    await flush(20)
    expect(connection.state.get().status).toBe('offline')
    await timers.advance(2000)
    await flush(60)
    expect(connection.state.get().status).toBe('connected')
    s.relay.openSocket!.close(4403, 'revoked')
    await flush(20)
    expect(connection.state.get().status).toBe('unpaired')
  })

  test('the relay forgetting the phone (4401) is a failed route, not an unpairing', async () => {
    const s = await relaySetup()
    const { connection, host } = await connected(s, false)
    s.relay.devices.delete(relayDeviceId(host.deviceId))
    connection.start()
    await flush(40)
    expect(connection.state.get().status).toBe('offline')
    connection.stop()
  })

  test('a network change checks the route in use and drops a dead one at once', async () => {
    const s = await relaySetup()
    const { connection } = await connected(s, false)
    connection.start()
    await flush(40)
    expect(connection.state.get().status).toBe('connected')
    // The phone left the network: the socket still looks open, but the relay no longer answers.
    s.relay.reachable = false
    connection.wake('network')
    await flush(40)
    expect(connection.state.get().status).toBe('offline')
    // Back on a network: retried at once, without waiting out the backoff.
    s.relay.reachable = true
    connection.wake('network')
    await flush(80)
    expect(connection.state.get().status).toBe('connected')
    connection.stop()
  })

  test('a relay session waits for an offline host within its timeout', async () => {
    const s = await relaySetup()
    const host = await pairFromOffer({ offer: s.offer, name: 'Pixel', model: null, fetch: s.fetch, randomBytes: random, createSocket: s.createSocket })
    s.relay.register(host.deviceId)
    s.relay.hostOnline = false
    const session = new RelaySession({
      createSocket: s.createSocket,
      identity: { relayUrl: RELAY, relayHostId: RELAY_HOST, hostBoxPublicKey: s.relay.hostBoxPublicKey, relayDeviceId: relayDeviceId(host.deviceId), secretKey: host.keys.secretKey },
      deviceId: host.deviceId,
      random
    })
    const opening = session.open(2000)
    await flush(20)
    s.relay.setHostOnline(true)
    const socket = await opening
    expect(socket.scopes).toEqual(['chats:read', 'chats:operate'])
    session.close()
  })
})
