// The phone relay in the Hub (docs/specs/mobile/relay.md). A phone's socket on
// `/v1/device/<hostId>/ws` proves its device key, then the Hub only splices opaque frames between
// it and its host's link. Each socket's hibernation attachment holds who it is; the `devices` table
// holds the keys the host registered. Nothing here reads, keeps or logs a frame's `data`.

import {
  bytesToBase64,
  deviceSigningText,
  limits,
  phoneSocketToHubSchema,
  type PhoneToHub
} from './contract'
import { verifyEd25519 } from './crypto'

export interface PhoneAttachment {
  kind: 'phone'
  hostId: string
  /** The device this socket proved; null until it did. */
  deviceId: string | null
  nonce: string | null
  /** A phone pairing over the relay: not a registered device yet. */
  pairing: boolean
}

/** What the Hub gives the phone relay. */
export interface PhoneHub {
  ctx: DurableObjectState
  sql: SqlStorage
  /** The host's authenticated link, if it is up. */
  hostLink(hostId: string): WebSocket | null
  hostExists(hostId: string): boolean
  /** Tells the link about something it got wrong (an unknown device, a full device list). */
  linkError(link: WebSocket, code: string, message: string): void
}

const HOST_ID = /^h_[A-Za-z0-9_-]{8,64}$/
const phoneTag = (hostId: string) => `phone:${hostId}`

export class PhoneRelay {
  constructor(private readonly hub: PhoneHub) {}

