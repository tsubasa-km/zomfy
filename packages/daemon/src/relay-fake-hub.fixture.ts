// An in-process stand-in for Zomfy Relay's Hub, speaking the contract over a real WebSocket, for the
// daemon's connector tests. It keeps just enough state: one setup code, registered host keys, the
// current helloRev per host, the deliveries it was told to send, and every ack it got.

import { createPublicKey, verify } from 'node:crypto'
import type { ServerWebSocket } from 'bun'
import {
  base64ToBytes,
  bytesToBase64,
  limits,
  linkSigningText,
  parseToHub,
  PING_FRAME,
  PONG_FRAME,
  type Ack,
  type Action,
  type BotEvent,
  type Delivery,
  type Hello
} from '@zomfy/relay-contract'

interface SocketData {
  hostId: string
  nonce: string
  authed: boolean
}

export class FakeHub {
  readonly url: string
  readonly hellos: Hello[] = []
  readonly acks: Ack[] = []
  readonly frames: unknown[] = []
  /** Events from batches taken in order, as the Hub keeps them (a seen `seq` is skipped). */
  readonly events: BotEvent[] = []
  private readonly lastSeq = new Map<string, number>()
  /** Connections that got as far as auth-ok. */
  connections = 0
  private readonly hosts = new Map<string, string>()
  private readonly helloRev = new Map<string, number>()
  private readonly deliveries = new Map<string, { delivery: Delivery; done: boolean }>()
  private readonly sockets = new Set<ServerWebSocket<SocketData>>()
  private setupUsed = false
  private readonly server: ReturnType<typeof Bun.serve<SocketData>>
  /** When true, the Hub accepts sockets but never answers (a dead link). */
  silent = false
  /** Every action the host asked for, in order. */
  readonly actions: Action[] = []
  /** How the fake answers an action; `{ok: true, result: {}}` by default. */
  onAction: (action: Action) => { ok: boolean; result?: unknown; error?: { code: string; message: string } } = () => ({ ok: true, result: {} })

  constructor(readonly setupCode = 'fake-setup-code') {
    this.server = Bun.serve<SocketData>({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (req, server) => this.fetch(req, server),
      websocket: {
        open: (ws) => {
          this.sockets.add(ws)
          if (!this.silent) ws.send(JSON.stringify({ ch: 'link', type: 'challenge', nonce: ws.data.nonce }))
        },
        message: (ws, message) => this.onMessage(ws, String(message)),
        close: (ws) => {
          this.sockets.delete(ws)
        }
      }
    })
    this.url = `http://127.0.0.1:${this.server.port}`
  }

