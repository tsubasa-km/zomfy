// The phone relay (docs/specs/mobile/relay.md#acceptance): device keys registered through the host,
// frames spliced unchanged, presence, close codes and limits, and no payload in storage or logs.

import { runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceSigningText, limits } from '../src/contract'
import type { Hub } from '../src/hub'
import { BASE, connect, hubStub, type HostKey, Link, mintInvite, newHostKey, post, registerHost } from './helpers'

const links: Link[] = []
const track = (link: Link) => {
  links.push(link)
  return link
}

afterEach(async () => {
  for (const link of links.splice(0)) link.close()
  await runInDurableObject(hubStub(), async (_hub: Hub, state) => {
    const sql = state.storage.sql
    for (const { name } of sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").toArray()) {
      sql.exec(`DELETE FROM "${name}"`)
    }
  })
})

async function openPhoneSocket(hostId: string): Promise<Link> {
  const res = await SELF.fetch(`${BASE}/v1/device/${encodeURIComponent(hostId)}/ws`, { headers: { Upgrade: 'websocket' } })
  if (!res.webSocket) throw new Error(`no websocket: ${res.status}`)
  return track(new Link(res.webSocket))
}

/** A phone that proves `key` as `deviceId` (or pairs with it); returns after auth-ok. */
async function phone(hostId: string, deviceId: string, key: HostKey, pair = false): Promise<Link> {
  const ws = await openPhoneSocket(hostId)
  const challenge = await ws.type('challenge')
  const signature = await key.sign(deviceSigningText(deviceId, challenge.nonce))
  ws.send(pair ? { type: 'pair', deviceId, publicKey: key.publicKey, signature } : { type: 'auth', deviceId, signature })
  await ws.type('auth-ok')
  return ws
}

/** A host with its link up and one device registered through it. */
async function hostWithDevice(deviceId = 'd_phone0001') {
  const { hostId, key } = await registerHost()
  const link = track(await connect(hostId, key))
  const device = await newHostKey()
  link.send({ ch: 'phone', type: 'device-add', deviceId, publicKey: device.publicKey })
  await link.settle(50)
  return { hostId, key, link, device, deviceId }
}

const b64 = (text: string) => btoa(text)