  /** `GET /v1/device/<hostId>/ws`: accept, and challenge. Every failure later is a close code. */
  accept(request: Request, hostId: string): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return Response.json({ error: 'bad_request' }, { status: 426 })
    if (!HOST_ID.test(hostId)) return Response.json({ error: 'not_found' }, { status: 404 })
    const { 0: client, 1: server } = new WebSocketPair()
    const nonce = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    this.hub.ctx.acceptWebSocket(server, [phoneTag(hostId)])
    server.serializeAttachment({ kind: 'phone', hostId, deviceId: null, nonce, pairing: false } satisfies PhoneAttachment)
    server.send(JSON.stringify({ type: 'challenge', nonce }))
    return new Response(null, { status: 101, webSocket: client })
  }

  async onMessage(ws: WebSocket, att: PhoneAttachment, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return ws.close(1003, 'text frames only')
    if (message.length > limits.maxMessageBytes + 64) return void ws.send(JSON.stringify({ type: 'error', code: 'too_large' }))
    let value: unknown
    try {
      value = JSON.parse(message)
    } catch {
      return ws.close(1007, 'not JSON')
    }
    const parsed = phoneSocketToHubSchema.safeParse(value)
    if (!att.deviceId) {
      if (!parsed.success || parsed.data.type === 'frame') return ws.close(limits.closeUnauthorized, 'auth first')
      return this.authenticate(ws, att, parsed.data)
    }
    if (!parsed.success) {
      const tooLarge = typeof (value as { data?: unknown })?.data === 'string' && (value as { data: string }).data.length > limits.maxMessageBytes
      return void ws.send(JSON.stringify({ type: 'error', code: tooLarge ? 'too_large' : 'bad_message' }))
    }
    if (parsed.data.type !== 'frame') return
    const link = this.hub.hostLink(att.hostId)
    // Never queued: the phone keeps its own queue, and the host-offline it already got says why.
    if (!link) return
    link.send(JSON.stringify({ ch: 'phone', type: 'frame', deviceId: att.deviceId, data: parsed.data.data }))
  }

  private async authenticate(
    ws: WebSocket,
    att: PhoneAttachment,
    frame: { type: 'auth'; deviceId: string; signature: string } | { type: 'pair'; deviceId: string; publicKey: string; signature: string }
  ) {
    const nonce = att.nonce
    if (!nonce) return ws.close(limits.closeUnauthorized, 'auth first')
    const row = this.device(frame.deviceId)
    let pairing = false
    let publicKey: string
    if (frame.type === 'auth') {
      // An unknown device, or one of another host: the same close, so neither is told apart.
      if (!row || row.host_id !== att.hostId) return ws.close(limits.closeUnauthorized, 'unknown device')
      publicKey = row.public_key
    } else {
      if (row || !this.hub.hostExists(att.hostId)) return ws.close(limits.closeUnauthorized, 'cannot pair')
      const pending = this.sockets(att.hostId).filter((s) => {
        const other = s.deserializeAttachment() as PhoneAttachment | null
        return s !== ws && other?.deviceId && other.pairing
      })
      if (pending.length >= limits.maxPairingSocketsPerHost) return ws.close(limits.closeUnauthorized, 'too many pairings')
      publicKey = frame.publicKey
      pairing = true
    }
    if (!(await verifyEd25519(publicKey, frame.signature, deviceSigningText(frame.deviceId, nonce)))) {
      return ws.close(limits.closeUnauthorized, 'bad key')
    }
    // Revoked while the signature was checked.
    if (frame.type === 'auth' && !this.device(frame.deviceId)) return ws.close(limits.closeUnauthorized, 'unknown device')
    // One socket per device: a newer one replaces the old.
    const older = this.socketOf(att.hostId, frame.deviceId)
    // Tags are fixed at accept, so a device's socket is found by its attachment.
    ws.serializeAttachment({ ...att, deviceId: frame.deviceId, nonce: null, pairing } satisfies PhoneAttachment)
    if (older && older !== ws) older.close(limits.closeReplaced, 'replaced')
    ws.send(JSON.stringify({ type: 'auth-ok', deviceId: frame.deviceId }))
    const link = this.hub.hostLink(att.hostId)
    if (link) {
      link.send(JSON.stringify({ ch: 'phone', type: 'device-open', deviceId: frame.deviceId, ...(pairing ? { pairing: true } : {}) }))
      ws.send(JSON.stringify({ type: 'host-online' }))
    } else ws.send(JSON.stringify({ type: 'host-offline' }))
    console.log(`phone ${pairing ? 'pairing' : 'connected'} ${frame.deviceId} for ${att.hostId}`)
  }

  /** A message on the host link's `phone` channel. */
  fromHost(link: WebSocket, hostId: string, msg: PhoneToHub): void {
    switch (msg.type) {
      case 'frame': {
        const ws = this.socketOf(hostId, msg.deviceId)
        if (ws) ws.send(JSON.stringify({ type: 'frame', data: msg.data }))
        return
      }
      case 'device-add':
        return this.add(link, hostId, msg.deviceId, msg.publicKey)
      case 'device-remove':
        return this.remove(hostId, [msg.deviceId])
      case 'device-sync': {
        const listed = new Set(msg.devices.map((d) => d.deviceId))
        const gone = this.sql
          .exec<{ id: string }>('SELECT id FROM devices WHERE host_id = ?', hostId)
          .toArray()
          .map((r) => r.id)
          .filter((id) => !listed.has(id))
        this.remove(hostId, gone)
        for (const device of msg.devices) this.add(link, hostId, device.deviceId, device.publicKey)
        return
      }
      case 'close': {
        const ws = this.socketOf(hostId, msg.deviceId)
        ws?.close(msg.code, msg.reason ?? '')
        return
      }
    }
  }

  private get sql() {
    return this.hub.sql
  }

  private device(id: string) {
    return this.sql.exec<{ id: string; host_id: string; public_key: string }>('SELECT id, host_id, public_key FROM devices WHERE id = ?', id).toArray()[0]
  }

  private add(link: WebSocket, hostId: string, deviceId: string, publicKey: string) {
    const row = this.device(deviceId)
    if (row && row.host_id !== hostId) return this.hub.linkError(link, 'bad_message', `device ${deviceId} belongs to another host`)
    if (row) {
      if (row.public_key !== publicKey) this.sql.exec('UPDATE devices SET public_key = ? WHERE id = ?', publicKey, deviceId)
      return
    }
    const count = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM devices WHERE host_id = ?', hostId).one().n
    if (count >= limits.maxDevicesPerHost) return this.hub.linkError(link, 'too_many_devices', `a host may register ${limits.maxDevicesPerHost} devices`)
    this.sql.exec('INSERT INTO devices (id, host_id, public_key, created_at) VALUES (?, ?, ?, ?)', deviceId, hostId, publicKey, Date.now())
  }

  /** Deletes the devices' keys and closes their sockets as revoked. */
  private remove(hostId: string, deviceIds: string[]) {
    for (const id of deviceIds) {
      this.sql.exec('DELETE FROM devices WHERE id = ? AND host_id = ?', id, hostId)
      this.socketOf(hostId, id)?.close(limits.closeRevoked, 'revoked')
    }
  }

  private sockets(hostId: string): WebSocket[] {
    return this.hub.ctx.getWebSockets(phoneTag(hostId))
  }

  /** The authenticated socket of a device of this host. */
  private socketOf(hostId: string, deviceId: string): WebSocket | null {
    for (const ws of this.sockets(hostId)) {
      const att = ws.deserializeAttachment() as PhoneAttachment | null
      if (att?.deviceId === deviceId) return ws
    }
    return null
  }

  /** The host's link authenticated: every open phone starts a new channel. */
  hostOnline(hostId: string, link: WebSocket): void {
    for (const ws of this.sockets(hostId)) {
      const att = ws.deserializeAttachment() as PhoneAttachment | null
      if (!att?.deviceId) continue
      link.send(JSON.stringify({ ch: 'phone', type: 'device-open', deviceId: att.deviceId, ...(att.pairing ? { pairing: true } : {}) }))
      ws.send(JSON.stringify({ type: 'host-online' }))
    }
  }

  /** The host's last link closed: its phones stay connected and are told. */
  hostOffline(hostId: string): void {
    for (const ws of this.sockets(hostId)) {
      const att = ws.deserializeAttachment() as PhoneAttachment | null
      if (att?.deviceId) ws.send(JSON.stringify({ type: 'host-offline' }))
    }
  }

  /** A phone's socket closed. */
  onClose(ws: WebSocket, att: PhoneAttachment): void {
    if (!att.deviceId) return
    // Replaced by a newer socket of the same device: the host keeps that one's channel.
    const replaced = this.sockets(att.hostId).some((s) => s !== ws && (s.deserializeAttachment() as PhoneAttachment | null)?.deviceId === att.deviceId)
    if (replaced) return
    this.hub.hostLink(att.hostId)?.send(JSON.stringify({ ch: 'phone', type: 'device-closed', deviceId: att.deviceId }))
  }

  /** A revoked host: its phones go too. */
  closeHost(hostId: string): void {
    for (const ws of this.sockets(hostId)) ws.close(limits.closeUnauthorized, 'revoked')
  }

  /** For tests: the device ids the Hub holds for a host. */
  devicesOf(hostId: string): string[] {
    return this.sql.exec<{ id: string }>('SELECT id FROM devices WHERE host_id = ? ORDER BY id', hostId).toArray().map((r) => r.id)
  }
}
