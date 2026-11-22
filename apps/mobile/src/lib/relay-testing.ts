// A fake Zomfy Relay with the host behind it, for the app's relay tests: the Hub's phone socket
// (challenge, device key, presence, splicing) and the host's side of the end-to-end channel
// (packages/protocol/src/phone-e2ee.ts), serving JSON-RPC with a FakeGateway's handlers.

import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import {
  answerPhoneHello,
  decodeBase64,
  encodeBase64,
  fromBase64Url,
  phoneDeviceProofMessage,
  toBase64Url,
  type PairRequest,
  type PhoneChannelOpen,
  type PhoneE2EEChannel
} from '@zomfy/protocol'
import type { FetchLike, SocketLike } from './gateway-client'
import { deviceSigningText, RELAY_CLOSE, relayDeviceId } from './relay-client'
import type { FakeGateway } from './testing'

export class FakeRelay {
  readonly sockets: FakeRelaySocket[] = []
  /** Device keys the host registered, by relay id. */
  readonly devices = new Map<string, Uint8Array>()
  /** Every `data` a phone sent, as the relay saw it. */
  readonly seen: string[] = []
  reachable = true
  hostOnline = true
  readonly hostSecret = crypto.getRandomValues(new Uint8Array(32))
  readonly hostBoxPublicKey = toBase64Url(x25519.getPublicKey(this.hostSecret))

  constructor(
    readonly url: string,
    readonly relayHostId: string,
    readonly gateway: FakeGateway
  ) {}

  /** The host registers a device it paired directly. */
  register(deviceId: string): void {
    const device = this.gateway.devices.get(deviceId)
    if (device) this.devices.set(relayDeviceId(deviceId), device.publicKey)
  }

  fetch: FetchLike = async (url) => {
    if (!this.reachable || !url.startsWith(this.url)) throw new Error('unreachable')
    if (url === `${this.url}/health`) return { ok: true, status: 200, json: async () => ({ ok: true }) }
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) }
  }

  createSocket = (url: string): SocketLike => {
    const socket = new FakeRelaySocket(this, url, this.reachable && url.startsWith(this.url.replace(/^http/, 'ws')))
    this.sockets.push(socket)
    return socket
  }

  get openSocket(): FakeRelaySocket | undefined {
    return this.sockets.find((s) => s.readyState === 1 && s.relayId !== null)
  }

  setHostOnline(online: boolean): void {
    this.hostOnline = online
    for (const socket of this.sockets) {
      if (socket.readyState !== 1 || !socket.relayId) continue
      socket.channel = null
      socket.state = 'hello'
      socket.deliver({ type: online ? 'host-online' : 'host-offline' })
    }
  }

  /** The relay goes away: every socket drops as on a lost network. */
  drop(): void {
    for (const socket of this.sockets) socket.close(1006, '')
  }
}

export class FakeRelaySocket implements SocketLike {
  readyState = 0
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  relayId: string | null = null
  pairing = false
  state: 'hello' | 'proof' | 'open' = 'hello'
  channel: PhoneE2EEChannel | null = null
  private readonly nonce = encodeBase64(crypto.getRandomValues(new Uint8Array(16)))

  constructor(
    private readonly relay: FakeRelay,
    readonly url: string,
    live: boolean
  ) {
    queueMicrotask(() => {
      if (!live) {
        this.readyState = 3
        this.onclose?.({ code: 1006, reason: '' })
        return
      }
      this.readyState = 1
      this.onopen?.({})
      this.deliver({ type: 'challenge', nonce: this.nonce })
    })
  }

  deliver(message: unknown): void {
    if (this.readyState !== 1) return
    const data = JSON.stringify(message)
    queueMicrotask(() => this.onmessage?.({ data }))
  }