  private async fetch(req: Request, server: Bun.Server<SocketData>): Promise<Response | undefined> {
    const url = new URL(req.url)
    if (url.pathname === '/health') return Response.json({ ok: true, version: 'fake', contract: 1, sources: ['discord'] })
    if (url.pathname === '/v1/hosts/register' && req.method === 'POST') {
      const body = (await req.json()) as { setupCode?: string; publicKey: string }
      if (body.setupCode !== this.setupCode) return Response.json({ error: 'bad_setup_code' }, { status: 403 })
      if (this.setupUsed) return Response.json({ error: 'setup_code_used' }, { status: 403 })
      this.setupUsed = true
      const hostId = `h_fake${this.hosts.size + 1}host`
      this.hosts.set(hostId, body.publicKey)
      return Response.json({ hostId })
    }
    if (url.pathname === '/v1/host') {
      const nonce = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
      if (server.upgrade(req, { data: { hostId: url.searchParams.get('hostId') ?? '', nonce, authed: false } })) return undefined
      return new Response('upgrade failed', { status: 400 })
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  private verify(hostId: string, nonce: string, signature: string): boolean {
    const raw = this.hosts.get(hostId)
    if (!raw) return false
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(base64ToBytes(raw)).toString('base64url') }, format: 'jwk' })
    return verify(null, Buffer.from(linkSigningText(hostId, nonce)), key, Buffer.from(base64ToBytes(signature)))
  }

  private onMessage(ws: ServerWebSocket<SocketData>, text: string) {
    if (this.silent) return
    if (text === PING_FRAME) return void ws.send(PONG_FRAME)
    const parsed = parseToHub(text)
    if (parsed.kind !== 'message') return
    const msg = parsed.message
    this.frames.push(msg)
    if (!ws.data.authed) {
      if (msg.ch === 'link' && msg.type === 'auth' && this.verify(ws.data.hostId, ws.data.nonce, msg.signature)) {
        ws.data.authed = true
        this.connections++
        ws.send(JSON.stringify({ ch: 'link', type: 'auth-ok', hostId: ws.data.hostId }))
      } else ws.close(limits.closeUnauthorized, 'bad key')
      return
    }
    if (msg.ch !== 'bots') return
    if (msg.type === 'hello') {
      this.hellos.push(msg)
      const rev = (this.helloRev.get(ws.data.hostId) ?? 0) + 1
      this.helloRev.set(ws.data.hostId, rev)
      this.lastSeq.set(ws.data.hostId, -1)
      const open = [...this.deliveries.values()].filter((d) => !d.done).map((d) => d.delivery)
      ws.send(JSON.stringify({ ch: 'bots', type: 'hello-ok', helloRev: rev, features: [], unsettled: open.map((d) => d.id) }))
      if (open.length) this.sendTo(ws, open)
      return
    }
    if (msg.type === 'events') {
      if (msg.helloRev !== this.helloRev.get(ws.data.hostId)) {
        ws.send(JSON.stringify({ ch: 'bots', type: 'error', code: 'hello_required', message: 'stale helloRev' }))
        return
      }
      if (msg.seq <= (this.lastSeq.get(ws.data.hostId) ?? -1)) return
      this.lastSeq.set(ws.data.hostId, msg.seq)
      this.events.push(...(msg.events as BotEvent[]))
      return
    }
    if (msg.type === 'action') {
      this.actions.push(msg)
      const answer = this.onAction(msg)
      ws.send(JSON.stringify({ ch: 'bots', type: 'action-result', reqId: msg.reqId, ...answer }))
      return
    }
    if (msg.type === 'ack') {
      if (msg.helloRev !== this.helloRev.get(ws.data.hostId)) {
        ws.send(JSON.stringify({ ch: 'bots', type: 'error', code: 'hello_required', message: 'stale helloRev' }))
        return
      }
      this.acks.push(msg)
      const entry = this.deliveries.get(msg.deliveryId)
      if (entry && msg.step === 'done') entry.done = true
    }
  }

  private sendTo(ws: ServerWebSocket<SocketData>, deliveries: Delivery[]) {
    ws.send(JSON.stringify({ ch: 'bots', type: 'delivery', helloRev: this.helloRev.get(ws.data.hostId), deliveries }))
  }

  private authed() {
    return [...this.sockets].filter((ws) => ws.data.authed && this.helloRev.has(ws.data.hostId))
  }

  /** Queues a delivery and sends it at once if a host is linked. */
  push(delivery: Delivery) {
    this.deliveries.set(delivery.id, { delivery, done: false })
    for (const ws of this.authed()) this.sendTo(ws, [delivery])
  }

  /** Sends a delivery again, as the Hub does when a lease runs out. */
  resend(id: string) {
    const entry = this.deliveries.get(id)
    if (entry) for (const ws of this.authed()) this.sendTo(ws, [entry.delivery])
  }

  send(message: object) {
    for (const ws of this.authed()) ws.send(JSON.stringify(message))
  }

  /** Drops every link, as a relay restart or network loss does. */
  dropAll(code = 1012, reason = 'restart') {
    for (const ws of this.sockets) ws.close(code, reason)
  }

  revokeAll() {
    this.hosts.clear()
    this.dropAll(limits.closeUnauthorized, 'revoked')
  }

  /** The events of one kind, in the order taken. */
  eventsOf<K extends BotEvent['kind']>(kind: K): Extract<BotEvent, { kind: K }>[] {
    return this.events.filter((e): e is Extract<BotEvent, { kind: K }> => e.kind === kind)
  }

  acksFor(id: string) {
    return this.acks.filter((a) => a.deliveryId === id).map((a) => (a.step === 'done' ? `done:${a.outcome}` : a.step))
  }

  async stop() {
    this.dropAll(1001, 'stopping')
    await this.server.stop(true)
  }
}

/** Polls until `check` passes or `ms` runs out. */
export async function eventually(check: () => boolean | Promise<boolean>, ms = 5000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}
