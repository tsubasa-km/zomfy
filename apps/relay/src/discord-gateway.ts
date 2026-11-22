import { DurableObject } from 'cloudflare:workers'
import { COMMANDS, discordCall, discordFetcher, GATEWAY_INTENTS } from './discord/api'
import type { GatewayMessage } from './discord/source'
import { configuredSources, type Env } from './env'

/** Gateway opcodes. */
const Op = { Dispatch: 0, Heartbeat: 1, Identify: 2, Resume: 6, Reconnect: 7, InvalidSession: 9, Hello: 10, HeartbeatAck: 11 } as const
/** Close codes after which identifying again cannot help until the secrets change. */
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014])
/** Close codes after which the session cannot be resumed. */
const NO_RESUME_CLOSE = new Set([4007, 4009])
const RETRY_FATAL_MS = 10 * 60 * 1000
const HELLO_TIMEOUT_MS = 30 * 1000
const SEQ_SAVE_MS = 10 * 1000

interface Session {
  sessionId: string
  resumeUrl: string
  seq: number | null
}

export interface GatewayStatus {
  state: 'off' | 'connecting' | 'ready' | 'failed'
  /** Seconds since the current connection became ready; absent when not ready. */
  uptimeSeconds?: number
  /** Seconds since this object last started holding the Gateway. */
  heldSeconds?: number
  reconnects: number
  lastError?: string
}

/**
 * Holds the Discord Gateway connection, which cannot hibernate, and forwards message events to the
 * Hub (docs/specs/bots/sources/discord.md#receiving-messages): mentions of the app, DMs to it, and
 * messages in threads the Hub watches; everything else is dropped unread. Its alarm is the
 * heartbeat and the watchdog, so after an eviction or a deploy the alarm brings the connection
 * back and resumes the session.
 */