  /** Sends a sealed message from the host. */
  sendFromHost(text: string): void {
    if (this.channel) this.deliver({ type: 'frame', data: this.channel.seal(text) })
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket not open')
    const frame = JSON.parse(data) as { type: string; deviceId?: string; signature?: string; publicKey?: string; data?: string }
    if (!this.relayId) {
      if (frame.type !== 'auth' && frame.type !== 'pair') return this.close(RELAY_CLOSE.unauthorized)
      const key = frame.type === 'auth' ? this.relay.devices.get(frame.deviceId!) : decodeBase64(frame.publicKey!)
      const signed = new TextEncoder().encode(deviceSigningText(frame.deviceId!, this.nonce))
      if (!key || !ed25519.verify(decodeBase64(frame.signature!), signed, key)) return this.close(RELAY_CLOSE.unauthorized)
      this.relayId = frame.deviceId!
      this.pairing = frame.type === 'pair'
      this.deliver({ type: 'auth-ok', deviceId: this.relayId })
      this.deliver({ type: this.relay.hostOnline ? 'host-online' : 'host-offline' })
      return
    }
    if (frame.type !== 'frame' || typeof frame.data !== 'string') return
    this.relay.seen.push(frame.data)
    if (!this.relay.hostOnline) return
    this.toHost(frame.data)
  }

  /** The host's side of the channel. */
  toHost(data: string): void {
    const gateway = this.relay.gateway
    if (this.state === 'hello') {
      const answer = answerPhoneHello(JSON.parse(new TextDecoder().decode(decodeBase64(data))), {
        hostSecretKey: toBase64Url(this.relay.hostSecret),
        transport: 'relay',
        relayHostId: this.relay.relayHostId,
        random: (n) => crypto.getRandomValues(new Uint8Array(n))
      })
      if (!answer) return this.close(RELAY_CLOSE.channelBroken)
      this.channel = answer.channel
      this.state = 'proof'
      this.deliver({ type: 'frame', data: encodeBase64(new TextEncoder().encode(JSON.stringify(answer.ready))) })
      return
    }
    const text = this.channel?.open(data) ?? null
    if (text === null) return this.close(RELAY_CLOSE.channelBroken, 'replayed frame')
    if (this.state === 'proof') {
      const open = JSON.parse(text) as PhoneChannelOpen
      const hash = this.channel!.transcriptHash
      if (open.type === 'auth') {
        const device = gateway.devices.get(open.deviceId)
        const ok = device && relayDeviceId(open.deviceId) === this.relayId && ed25519.verify(fromBase64Url(open.proof), phoneDeviceProofMessage('auth', hash), device.publicKey)
        if (!ok) return this.sendFromHost(JSON.stringify({ type: 'refused', code: RELAY_CLOSE.unauthorized, message: 'This phone is not paired with this host' }))
        this.state = 'open'
        this.sendFromHost(JSON.stringify({ type: 'ready', scopes: device.scopes }))
        return
      }
      const request = open.request as PairRequest
      if (!this.pairing || !gateway.grants.delete(request.grant) || !ed25519.verify(fromBase64Url(open.proof), phoneDeviceProofMessage('pair', hash), fromBase64Url(request.publicKey))) {
        return this.sendFromHost(JSON.stringify({ type: 'refused', code: RELAY_CLOSE.unauthorized, message: 'Pairing failed' }))
      }
      const deviceId = this.relayId!.slice(2)
      gateway.devices.set(deviceId, { publicKey: fromBase64Url(request.publicKey), scopes: gateway.scopes })
      this.relay.register(deviceId)
      this.sendFromHost(JSON.stringify({ type: 'paired', response: { deviceId, hostId: gateway.hostId, hostName: gateway.hostName, scopes: gateway.scopes } }))
      return
    }
    const message = JSON.parse(text) as { id?: number; method?: string; params?: unknown }
    if (typeof message.method !== 'string') return
    gateway.received.push({ method: message.method, params: message.params, ...(message.id !== undefined ? { id: message.id } : {}) })
    if (message.id === undefined) return
    const handler = gateway.handlers.get(message.method)
    Promise.resolve()
      .then(() => (handler ? handler(message.params, gateway) : Promise.reject(new Error('Method not found'))))
      .then(
        (result) => this.sendFromHost(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: result ?? null })),
        (error: Error) => this.sendFromHost(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }))
      )
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return
    this.readyState = 3
    queueMicrotask(() => this.onclose?.({ code, reason }))
  }
}
