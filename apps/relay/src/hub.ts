// The Hub: the deployment's one Durable Object (docs/specs/bots/connector.md#durable-objects). Its
// SQLite storage is the queue; every daemon link is a hibernated WebSocket whose attachment holds
// only who it is and how far its handshake got, so nothing that matters lives in memory.

import { DurableObject } from 'cloudflare:workers'
import {
  botEventSchema,
  bytesToBase64,
  CONTRACT_VERSION,
  deliverySchema,
  inviteRequestSchema,
  inviteSigningText,
  limits,
  linkSigningText,
  LONG_WAIT_KINDS,
  parseToHub,
  PING_FRAME,
  PONG_FRAME,
  parseRef,
  registerRequestSchema,
  ruleSchema,
  type Ack,
  type Action,
  type Delivery,
  type Events,
  type Hello,
  type HelloBot,
  type HelloBots,
  type Rule,
  type ToHub
} from './contract'
import { isEd25519PublicKey, randomToken, sameText, sha256Hex, verifyEd25519 } from './crypto'
import { DiscordSource, type GatewayMessage } from './discord/source'
import { GitHubSource } from './github/source'
import { LinearSource } from './linear/source'
import { WebhookSource, type CallAnswer, type IncomingCall } from './webhooks/source'
import { SlackSource } from './slack/source'
import { configuredSources, type Env } from './env'
import { Outbound, OUTBOUND_DUE, type OutboundRunner } from './outbound'
import { within, type HubSource, type SourceHub } from './sources/common'

/** Features this Hub implements, of those the contract knows. */
const HUB_FEATURES = ['hello-bots-pages', 'events-seq']

/** What a host socket's attachment holds. */
interface HostAttachment {
  kind: 'host'
  hostId: string
  /** The challenge sent on accept; cleared once answered. */
  nonce: string | null
  authed: boolean
  /** The `helloRev` this socket's last `hello-ok` gave; 0 before its first hello. */
  helloRev: number
}

type DeliveryState = 'pending' | 'leased' | 'received' | 'done'

