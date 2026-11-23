// An in-process stand-in for Zomfy Relay's phone routes, for the daemon's phone relay tests. Like
// the real Hub (apps/relay/src/phone.ts) it registers one host, takes the host link, checks each
// phone socket's device key against the keys the host registered, and splices frames without
// reading them. It keeps every frame it spliced, so tests can replay one.

import { createPublicKey, verify } from 'node:crypto'
import type { ServerWebSocket } from 'bun'
import {
  base64ToBytes,
  bytesToBase64,
  deviceSigningText,
  limits,
  linkSigningText,
  parseToHub,
  phoneSocketToHubSchema,
  PING_FRAME,
  PONG_FRAME
} from '@zomfy/relay-contract'

interface LinkData {
  kind: 'link'
  hostId: string
  nonce: string
  authed: boolean
}
interface PhoneData {
  kind: 'phone'
  hostId: string
  nonce: string
  deviceId: string | null
  pairing: boolean
}
type Data = LinkData | PhoneData

function ed25519Verify(publicKey: string, text: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(base64ToBytes(publicKey)).toString('base64url') }, format: 'jwk' })
    return verify(null, Buffer.from(text), key, Buffer.from(base64ToBytes(signature)))
  } catch {
    return false
  }
}

export class FakePhoneHub {
  readonly url: string
  readonly setupCode = 'fake-setup-code'
  /** Device keys the host registered, by relay device id. */
  readonly devices = new Map<string, string>()
  /** Every phone-channel message the host sent, in order. */
  readonly fromHost: Array<Record<string, unknown>> = []
  /** Every frame a phone sent, in order (`data` as spliced). */
  readonly fromPhones: Array<{ deviceId: string; data: string }> = []
  private hostKey: string | null = null
  private hostId: string | null = null
  private readonly sockets = new Set<ServerWebSocket<Data>>()
  private readonly server: ReturnType<typeof Bun.serve<Data>>

  constructor() {
    this.server = Bun.serve<Data>({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (req, server) => this.fetch(req, server),
      websocket: {
        maxPayloadLength: 2 * limits.maxMessageBytes,
        open: (ws) => {
          this.sockets.add(ws)
          ws.send(JSON.stringify(ws.data.kind === 'link' ? { ch: 'link', type: 'challenge', nonce: ws.data.nonce } : { type: 'challenge', nonce: ws.data.nonce }))
        },
        message: (ws, message) => this.onMessage(ws, String(message)),
        close: (ws) => this.onClose(ws)
      }
    })
    this.url = `http://127.0.0.1:${this.server.port}`
  }