export class DiscordGateway extends DurableObject<Env> {
  private ws: WebSocket | null = null
  private connecting = false
  private heartbeatMs = 41_250
  private acked = true
  private seq: number | null = null
  private seqSavedAt = 0
  private readyAt: number | null = null
  private heldSince: number | null = null
  private reconnects = 0
  private backoffMs = 1000
  private lastError: string | undefined
  private selfId: string | null = null
  private forwarding: Promise<void> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS watched (channel_id TEXT PRIMARY KEY, at INTEGER NOT NULL)')
  }

  private get kv() {
    return this.ctx.storage.kv
  }

  private configured() {
    return configuredSources(this.env).includes('discord')
  }

  // --- RPC ---

  /** Starts holding the Gateway if it is not held; cheap when it is. */
  async ensure(): Promise<void> {
    if (!this.configured() || this.ws || this.connecting) return
    const fatal = this.kv.get<{ at: number; code: number }>('fatal')
    if (fatal && Date.now() - fatal.at < RETRY_FATAL_MS) return
    await this.openGateway()
  }

  async status(): Promise<GatewayStatus> {
    const t = Date.now()
    const fatal = this.kv.get<{ at: number; code: number }>('fatal')
    const state = this.readyAt ? 'ready' : this.ws || this.connecting ? 'connecting' : fatal ? 'failed' : 'off'
    return {
      state,
      ...(this.readyAt ? { uptimeSeconds: Math.floor((t - this.readyAt) / 1000) } : {}),
      ...(this.heldSince ? { heldSeconds: Math.floor((t - this.heldSince) / 1000) } : {}),
      reconnects: this.reconnects,
      ...(this.lastError ? { lastError: this.lastError } : {})
    }
  }

  /** The Hub watches the threads and channels its conversations live in. */
  async watch(channelId: string, watch: boolean): Promise<void> {
    if (watch) this.ctx.storage.sql.exec('INSERT OR REPLACE INTO watched (channel_id, at) VALUES (?, ?)', channelId, Date.now())
    else this.ctx.storage.sql.exec('DELETE FROM watched WHERE channel_id = ?', channelId)
  }

  /** For tests: the session as stored. */
  async session(): Promise<Session | null> {
    return this.kv.get<Session>('session') ?? null
  }

  // --- The connection ---

  private async openGateway() {
    this.connecting = true
    try {
      const session = this.kv.get<Session>('session')
      let url = session?.resumeUrl
      if (!url) {
        const res = await discordCall<{ url: string }>(this.env, 'GET', '/gateway/bot')
        if (!res.ok || !res.body?.url) {
          if (res.status === 401) return this.fatal(4004, 'the bot token was refused')
          return this.retryLater(`GET /gateway/bot ${res.status}`)
        }
        url = res.body.url
      }
      const target = new URL(url)
      target.searchParams.set('v', '10')
      target.searchParams.set('encoding', 'json')
      target.protocol = target.protocol === 'ws:' ? 'http:' : 'https:'
      const response = await discordFetcher(this.env)(new Request(target.toString(), { headers: { Upgrade: 'websocket' } }))
      const ws = response.webSocket
      if (!ws) return this.retryLater(`Gateway upgrade ${response.status}`)
      ws.accept()
      this.ws = ws
      this.heldSince ??= Date.now()
      this.acked = true
      this.seq = session?.seq ?? null
      ws.addEventListener('message', (event) => {
        if (this.ws === ws && typeof event.data === 'string') this.onFrame(ws, event.data)
      })
      ws.addEventListener('close', (event) => {
        if (this.ws === ws) this.onClosed(event.code, event.reason)
      })
      ws.addEventListener('error', () => {
        if (this.ws === ws) this.onClosed(1006, 'socket error')
      })
      // HELLO should come at once; if not, the watchdog reconnects.
      await this.ctx.storage.setAlarm(Date.now() + HELLO_TIMEOUT_MS)
    } catch (error) {
      await this.retryLater(error instanceof Error ? error.message : String(error))
    } finally {
      this.connecting = false
    }
  }

  private send(ws: WebSocket, op: number, d: unknown) {
    try {
      ws.send(JSON.stringify({ op, d }))
    } catch {
      // the close handler reconnects
    }
  }

  private onFrame(ws: WebSocket, data: string) {
    let frame: { op: number; d: any; s?: number | null; t?: string | null }
    try {
      frame = JSON.parse(data)
    } catch {
      return
    }
    if (typeof frame.s === 'number') this.seq = frame.s
    switch (frame.op) {
      case Op.Hello: {
        this.heartbeatMs = Number(frame.d?.heartbeat_interval) || 41_250
        const session = this.kv.get<Session>('session')
        const token = this.env.DISCORD_BOT_TOKEN ?? ''
        if (session) this.send(ws, Op.Resume, { token, session_id: session.sessionId, seq: this.seq ?? session.seq ?? 0 })
        else
          this.send(ws, Op.Identify, {
            token,
            intents: GATEWAY_INTENTS,
            properties: { os: 'cloudflare', browser: 'zomfy-relay', device: 'zomfy-relay' }
          })
        // The first heartbeat after interval × jitter, as Discord asks.
        void this.ctx.storage.setAlarm(Date.now() + Math.max(50, Math.floor(this.heartbeatMs * Math.random())))
        return
      }
      case Op.Heartbeat:
        return this.send(ws, Op.Heartbeat, this.seq)
      case Op.HeartbeatAck:
        this.acked = true
        return
      case Op.Reconnect:
        return this.drop(ws, 4000, 'reconnect asked', true)
      case Op.InvalidSession:
        if (!frame.d) this.kv.delete('session')
        return this.drop(ws, 4000, 'invalid session', Boolean(frame.d), frame.d ? 0 : 1000 + Math.floor(Math.random() * 4000))
      case Op.Dispatch:
        return this.onDispatch(frame.t ?? '', frame.d)
    }
  }

  private onDispatch(type: string, d: any) {
    if (type === 'READY') {
      this.selfId = d?.user?.id ?? null
      this.kv.put('session', { sessionId: d.session_id, resumeUrl: d.resume_gateway_url, seq: this.seq } satisfies Session)
      if (this.selfId) this.kv.put('selfId', this.selfId)
      this.ready()
      this.ctx.waitUntil(this.registerCommands())
      return
    }
    if (type === 'RESUMED') {
      this.ready()
      return
    }
    this.saveSeq()
    if (type !== 'MESSAGE_CREATE' || !d?.author) return
    const selfId = this.selfId ?? this.kv.get<string>('selfId') ?? this.env.DISCORD_APPLICATION_ID ?? ''
    if (!this.wanted(d, selfId)) return
    const message: GatewayMessage = {
      id: d.id,
      channel_id: d.channel_id,
      ...(d.guild_id ? { guild_id: d.guild_id } : {}),
      author: { id: d.author.id, username: d.author.username ?? '', global_name: d.author.global_name ?? null, bot: Boolean(d.author.bot) },
      content: String(d.content ?? ''),
      timestamp: d.timestamp,
      attachments: Array.isArray(d.attachments)
        ? d.attachments.map((a: any) => ({ url: a.url, filename: a.filename, content_type: a.content_type, size: a.size }))
        : []
    }
    this.saveSeq(true)
    // In order, one at a time, so a thread's messages reach the Hub as they were sent.
    this.forwarding = this.forwarding.then(() => this.forward(message, selfId))
    this.ctx.waitUntil(this.forwarding)
  }

  /** Mentions, DMs, and messages in watched threads; the rest is dropped unread. */
  private wanted(d: any, selfId: string): boolean {
    if (d.author.bot || d.author.id === selfId) return false
    if (!d.guild_id) return true
    if (Array.isArray(d.mentions) && d.mentions.some((m: any) => m?.id === selfId)) return true
    if (typeof d.content === 'string' && new RegExp(`<@!?${selfId}>`).test(d.content)) return true
    return this.ctx.storage.sql.exec('SELECT 1 FROM watched WHERE channel_id = ?', d.channel_id).toArray().length > 0
  }

  private async forward(message: GatewayMessage, selfId: string) {
    try {
      await this.env.HUB.get(this.env.HUB.idFromName('hub')).discordMessage(message, selfId)
    } catch (error) {
      console.log(`discord message not forwarded: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private saveSeq(force = false) {
    const t = Date.now()
    if (!force && t - this.seqSavedAt < SEQ_SAVE_MS) return
    const session = this.kv.get<Session>('session')
    if (!session) return
    this.seqSavedAt = t
    this.kv.put('session', { ...session, seq: this.seq })
  }

  private ready() {
    this.readyAt = Date.now()
    this.backoffMs = 1000
    this.lastError = undefined
    this.kv.delete('fatal')
  }

  private async registerCommands() {
    const app = this.env.DISCORD_APPLICATION_ID
    if (!app) return
    const version = JSON.stringify(COMMANDS)
    if (this.kv.get<string>('commands') === version) return
    const res = await discordCall(this.env, 'PUT', `/applications/${app}/commands`, { body: COMMANDS })
    if (res.ok) this.kv.put('commands', version)
    else console.log(`registering /ask failed: ${res.status}`)
  }

  private onClosed(code: number, reason: string) {
    this.ws = null
    this.readyAt = null
    this.lastError = `closed ${code}${reason ? ` ${reason}` : ''}`
    if (FATAL_CLOSE.has(code)) return void this.fatal(code, reason)
    if (NO_RESUME_CLOSE.has(code)) this.kv.delete('session')
    void this.reconnectIn()
  }

  /** Closes the socket ourselves and reconnects, resuming or identifying again. */
  private drop(ws: WebSocket, code: number, reason: string, resume: boolean, delayMs?: number) {
    this.saveSeq(true)
    if (!resume) this.kv.delete('session')
    this.ws = null
    this.readyAt = null
    try {
      ws.close(code, reason)
    } catch {
      // already closed
    }
    void this.reconnectIn(delayMs ?? 0)
  }

  private async reconnectIn(ms = this.backoffMs) {
    this.reconnects++
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000)
    await this.ctx.storage.setAlarm(Date.now() + ms)
  }

  private async retryLater(why: string) {
    this.lastError = why
    console.log(`discord gateway: ${why}`)
    await this.reconnectIn()
  }

  private async fatal(code: number, reason: string) {
    this.lastError = `closed ${code} ${reason}`.trim()
    console.log(`discord gateway stopped: ${this.lastError}`)
    this.kv.put('fatal', { at: Date.now(), code })
    this.kv.delete('session')
    await this.ctx.storage.setAlarm(Date.now() + RETRY_FATAL_MS)
  }

  /** Heartbeat and watchdog: reconnect when nothing is held; a missed ack is a zombie link. */
  override async alarm(): Promise<void> {
    if (!this.configured()) return
    const ws = this.ws
    if (!ws) {
      if (!this.connecting) {
        this.kv.delete('fatal')
        await this.openGateway()
      }
      return
    }
    if (!this.acked) return this.drop(ws, 4000, 'heartbeat not acknowledged', true)
    this.acked = false
    this.send(ws, Op.Heartbeat, this.seq)
    await this.ctx.storage.setAlarm(Date.now() + this.heartbeatMs)
  }
}