describe('phone sockets', () => {
  it('splices a known device: its frames reach the host unchanged, and the host reaches only it', async () => {
    const { hostId, link, device, deviceId } = await hostWithDevice()
    const other = await newHostKey()
    link.send({ ch: 'phone', type: 'device-add', deviceId: 'd_phone0002', publicKey: other.publicKey })
    const a = await phone(hostId, deviceId, device)
    const b = await phone(hostId, 'd_phone0002', other)
    expect(await a.type('host-online')).toEqual({ type: 'host-online' })
    expect(await link.take((f) => f.type === 'device-open' && f.deviceId === deviceId)).toEqual({ ch: 'phone', type: 'device-open', deviceId })

    a.send({ type: 'frame', data: b64('opaque ciphertext 1') })
    expect(await link.take((f) => f.type === 'frame')).toEqual({ ch: 'phone', type: 'frame', deviceId, data: b64('opaque ciphertext 1') })

    link.send({ ch: 'phone', type: 'frame', deviceId, data: b64('for a only') })
    expect(await a.type('frame')).toEqual({ type: 'frame', data: b64('for a only') })
    await b.settle()
    expect(b.frames.filter((f) => f.type === 'frame')).toEqual([])
  })

  it('closes an unknown device, a bad signature, and a device of another host with 4401', async () => {
    const { hostId, key, device, deviceId } = await hostWithDevice()
    const stranger = await newHostKey()

    const unknown = await openPhoneSocket(hostId)
    const c1 = await unknown.type('challenge')
    unknown.send({ type: 'auth', deviceId: 'd_nobody0001', signature: await stranger.sign(deviceSigningText('d_nobody0001', c1.nonce)) })
    expect((await unknown.waitClosed())?.code).toBe(limits.closeUnauthorized)

    const forged = await openPhoneSocket(hostId)
    const c2 = await forged.type('challenge')
    forged.send({ type: 'auth', deviceId, signature: await stranger.sign(deviceSigningText(deviceId, c2.nonce)) })
    expect((await forged.waitClosed())?.code).toBe(limits.closeUnauthorized)

    const { invite } = (await (await mintInvite(hostId, key)).json()) as { invite: string }
    const laptop = await newHostKey()
    const reg = await post('/v1/hosts/register', { invite, publicKey: laptop.publicKey, name: 'Laptop' })
    const second = (await reg.json()) as { hostId: string }
    const elsewhere = await openPhoneSocket(second.hostId)
    const c3 = await elsewhere.type('challenge')
    elsewhere.send({ type: 'auth', deviceId, signature: await device.sign(deviceSigningText(deviceId, c3.nonce)) })
    expect((await elsewhere.waitClosed())?.code).toBe(limits.closeUnauthorized)

    const early = await openPhoneSocket(hostId)
    await early.type('challenge')
    early.send({ type: 'frame', data: b64('before auth') })
    expect((await early.waitClosed())?.code).toBe(limits.closeUnauthorized)
  })

  it('tells the phone host-offline and host-online without closing it', async () => {
    const { hostId, key, link, device, deviceId } = await hostWithDevice()
    const ws = await phone(hostId, deviceId, device)
    await ws.type('host-online')
    link.close()
    expect(await ws.type('host-offline')).toEqual({ type: 'host-offline' })
    // Frames sent while the host is away are dropped, not queued.
    ws.send({ type: 'frame', data: b64('lost') })
    const back = track(await connect(hostId, key))
    expect(await ws.type('host-online')).toEqual({ type: 'host-online' })
    expect(await back.take((f) => f.type === 'device-open')).toEqual({ ch: 'phone', type: 'device-open', deviceId })
    expect(ws.closed).toBeNull()
    expect(back.frames.filter((f) => f.type === 'frame')).toEqual([])
    ws.send({ type: 'frame', data: b64('after') })
    expect((await back.take((f) => f.type === 'frame')).data).toBe(b64('after'))
  })

  it('a phone that connects while its host is away hears host-offline first', async () => {
    const { hostId, link, device, deviceId } = await hostWithDevice()
    link.close()
    await link.waitClosed()
    const ws = await phone(hostId, deviceId, device)
    expect(await ws.type('host-offline')).toEqual({ type: 'host-offline' })
  })

  it('device-remove and device-sync revoke: the socket closes with 4403 and the next connect fails', async () => {
    const { hostId, link, device, deviceId } = await hostWithDevice()
    const ws = await phone(hostId, deviceId, device)
    link.send({ ch: 'phone', type: 'device-remove', deviceId })
    expect((await ws.waitClosed(1000))?.code).toBe(limits.closeRevoked)
    const again = await openPhoneSocket(hostId)
    const c = await again.type('challenge')
    again.send({ type: 'auth', deviceId, signature: await device.sign(deviceSigningText(deviceId, c.nonce)) })
    expect((await again.waitClosed())?.code).toBe(limits.closeUnauthorized)

    // A revoke made while the link was down reaches the Hub with the next sync.
    const kept = await newHostKey()
    link.send({ ch: 'phone', type: 'device-add', deviceId: 'd_phone0003', publicKey: device.publicKey })
    const doomed = await phone(hostId, 'd_phone0003', device)
    link.send({ ch: 'phone', type: 'device-sync', devices: [{ deviceId: 'd_phone0004', publicKey: kept.publicKey }] })
    expect((await doomed.waitClosed(1000))?.code).toBe(limits.closeRevoked)
    expect(await runInDurableObject(hubStub(), (hub: Hub) => (hub as unknown as { phones: { devicesOf(h: string): string[] } }).phones.devicesOf(hostId))).toEqual(['d_phone0004'])
  })

  it('the daemon closes a phone whose channel broke, with the code it gives', async () => {
    const { hostId, link, device, deviceId } = await hostWithDevice()
    const ws = await phone(hostId, deviceId, device)
    link.send({ ch: 'phone', type: 'close', deviceId, code: limits.closeChannelBroken, reason: 'replayed frame' })
    const closed = await ws.waitClosed(1000)
    expect(closed?.code).toBe(limits.closeChannelBroken)
    expect(await link.take((f) => f.type === 'device-closed')).toEqual({ ch: 'phone', type: 'device-closed', deviceId })
  })

  it('a newer socket of the same device replaces the older with 4409', async () => {
    const { hostId, device, deviceId } = await hostWithDevice()
    const first = await phone(hostId, deviceId, device)
    await phone(hostId, deviceId, device)
    expect((await first.waitClosed(1000))?.code).toBe(limits.closeReplaced)
  })

  it('refuses a frame over 1 MiB and keeps the socket', async () => {
    const { hostId, link, device, deviceId } = await hostWithDevice()
    const ws = await phone(hostId, deviceId, device)
    ws.send({ type: 'frame', data: 'A'.repeat(limits.maxMessageBytes + 4) })
    expect(await ws.type('error')).toEqual({ type: 'error', code: 'too_large' })
    ws.send({ type: 'frame', data: b64('small') })
    expect((await link.take((f) => f.type === 'frame')).data).toBe(b64('small'))
  })

  it('lets a phone pair through the relay: the host hears pairing, then registers it', async () => {
    const { hostId, key } = await registerHost()
    const link = track(await connect(hostId, key))
    const newcomer = await newHostKey()
    const ws = await phone(hostId, 'd_newphone01', newcomer, true)
    expect(await link.take((f) => f.type === 'device-open')).toEqual({ ch: 'phone', type: 'device-open', deviceId: 'd_newphone01', pairing: true })
    ws.send({ type: 'frame', data: b64('sealed pairing grant') })
    expect((await link.take((f) => f.type === 'frame')).deviceId).toBe('d_newphone01')
    // Pairing an id that is already a device is refused.
    link.send({ ch: 'phone', type: 'device-add', deviceId: 'd_taken00001', publicKey: newcomer.publicKey })
    await link.settle(50)
    const clash = await openPhoneSocket(hostId)
    const c = await clash.type('challenge')
    clash.send({ type: 'pair', deviceId: 'd_taken00001', publicKey: newcomer.publicKey, signature: await newcomer.sign(deviceSigningText('d_taken00001', c.nonce)) })
    expect((await clash.waitClosed())?.code).toBe(limits.closeUnauthorized)
  })

  it('caps pairing sockets and devices per host', async () => {
    const { hostId, key } = await registerHost()
    const link = track(await connect(hostId, key))
    const k = await newHostKey()
    for (let i = 0; i < limits.maxPairingSocketsPerHost; i++) await phone(hostId, `d_pairing000${i}`, k, true)
    const extra = await openPhoneSocket(hostId)
    const c = await extra.type('challenge')
    extra.send({ type: 'pair', deviceId: 'd_pairing0099', publicKey: k.publicKey, signature: await k.sign(deviceSigningText('d_pairing0099', c.nonce)) })
    expect((await extra.waitClosed())?.code).toBe(limits.closeUnauthorized)

    const devices = Array.from({ length: limits.maxDevicesPerHost }, (_, i) => ({ deviceId: `d_dev${String(i).padStart(5, '0')}`, publicKey: k.publicKey }))
    link.send({ ch: 'phone', type: 'device-sync', devices })
    await link.settle(100)
    link.send({ ch: 'phone', type: 'device-add', deviceId: 'd_onetoomany', publicKey: k.publicKey })
    expect((await link.take((f) => f.ch === 'bots' && f.type === 'error')).code).toBe('too_many_devices')
  })

  it('answers 426 without an upgrade and 404 for a malformed host id', async () => {
    expect((await SELF.fetch(`${BASE}/v1/device/h_abcdefgh1234/ws`)).status).toBe(426)
    const res = await SELF.fetch(`${BASE}/v1/device/not-a-host/ws`, { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(404)
  })

  it('keeps no payload: storage and logs never hold a frame sent inside the channel', async () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => void logs.push(args.join(' ')))
    try {
      const { hostId, link, device, deviceId } = await hostWithDevice()
      const ws = await phone(hostId, deviceId, device)
      const marker = b64('marker-phone-payload-5c1e')
      ws.send({ type: 'frame', data: marker })
      await link.take((f) => f.type === 'frame')
      link.send({ ch: 'phone', type: 'frame', deviceId, data: marker })
      await ws.type('frame')
      const dump = await hubStub().dumpStorage()
      expect(dump).not.toContain(marker)
      expect(dump).not.toContain('marker-phone-payload')
      // The Hub's own lines are captured, so the check below can fail.
      expect(logs.join('\n')).toContain(`phone connected ${deviceId}`)
      expect(logs.join('\n')).not.toContain(marker)
    } finally {
      spy.mockRestore()
    }
  })
})