/** A delivery as the source routes hand it to the Hub; `expiresAt` defaults by kind. */
export type DeliveryInput = (Delivery extends infer D ? (D extends Delivery ? Omit<D, 'expiresAt'> : never) : never) & { expiresAt?: number }

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hosts (
     id TEXT PRIMARY KEY, public_key TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL,
     hello_rev INTEGER NOT NULL DEFAULT 0, last_seq INTEGER NOT NULL DEFAULT -1,
     hello TEXT, pages_expected INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS setup_codes (hash TEXT PRIMARY KEY, used_at INTEGER NOT NULL, host_id TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invites (
     hash TEXT PRIMARY KEY, by_host TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS devices (
     id TEXT PRIMARY KEY, host_id TEXT NOT NULL, public_key TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, host_id TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bots_pending (
     host_id TEXT NOT NULL, page INTEGER NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (host_id, id))`,
  `CREATE TABLE IF NOT EXISTS rules (host_id TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (host_id, id))`,
  `CREATE TABLE IF NOT EXISTS conversations (
     source TEXT NOT NULL, external_id TEXT NOT NULL, host_id TEXT NOT NULL, session_id TEXT NOT NULL,
     bot_id TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (source, external_id))`,
  `CREATE TABLE IF NOT EXISTS deliveries (
     id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
     state TEXT NOT NULL, host_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     sent_at INTEGER, received_at INTEGER, done_at INTEGER, outcome TEXT, attempts INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS deliveries_by_bot ON deliveries (bot_id, state)`,
  `CREATE TABLE IF NOT EXISTS seen_events (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS due (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
]

const PURGE_KEY = 'purge'
const DAY_MS = 24 * 60 * 60 * 1000

const json = (body: unknown, status = 200) => Response.json(body, { status })
const fail = (error: string, status: number) => json({ error }, status)

export class Hub extends DurableObject<Env> {
  private readonly sql: SqlStorage
  private readonly outbound: Outbound
  private readonly discord: DiscordSource
  private readonly slack: SlackSource
  private readonly github: GitHubSource
  private readonly webhooks: WebhookSource
  private readonly linear: LinearSource
  /** Every source, for the daemon's events, settled deliveries, actions, timers and the purge. */
  private readonly sources: HubSource[] = []
  /** What every source is given. */
  private readonly shared: SourceHub

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    for (const statement of SCHEMA) this.sql.exec(statement)
    const hub = this
    this.outbound = new Outbound(this.sql, (key, at) => hub.scheduleDue(key, at))
    this.shared = {
      sql: this.sql,
      env,
      outbound: this.outbound,
      transaction: (fn) => ctx.storage.transactionSync(fn),
      enqueue: (delivery) => this.enqueue(delivery),
      bots: () => this.allBots(),
      rules: () => this.allRules(),
      markSeen: (key) => this.markSeen(key),
      scheduleDue: (key, at) => hub.scheduleDue(key, at),
      origin: () => this.meta('origin'),
      settle: (id, outcome) => {
        const row = this.sql.exec<{ state: string }>('SELECT state FROM deliveries WHERE id = ?', id).toArray()[0]
        if (row && row.state !== 'done') this.finish(id, outcome, Date.now())
      }
    }
    this.discord = new DiscordSource({
      ...this.shared,
      watchChannel: (channelId, watch) => env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName('discord')).watch(channelId, watch)
    })
    this.addSource(this.discord)
    this.slack = new SlackSource(this.shared)
    this.addSource(this.slack)
    this.github = new GitHubSource(this.shared)
    this.addSource(this.github)
    this.webhooks = new WebhookSource(this.shared)
    this.addSource(this.webhooks)
    this.linear = new LinearSource(this.shared)
    this.addSource(this.linear)
    // Pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME))
  }

  private addSource(source: HubSource) {
    this.sources.push(source)
    const runner = source as HubSource & Partial<OutboundRunner>
    if (runner.run) this.outbound.register(source.name, runner as OutboundRunner)
  }

  private meta(key: string): string | null {
    return this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value ?? null
  }

  private setMeta(key: string, value: string) {
    this.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value)
  }

  /** The Worker's own URL, for the URLs the Hub hands out (webhook URLs). */
  noteOrigin(url: string) {
    const origin = new URL(url).origin
    if (origin !== this.meta('origin')) this.setMeta('origin', origin)
  }

  // --- HTTP: registration and the host link ---

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    this.noteOrigin(request.url)
    if (url.pathname === '/v1/host') return this.acceptHost(request, url)
    if (request.method !== 'POST') return fail('not_found', 404)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('bad_request', 400)
    }
    if (url.pathname === '/v1/hosts/register') return this.register(body)
    if (url.pathname === '/v1/hosts/invite') return this.invite(body)
    return fail('not_found', 404)
  }

  private async register(body: unknown): Promise<Response> {
    const parsed = registerRequestSchema.safeParse(body)
    if (!parsed.success) return fail('bad_request', 400)
    const { setupCode, invite, publicKey, name } = parsed.data
    if (!(await isEd25519PublicKey(publicKey))) return fail('bad_request', 400)
    const now = Date.now()
    const hostId = `h_${randomToken(16)}`

    if (setupCode !== undefined) {
      const expected = this.env.SETUP_CODE
      if (!expected) return fail('setup_not_configured', 503)
      if (!sameText(await sha256Hex(setupCode), await sha256Hex(expected))) return fail('bad_setup_code', 403)
      // The code's hash, never the code: a reset code (`wrangler secret put SETUP_CODE`) is new.
      const hash = await sha256Hex(`setup|${expected}`)
      const used = this.sql.exec('SELECT 1 FROM setup_codes WHERE hash = ?', hash).toArray()
      if (used.length) return fail('setup_code_used', 403)
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('INSERT INTO setup_codes (hash, used_at, host_id) VALUES (?, ?, ?)', hash, now, hostId)
        this.insertHost(hostId, publicKey, name, now)
      })
    } else {
      const hash = await sha256Hex(`invite|${invite}`)
      const row = this.sql.exec<{ expires_at: number; used_at: number | null }>(
        'SELECT expires_at, used_at FROM invites WHERE hash = ?',
        hash
      ).toArray()[0]
      if (!row || row.used_at !== null || row.expires_at < now) return fail('bad_invite', 403)
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('UPDATE invites SET used_at = ? WHERE hash = ?', now, hash)
        this.insertHost(hostId, publicKey, name, now)
      })
    }
    console.log(`host registered ${hostId}`)
    return json({ hostId })
  }

  private insertHost(id: string, publicKey: string, name: string, now: number) {
    this.sql.exec('INSERT INTO hosts (id, public_key, name, created_at) VALUES (?, ?, ?, ?)', id, publicKey, name, now)
  }

  private async invite(body: unknown): Promise<Response> {
    const parsed = inviteRequestSchema.safeParse(body)
    if (!parsed.success) return fail('bad_request', 400)
    const { hostId, at, signature } = parsed.data
    const host = this.host(hostId)
    if (!host) return fail('unknown_host', 403)
    const now = Date.now()
    if (Math.abs(now - at) > limits.signedRequestSkewMs) return fail('bad_signature', 403)
    if (!(await verifyEd25519(host.public_key, signature, inviteSigningText(hostId, at)))) return fail('bad_signature', 403)
    const invite = `inv_${randomToken(24)}`
    const expiresAt = now + limits.hostInviteTtlMs
    this.sql.exec(
      'INSERT INTO invites (hash, by_host, expires_at) VALUES (?, ?, ?)',
      await sha256Hex(`invite|${invite}`),
      hostId,
      expiresAt
    )
    await this.scheduleDue(PURGE_KEY, expiresAt)
    return json({ invite, expiresAt })
  }

  private host(id: string) {
    return this.sql
      .exec<{ id: string; public_key: string; hello_rev: number; last_seq: number; hello: string | null; pages_expected: number }>(
        'SELECT id, public_key, hello_rev, last_seq, hello, pages_expected FROM hosts WHERE id = ?',
        id
      )
      .toArray()[0]
  }

  /** Revokes a host: its key row goes, and its open links close with 4401. */
  async revokeHost(hostId: string): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM hosts WHERE id = ?', hostId)
      this.sql.exec('DELETE FROM bots WHERE host_id = ?', hostId)
      this.sql.exec('DELETE FROM rules WHERE host_id = ?', hostId)
      this.sql.exec('DELETE FROM devices WHERE host_id = ?', hostId)
    })
    for (const ws of this.ctx.getWebSockets(`host:${hostId}`)) ws.close(limits.closeUnauthorized, 'revoked')
  }

  private acceptHost(request: Request, url: URL): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail('bad_request', 426)
    const hostId = url.searchParams.get('hostId') ?? ''
    const { 0: client, 1: server } = new WebSocketPair()
    const nonce = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    // Accept even an unknown host, so every failure looks the same to the caller: close 4401.
    this.ctx.acceptWebSocket(server, [`host:${hostId}`])
    const attachment: HostAttachment = { kind: 'host', hostId, nonce, authed: false, helloRev: 0 }
    server.serializeAttachment(attachment)
    server.send(JSON.stringify({ ch: 'link', type: 'challenge', nonce }))
    return new Response(null, { status: 101, webSocket: client })
  }

  // --- The host link ---

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as HostAttachment | null
    if (!att || att.kind !== 'host') return ws.close(1008, 'unknown socket')
    if (typeof message !== 'string') return ws.close(1003, 'text frames only')
    if (message.length > limits.maxMessageBytes) return this.sendError(ws, 'too_large', 'message over 1 MiB')
    const parsed = parseToHub(message)

    if (!att.authed) {
      if (parsed.kind !== 'message' || parsed.message.ch !== 'link' || parsed.message.type !== 'auth') {
        return ws.close(limits.closeUnauthorized, 'auth first')
      }
      return this.authenticate(ws, att, parsed.message.signature)
    }

    if (parsed.kind === 'ignored') return
    if (parsed.kind === 'invalid') return this.sendError(ws, 'bad_message', parsed.error.slice(0, 1000))
    const msg = parsed.message
    this.sql.exec('UPDATE hosts SET last_seen_at = ? WHERE id = ?', Date.now(), att.hostId)
    if (msg.ch !== 'bots') return // link pings are auto-answered; the phone channel comes with the phone relay.
    await this.onBots(ws, att, msg)
  }

  private async authenticate(ws: WebSocket, att: HostAttachment, signature: string) {
    const host = this.host(att.hostId)
    const ok = host && att.nonce && (await verifyEd25519(host.public_key, signature, linkSigningText(att.hostId, att.nonce)))
    if (!ok) return ws.close(limits.closeUnauthorized, 'bad key')
    // A host has one link: a newer one replaces the old.
    for (const other of this.ctx.getWebSockets(`host:${att.hostId}`)) {
      if (other !== ws && (other.deserializeAttachment() as HostAttachment | null)?.authed) other.close(limits.closeReplaced, 'replaced')
    }
    ws.serializeAttachment({ ...att, nonce: null, authed: true } satisfies HostAttachment)
    ws.send(JSON.stringify({ ch: 'link', type: 'auth-ok', hostId: att.hostId }))
  }

  private async onBots(ws: WebSocket, att: HostAttachment, msg: Exclude<ToHub, { ch: 'link' | 'phone' }>) {
    switch (msg.type) {
      case 'hello':
        return this.onHello(ws, att, msg)
      case 'hello-bots':
        return this.onHelloBots(ws, att, msg)
    }
    const host = this.host(att.hostId)
    if (!host || att.helloRev === 0 || msg.helloRev !== att.helloRev || msg.helloRev !== host.hello_rev) {
      return this.sendError(ws, 'hello_required', 'send hello first', 'deliveryId' in msg ? msg.deliveryId : undefined)
    }
    switch (msg.type) {
      case 'ack':
        return this.onAck(att.hostId, msg)
      case 'events':
        return this.onEvents(att.hostId, host.last_seq, msg)
      case 'action':
        return this.onAction(ws, att.hostId, msg)
    }
  }

  private async onHello(ws: WebSocket, att: HostAttachment, hello: Hello) {
    if (hello.contract < 1) return this.sendError(ws, 'bad_message', 'unknown contract')
    const { bots, ...rest } = hello
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM bots_pending WHERE host_id = ?', att.hostId)
      for (const bot of bots) {
        this.sql.exec('INSERT OR REPLACE INTO bots_pending (host_id, page, id, body) VALUES (?, 1, ?, ?)', att.hostId, bot.id, JSON.stringify(bot))
      }
      this.sql.exec('UPDATE hosts SET hello = ?, pages_expected = ? WHERE id = ?', JSON.stringify(rest), hello.pages, att.hostId)
    })
    if (hello.pages === 1) await this.completeHello(ws, att)
  }

  private async onHelloBots(ws: WebSocket, att: HostAttachment, page: HelloBots) {
    const host = this.host(att.hostId)
    if (!host || host.pages_expected === 0 || page.page > host.pages_expected) {
      return this.sendError(ws, 'hello_required', 'hello-bots without a hello')
    }
    for (const bot of page.bots) {
      this.sql.exec(
        'INSERT OR REPLACE INTO bots_pending (host_id, page, id, body) VALUES (?, ?, ?, ?)',
        att.hostId,
        page.page,
        bot.id,
        JSON.stringify(bot)
      )
    }
    const pages = this.sql.exec<{ n: number }>('SELECT COUNT(DISTINCT page) AS n FROM bots_pending WHERE host_id = ?', att.hostId).one().n
    if (pages >= host.pages_expected) await this.completeHello(ws, att)
  }

  /** All pages are in: the host's bots and rules become these, and a new `helloRev` starts. */
  private async completeHello(ws: WebSocket, att: HostAttachment) {
    const hostId = att.hostId
    const hello = JSON.parse(this.host(hostId)?.hello ?? '{}') as Omit<Hello, 'bots'>
    let helloRev = 0
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM bots WHERE host_id = ?', hostId)
      // A bot listed by this host's latest hello is this host's, wherever it was before.
      this.sql.exec('DELETE FROM bots WHERE id IN (SELECT id FROM bots_pending WHERE host_id = ?)', hostId)
      this.sql.exec('INSERT INTO bots (id, host_id, body) SELECT id, host_id, body FROM bots_pending WHERE host_id = ?', hostId)
      this.sql.exec('DELETE FROM bots_pending WHERE host_id = ?', hostId)
      this.sql.exec('DELETE FROM rules WHERE host_id = ?', hostId)
      for (const rule of hello.rules ?? []) {
        this.sql.exec('INSERT OR REPLACE INTO rules (host_id, id, body) VALUES (?, ?, ?)', hostId, rule.id, JSON.stringify(rule))
      }
      this.sql.exec('UPDATE hosts SET hello_rev = hello_rev + 1, last_seq = -1, pages_expected = 0 WHERE id = ?', hostId)
      helloRev = this.sql.exec<{ r: number }>('SELECT hello_rev AS r FROM hosts WHERE id = ?', hostId).one().r
    })
    ws.serializeAttachment({ ...att, helloRev } satisfies HostAttachment)
    const unsettled = this.openDeliveries(hostId).map((d) => d.id)
    const features = HUB_FEATURES.filter((f) => (hello.features ?? []).includes(f))
    ws.send(JSON.stringify({ ch: 'bots', type: 'hello-ok', helloRev, features, unsettled }))
    await this.sendDeliveries(hostId)
  }

  private onAck(hostId: string, ack: Ack) {
    const now = Date.now()
    const row = this.sql.exec<{ state: DeliveryState; host_id: string | null }>(
      'SELECT state, host_id FROM deliveries WHERE id = ?',
      ack.deliveryId
    ).toArray()[0]
    if (!row || row.state === 'done' || (row.host_id !== null && row.host_id !== hostId)) return
    if (ack.step === 'received') {
      this.sql.exec("UPDATE deliveries SET state = 'received', received_at = ? WHERE id = ?", now, ack.deliveryId)
      this.sql.exec('DELETE FROM due WHERE key = ?', `lease:${ack.deliveryId}`)
      return
    }
    const outcome = ack.outcome ?? 'accepted'
    this.finish(ack.deliveryId, outcome, now)
    if (outcome === 'refused' || outcome === 'unsupported') {
      const delivery = this.deliveryBody(ack.deliveryId)
      if (delivery) {
        for (const source of this.sources) source.onSettled(delivery, outcome, ack.failure)
        void this.outbound.drainSoon()
      }
    }
  }

  private deliveryBody(id: string): Delivery | null {
    const row = this.sql.exec<{ body: string }>('SELECT body FROM deliveries WHERE id = ?', id).toArray()[0]
    return row ? (JSON.parse(row.body) as Delivery) : null
  }

  private finish(id: string, outcome: string, now: number) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE deliveries SET state = 'done', outcome = ?, done_at = ? WHERE id = ?", outcome, now, id)
      this.sql.exec('DELETE FROM due WHERE key IN (?, ?)', `lease:${id}`, `expire:${id}`)
    })
    void this.scheduleDue(PURGE_KEY, now + limits.retentionMs)
  }

  private onEvents(hostId: string, lastSeq: number, batch: Events) {
    // A retried batch changes nothing.
    if (batch.seq <= lastSeq) return
    const now = Date.now()
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('UPDATE hosts SET last_seq = ? WHERE id = ?', batch.seq, hostId)
      for (const raw of batch.events) {
        const parsed = botEventSchema.safeParse(raw)
        if (!parsed.success) continue // an unknown kind is skipped, not the batch
        const event = parsed.data
        switch (event.kind) {
          case 'snapshot':
            this.sql.exec('DELETE FROM conversations WHERE host_id = ?', hostId)
            for (const c of event.conversations) this.link(hostId, c.conversation, c.sessionId, c.botId, now)
            break
          case 'linked':
            this.link(hostId, event.conversation, event.sessionId, event.botId, now)
            break
          case 'unlinked':
          case 'chat-gone':
            this.sql.exec(
              'DELETE FROM conversations WHERE source = ? AND external_id = ? AND host_id = ?',
              event.conversation.source,
              event.conversation.externalId,
              hostId
            )
            break
          default:
            break
        }
        // Replies, prompts and status go to the source the conversation is in.
        for (const source of this.sources) source.onEvent(event)
      }
    })
    void this.outbound.drainSoon()
  }

  private link(hostId: string, c: { source: string; externalId: string }, sessionId: string, botId: string, now: number) {
    this.sql.exec(
      'INSERT OR REPLACE INTO conversations (source, external_id, host_id, session_id, bot_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      c.source,
      c.externalId,
      hostId,
      sessionId,
      botId,
      now
    )
  }

  private async onAction(ws: WebSocket, hostId: string, action: Action) {
    const answer = (body: { ok: boolean; result?: unknown; error?: { code: string; message: string } }) =>
      ws.send(JSON.stringify({ ch: 'bots', type: 'action-result', reqId: action.reqId, ...body }))
    if (action.verb === 'capabilities') {
      const verbs = new Set<string>(['capabilities'])
      for (const source of this.sources) for (const verb of source.verbs) verbs.add(verb)
      return answer({ ok: true, result: { contract: CONTRACT_VERSION, verbs: [...verbs], sources: [...configuredSources(this.env), 'webhook'] } })
    }
    const sourceName = action.verb.startsWith('webhook.')
      ? 'webhook'
      : action.ref
        ? parseRef(action.ref)?.source
        : typeof action.args.source === 'string'
          ? action.args.source
          : undefined
    const source = this.sources.find((s) => s.name === sourceName)
    if (!source?.action || !source.verbs.includes(action.verb)) {
      return answer({ ok: false, error: { code: 'unsupported', message: `${action.verb} is not available${sourceName ? ` for ${sourceName}` : ''} on this relay` } })
    }
    try {
      const outcome = await source.action(action, { hostId })
      answer(outcome.ok ? { ok: true, result: outcome.result } : { ok: false, error: outcome.error })
    } catch (error) {
      answer({ ok: false, error: { code: 'failed', message: (error instanceof Error ? error.message : String(error)).slice(0, 1000) } })
    }
    void this.outbound.drainSoon()
  }

  private sendError(ws: WebSocket, code: string, message: string, about?: string | number) {
    ws.send(JSON.stringify({ ch: 'bots', type: 'error', code, message, ...(about === undefined ? {} : { about }) }))
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Leased deliveries stay leased; the lease alarm or the next hello re-sends them.
    try {
      ws.close(code === 1005 ? 1000 : code, reason)
    } catch {
      // already closed
    }
  }

  override async webSocketError(): Promise<void> {}

  // --- Deliveries ---

  /**
   * Queues a delivery for its bot's host. The id is the dedupe key: the same id twice is one
   * delivery. Source routes call this after Who can ask; tests call it directly.
   */
  async enqueue(input: DeliveryInput): Promise<{ id: string; created: boolean }> {
    const wait = LONG_WAIT_KINDS.includes(input.kind) ? limits.requestWaitMs : limits.deliveryTtlMs
    const delivery = deliverySchema.parse({ ...input, expiresAt: input.expiresAt ?? input.askedAt + wait })
    const now = Date.now()
    const inserted = this.sql.exec(
      `INSERT OR IGNORE INTO deliveries (id, bot_id, kind, body, state, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      delivery.id,
      delivery.botId,
      delivery.kind,
      JSON.stringify(delivery),
      now,
      delivery.expiresAt
    ).rowsWritten
    if (!inserted) return { id: delivery.id, created: false }
    await this.scheduleDue(`expire:${delivery.id}`, delivery.expiresAt)
    const hostId = this.hostOfBot(delivery.botId)
    if (hostId) await this.sendDeliveries(hostId, [delivery.id])
    return { id: delivery.id, created: true }
  }

  /** A delivery's state, for tests and later for Zomfy's status view. */
  async deliveryState(id: string) {
    return (
      this.sql
        .exec<{ state: DeliveryState; outcome: string | null; attempts: number; host_id: string | null }>(
          'SELECT state, outcome, attempts, host_id FROM deliveries WHERE id = ?',
          id
        )
        .toArray()[0] ?? null
    )
  }

  private hostOfBot(botId: string): string | null {
    return this.sql.exec<{ host_id: string }>('SELECT host_id FROM bots WHERE id = ?', botId).toArray()[0]?.host_id ?? null
  }

  private openDeliveries(hostId: string, only?: string[]) {
    const rows = this.sql
      .exec<{ id: string; body: string; state: DeliveryState }>(
        `SELECT d.id, d.body, d.state FROM deliveries d JOIN bots b ON b.id = d.bot_id
         WHERE b.host_id = ? AND d.state != 'done' AND d.expires_at > ? ORDER BY d.created_at, d.id`,
        hostId,
        Date.now()
      )
      .toArray()
    return only ? rows.filter((r) => only.includes(r.id)) : rows
  }

  /** The host's live link, if it has said hello on it. */
  private linkOf(hostId: string): { ws: WebSocket; helloRev: number } | null {
    for (const ws of this.ctx.getWebSockets(`host:${hostId}`)) {
      const att = ws.deserializeAttachment() as HostAttachment | null
      if (att?.authed && att.helloRev > 0) return { ws, helloRev: att.helloRev }
    }
    return null
  }

  /** Sends the host's open deliveries (or only some), leasing each for `leaseMs`. */
  private async sendDeliveries(hostId: string, only?: string[]) {
    const link = this.linkOf(hostId)
    if (!link) return
    const rows = this.openDeliveries(hostId, only)
    if (!rows.length) return
    const now = Date.now()
    const leaseUntil = now + limits.leaseMs
    let batch: string[] = []
    let bytes = 0
    const flush = () => {
      if (!batch.length) return
      link.ws.send(`{"ch":"bots","type":"delivery","helloRev":${link.helloRev},"deliveries":[${batch.join(',')}]}`)
      batch = []
      bytes = 0
    }
    for (const row of rows) {
      const size = new TextEncoder().encode(row.body).length
      if (batch.length >= limits.maxDeliveriesPerMessage || (batch.length && bytes + size > limits.maxMessageBytes - 1024)) flush()
      batch.push(row.body)
      bytes += size
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "UPDATE deliveries SET state = 'leased', host_id = ?, sent_at = ?, attempts = attempts + 1 WHERE id = ?",
          hostId,
          now,
          row.id
        )
        this.sql.exec('INSERT OR REPLACE INTO due (key, at) VALUES (?, ?)', `lease:${row.id}`, leaseUntil)
      })
    }
    flush()
    await this.armAlarm(leaseUntil)
  }

  // --- Timers: one alarm, set to the earliest row in `due` ---

  private async scheduleDue(key: string, at: number) {
    if (key === PURGE_KEY) {
      const current = this.sql.exec<{ at: number }>('SELECT at FROM due WHERE key = ?', key).toArray()[0]
      if (current && current.at <= at) return
    }
    this.sql.exec('INSERT OR REPLACE INTO due (key, at) VALUES (?, ?)', key, at)
    await this.armAlarm(at)
  }

  private async armAlarm(at: number) {
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current > at) await this.ctx.storage.setAlarm(at)
  }

  override async alarm(): Promise<void> {
    const now = Date.now()
    const due = this.sql.exec<{ key: string; at: number }>('SELECT key, at FROM due WHERE at <= ? ORDER BY at', now).toArray()
    const resend = new Map<string, string[]>()
    for (const { key } of due) {
      this.sql.exec('DELETE FROM due WHERE key = ?', key)
      const [what, ...rest] = key.split(':')
      const id = rest.join(':')
      if (what === 'expire') this.expire(id, now)
      else if (what === 'lease') {
        const row = this.sql.exec<{ state: DeliveryState; host_id: string | null; expires_at: number }>(
          'SELECT state, host_id, expires_at FROM deliveries WHERE id = ?',
          id
        ).toArray()[0]
        if (!row || row.state !== 'leased' || row.expires_at <= now) continue
        // No `received` within the lease: re-send with the same id, or wait for the next hello.
        const hostId = this.hostOfBot(this.botOf(id) ?? '')
        if (hostId && this.linkOf(hostId)) resend.set(hostId, [...(resend.get(hostId) ?? []), id])
        else this.sql.exec("UPDATE deliveries SET state = 'pending' WHERE id = ?", id)
      } else if (what === PURGE_KEY) this.purge(now)
      // OUTBOUND_DUE: the outbound queue runs below, after every alarm. Sources may keep timers of their own.
      else if (what !== OUTBOUND_DUE && !(await this.sourceTimer(what ?? '', id, now))) console.log(`unknown timer ${what}`)
    }
    for (const [hostId, ids] of resend) await this.sendDeliveries(hostId, ids)
    await this.outbound.drain()
    const next = this.sql.exec<{ at: number }>('SELECT MIN(at) AS at FROM due').one().at
    if (next !== null) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1))
  }

  private botOf(id: string): string | null {
    return this.sql.exec<{ bot_id: string }>('SELECT bot_id FROM deliveries WHERE id = ?', id).toArray()[0]?.bot_id ?? null
  }

  private expire(id: string, now: number) {
    const row = this.sql.exec<{ state: DeliveryState; kind: string }>('SELECT state, kind FROM deliveries WHERE id = ?', id).toArray()[0]
    if (!row || row.state === 'done') return
    this.finish(id, 'expired', now)
    // The delivery is settled here exactly once, so the asker is told once.
    const delivery = this.deliveryBody(id)
    if (delivery) for (const source of this.sources) source.onSettled(delivery, 'expired')
    console.log(`delivery expired ${id} (${row.kind})`)
  }

  private purge(now: number) {
    const before = now - limits.retentionMs
    this.sql.exec("DELETE FROM deliveries WHERE state = 'done' AND done_at < ?", before)
    this.sql.exec('DELETE FROM seen_events WHERE at < ?', before)
    this.outbound.purge(before)
    for (const source of this.sources) source.purge(before)
    this.sql.exec('DELETE FROM invites WHERE expires_at < ?', now - DAY_MS)
    const left = this.sql.exec<{ n: number }>(
      "SELECT (SELECT COUNT(*) FROM deliveries WHERE state = 'done') + (SELECT COUNT(*) FROM invites) + (SELECT COUNT(*) FROM seen_events) AS n"
    ).one().n
    if (left) this.sql.exec('INSERT OR REPLACE INTO due (key, at) VALUES (?, ?)', PURGE_KEY, now + DAY_MS)
  }

  // --- Discord (docs/specs/bots/sources/discord.md) ---

  /** A message the Gateway object forwarded. */
  async discordMessage(message: GatewayMessage, selfId: string): Promise<void> {
    await this.discord.onMessage(message, selfId)
  }

  /** A verified HTTP interaction; returns the interaction response. */
  async discordInteraction(body: unknown): Promise<unknown> {
    return this.discord.onInteraction(body)
  }

  // --- Slack (docs/specs/bots/sources/slack.md) ---

  /** A verified Events API callback; returns within Slack's 3 s while the work goes on. */
  async slackEvent(body: unknown): Promise<void> {
    await within(this.slack.onEventCallback(body), 2000)
  }

  /** A verified Block Kit press; Slack's 200 goes out at once, the work after. */
  async slackInteraction(payload: unknown): Promise<void> {
    await within(
      this.slack.onInteraction(payload).then(() => this.outbound.drain()),
      2000
    )
  }

  // --- GitHub (docs/specs/bots/sources/github.md) ---

  /** A verified App webhook; returns well within GitHub's 10 s while the work goes on. */
  async githubWebhook(event: string, deliveryId: string, payload: unknown): Promise<void> {
    await within(this.github.onWebhook(event, deliveryId, payload), 5000)
  }

  // --- Linear (docs/specs/bots/sources/linear.md) ---

  /** A verified Linear webhook; returns within Linear's 5 s while the work goes on. */
  async linearWebhook(deliveryId: string, payload: unknown): Promise<void> {
    await within(this.linear.onWebhook(deliveryId, payload), 3000)
  }

  // --- Webhooks (docs/specs/bots/sources/webhooks.md) ---

  /** A call to `/hooks/<hookId>`; the answer goes back to the caller. */
  async webhookCall(call: IncomingCall): Promise<CallAnswer> {
    return this.webhooks.onCall(call)
  }

  /** Runs the outbound queue now, for tests. */
  async drainOutbound(): Promise<void> {
    await this.outbound.drain()
  }

  async outboundRows(): Promise<{ key: string; source: string; kind: string; state: string }[]> {
    return this.outbound.rows()
  }

  /** A timer a source keeps in `due` (`<what>:<id>`); false when no source knows it. */
  private async sourceTimer(what: string, id: string, now: number): Promise<boolean> {
    for (const source of this.sources) {
      if (source.onTimer && (await source.onTimer(what, id, now))) return true
    }
    return false
  }

  private allBots(): HelloBot[] {
    return this.sql.exec<{ body: string }>('SELECT body FROM bots ORDER BY id').toArray().map((r) => JSON.parse(r.body) as HelloBot)
  }

  private allRules(): Rule[] {
    return this.sql
      .exec<{ body: string }>('SELECT body FROM rules ORDER BY host_id, id')
      .toArray()
      .flatMap((r) => {
        const parsed = ruleSchema.safeParse(JSON.parse(r.body))
        return parsed.success ? [parsed.data] : []
      })
  }

  /** Dedupe on a source's event id: true the first time within 7 days. */
  private markSeen(key: string): boolean {
    const now = Date.now()
    const written = this.sql.exec('INSERT OR IGNORE INTO seen_events (key, at) VALUES (?, ?)', key, now).rowsWritten
    if (written) void this.scheduleDue(PURGE_KEY, now + limits.retentionMs)
    return written > 0
  }

  /** Every row of every table, for the secret-leak test. */
  async dumpStorage(): Promise<string> {
    const tables = this.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'").toArray()
    return JSON.stringify(tables.map(({ name }) => ({ name, rows: this.sql.exec(`SELECT * FROM "${name}"`).toArray() })))
  }

  /** Hello as last stored, for tests. */
  async hostSummary(hostId: string) {
    const host = this.host(hostId)
    if (!host) return null
    const bots = this.sql.exec<{ id: string }>('SELECT id FROM bots WHERE host_id = ? ORDER BY id', hostId).toArray()
    const rules = this.sql.exec<{ id: string }>('SELECT id FROM rules WHERE host_id = ? ORDER BY id', hostId).toArray()
    const conversations = this.sql.exec<{ external_id: string; session_id: string }>(
      'SELECT external_id, session_id FROM conversations WHERE host_id = ? ORDER BY external_id',
      hostId
    ).toArray()
    return { helloRev: host.hello_rev, lastSeq: host.last_seq, bots: bots.map((b) => b.id), rules: rules.map((r) => r.id), conversations }
  }
}