  private async fetch(req: Request, server: Bun.Server<Data>): Promise<Response | undefined> {
    const url = new URL(req.url)
    const nonce = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    if (url.pathname === '/health') return Response.json({ ok: true, version: 'fake', contract: 1, sources: [] })
    if (url.pathname === '/v1/hosts/register' && req.method === 'POST') {
      const body = (await req.json()) as { setupCode?: string; publicKey: string }
      if (body.setupCode !== this.setupCode || this.hostId) return Response.json({ error: 'bad_setup_code' }, { status: 403 })
      this.hostId = 'h_fakephonehost'
      this.hostKey = body.publicKey
      return Response.json({ hostId: this.hostId })
    }
    if (url.pathname === '/v1/host') {
      if (server.upgrade(req, { data: { kind: 'link', hostId: url.searchParams.get('hostId') ?? '', nonce, authed: false } })) return undefined
    }
    const device = /^\/v1\/device\/([^/]+)\/ws$/.exec(url.pathname)
    if (device) {
      if (server.upgrade(req, { data: { kind: 'phone', hostId: decodeURIComponent(device[1]!), nonce, deviceId: null, pairing: false } })) return undefined
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  private link(): ServerWebSocket<Data> | null {
    for (const ws of this.sockets) if (ws.data.kind === 'link' && ws.data.authed) return ws
    return null
  }

  private phones(): ServerWebSocket<Data>[] {
    return [...this.sockets].filter((ws) => ws.data.kind === 'phone' && ws.data.deviceId !== null)
  }

  private phone(deviceId: string): ServerWebSocket<Data> | undefined {
    return this.phones().find((ws) => ws.data.kind === 'phone' && ws.data.deviceId === deviceId)
  }

  private onMessage(ws: ServerWebSocket<Data>, text: string) {
    if (text === PING_FRAME) return void ws.send(PONG_FRAME)
    if (ws.data.kind === 'link') return this.onLink(ws as ServerWebSocket<Data> & { data: LinkData }, text)
    const data = ws.data
    const parsed = phoneSocketToHubSchema.safeParse(JSON.parse(text))
    if (!parsed.success) return void ws.send(JSON.stringify({ type: 'error', code: 'bad_message' }))
    const frame = parsed.data
    if (data.deviceId === null) {
      if (frame.type === 'frame') return ws.close(limits.closeUnauthorized, 'auth first')
      const known = this.devices.get(frame.deviceId)
      const key = frame.type === 'auth' ? known : known ? undefined : frame.publicKey
      if (!key || data.hostId !== this.hostId || !ed25519Verify(key, deviceSigningText(frame.deviceId, data.nonce), frame.signature)) {
        return ws.close(limits.closeUnauthorized, 'unknown device')
      }
      this.phone(frame.deviceId)?.close(limits.closeReplaced, 'replaced')
      data.deviceId = frame.deviceId
      data.pairing = frame.type === 'pair'
      ws.send(JSON.stringify({ type: 'auth-ok', deviceId: frame.deviceId }))
      const link = this.link()
      if (link) {
        link.send(JSON.stringify({ ch: 'phone', type: 'device-open', deviceId: frame.deviceId, ...(data.pairing ? { pairing: true } : {}) }))
        ws.send(JSON.stringify({ type: 'host-online' }))
      } else ws.send(JSON.stringify({ type: 'host-offline' }))
      return
    }
    if (frame.type !== 'frame') return
    this.fromPhones.push({ deviceId: data.deviceId, data: frame.data })
    this.link()?.send(JSON.stringify({ ch: 'phone', type: 'frame', deviceId: data.deviceId, data: frame.data }))
  }

  private onLink(ws: ServerWebSocket<Data> & { data: LinkData }, text: string) {
    const parsed = parseToHub(text)
    if (parsed.kind !== 'message') return
    const msg = parsed.message
    if (!ws.data.authed) {
      if (msg.ch === 'link' && msg.type === 'auth' && this.hostKey && ws.data.hostId === this.hostId && ed25519Verify(this.hostKey, linkSigningText(ws.data.hostId, ws.data.nonce), msg.signature)) {
        ws.data.authed = true
        ws.send(JSON.stringify({ ch: 'link', type: 'auth-ok', hostId: ws.data.hostId }))
        for (const phone of this.phones()) {
          const data = phone.data as PhoneData
          ws.send(JSON.stringify({ ch: 'phone', type: 'device-open', deviceId: data.deviceId, ...(data.pairing ? { pairing: true } : {}) }))
          phone.send(JSON.stringify({ type: 'host-online' }))
        }
      } else ws.close(limits.closeUnauthorized, 'bad key')
      return
    }
    if (msg.ch !== 'phone') return
    this.fromHost.push(msg as unknown as Record<string, unknown>)
    switch (msg.type) {
      case 'frame':
        this.phone(msg.deviceId)?.send(JSON.stringify({ type: 'frame', data: msg.data }))
        return
      case 'device-add':
        this.devices.set(msg.deviceId, msg.publicKey)
        return
      case 'device-remove':
        this.devices.delete(msg.deviceId)
        this.phone(msg.deviceId)?.close(limits.closeRevoked, 'revoked')
        return
      case 'device-sync': {
        const listed = new Set(msg.devices.map((d) => d.deviceId))
        for (const id of [...this.devices.keys()]) {
          if (listed.has(id)) continue
          this.devices.delete(id)
          this.phone(id)?.close(limits.closeRevoked, 'revoked')
        }
        for (const d of msg.devices) this.devices.set(d.deviceId, d.publicKey)
        return
      }
      case 'close':
        this.phone(msg.deviceId)?.close(msg.code, msg.reason ?? '')
        return
    }
  }

  private onClose(ws: ServerWebSocket<Data>) {
    this.sockets.delete(ws)
    if (ws.data.kind === 'link' && ws.data.authed && !this.link()) {
      for (const phone of this.phones()) phone.send(JSON.stringify({ type: 'host-offline' }))
    }
    if (ws.data.kind === 'phone' && ws.data.deviceId && !this.phone(ws.data.deviceId)) {
      this.link()?.send(JSON.stringify({ ch: 'phone', type: 'device-closed', deviceId: ws.data.deviceId }))
    }
  }

  /** Sends a raw phone frame to the host as if `deviceId`'s phone had sent it (a replay). */
  inject(deviceId: string, data: string) {
    this.link()?.send(JSON.stringify({ ch: 'phone', type: 'frame', deviceId, data }))
  }

  /** Drops the host's link, as a network loss does. */
  dropLink() {
    for (const ws of this.sockets) if (ws.data.kind === 'link') ws.close(1012, 'restart')
  }

  get linked(): boolean {
    return this.link() !== null
  }

  async stop() {
    for (const ws of this.sockets) ws.close(1001, 'stopping')
    await this.server.stop(true)
  }
}
