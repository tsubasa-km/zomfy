// The Discord source inside the Hub (docs/specs/bots/sources/discord.md): turns Gateway messages and
// HTTP interactions into deliveries for the right bot, and the daemon's events into posts, edits and
// buttons in Discord. Everything it posts goes through the `outbound` table, a FIFO per
// conversation that honours Discord's rate limits and records each post's idempotency key, so a
// retried event never posts twice.

import {
  askerRole,
  limits,
  type BotEvent,
  type ContextItem,
  type Delivery,
  type Failure,
  type HelloBot,
  type Prompt
} from '../contract'
import type { Env } from '../env'
import type { DeliveryInput } from '../hub'
import { discordCall, EPHEMERAL, InteractionType, ResponseType, THREAD_TYPES, type DiscordResult } from './api'
import {
  accessRow,
  endedText,
  MAX_REPLY_MESSAGES,
  NOTES,
  parseCustomId,
  promptMessage,
  replyText,
  shortKey,
  splitMessage,
  statusText,
  stopRow,
  threadName,
  type Row
} from './format'

export const DISCORD_SCHEMA = [
  // A conversation in Discord: where it was asked, the message to thread from or refer to, and the
  // channel replies go to (the thread, the DM, or the thread it was asked in).
  `CREATE TABLE IF NOT EXISTS discord_convs (
     external_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
     anchor_id TEXT, post_channel TEXT, needs_thread INTEGER NOT NULL, token TEXT, token_expires INTEGER,
     asker_id TEXT NOT NULL, ref_message TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS discord_convs_by_post ON discord_convs (post_channel, created_at)`,
  /** The DM channel's current conversation, until `new` or the chat is gone. */
  `CREATE TABLE IF NOT EXISTS discord_dms (channel_id TEXT PRIMARY KEY, external_id TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS discord_turns (
     n INTEGER PRIMARY KEY AUTOINCREMENT, turn_id TEXT UNIQUE NOT NULL, external_id TEXT NOT NULL,
     session_id TEXT, status_id TEXT, status_text TEXT NOT NULL, last_edit_at INTEGER NOT NULL DEFAULT 0,
     ended TEXT, replaced INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS discord_prompts (
     n INTEGER PRIMARY KEY AUTOINCREMENT, prompt_id TEXT UNIQUE NOT NULL, external_id TEXT NOT NULL,
     body TEXT NOT NULL, message_id TEXT, by_reply INTEGER NOT NULL, answered_by TEXT, cleared TEXT,
     created_at INTEGER NOT NULL)`,
  /** Messages by people who may not ask, kept as `no_access` context for the next turn. */
  `CREATE TABLE IF NOT EXISTS discord_context (
     message_id TEXT PRIMARY KEY, external_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
     text TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS outbound (
     n INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, lane TEXT NOT NULL, kind TEXT NOT NULL,
     ref TEXT, op TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
     not_before INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, done_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS outbound_pending ON outbound (state, n)`,
  `CREATE TABLE IF NOT EXISTS outbound_lanes (lane TEXT PRIMARY KEY, blocked_until INTEGER NOT NULL)`
]

export const OUTBOUND_DUE = 'discord-out'
const MAX_ATTEMPTS = 6
const CONTEXT_MESSAGES = 20
const TOKEN_TTL_MS = 15 * 60 * 1000
const GLOBAL_LANE = 'global'

/** The slice of a Gateway MESSAGE_CREATE the Gateway object forwards. */
export interface GatewayMessage {
  id: string
  channel_id: string
  guild_id?: string
  author: { id: string; username: string; global_name?: string | null; bot?: boolean }
  content: string
  timestamp?: string
  attachments?: { url: string; filename: string; content_type?: string; size?: number }[]
}

/** What the Hub gives the source. */
export interface SourceHost {
  readonly sql: SqlStorage
  readonly env: Env
  transaction(fn: () => void): void
  /** Queues a delivery (deduped by id) and sends it if the bot's host is online. */
  enqueue(delivery: DeliveryInput): Promise<unknown>
  bots(): HelloBot[]
  /** Once per key for 7 days; false when seen before. */
  markSeen(key: string): boolean
  scheduleDue(key: string, at: number): Promise<void>
  watchChannel(channelId: string, watch: boolean): Promise<void>
}

type ConvRow = {
  external_id: string
  bot_id: string
  guild_id: string
  channel_id: string
  anchor_id: string | null
  post_channel: string | null
  needs_thread: number
  token: string | null
  token_expires: number | null
  asker_id: string
  ref_message: string | null
  title: string
}

type Op =
  | { t: 'post'; conv: string; content: string; components?: Row[]; as: 'status' | 'note' | 'prompt'; turnId?: string; promptId?: string; reference?: boolean }
  | { t: 'status'; turnId: string }
  | { t: 'ended'; turnId: string; outcome: string }
  | { t: 'reply'; conv: string; turnId: string; chunks: string[]; file?: string; sent: number }
  | { t: 'prompt-edit'; promptId: string; content: string }
  | { t: 'dm'; userId: string; content: string; components?: Row[] }
  | { t: 'channel-note'; channelId: string; replyTo: string; content: string }
  | { t: 'watch'; channelId: string; watch: boolean }

type OpResult = { status: 'done' } | { status: 'wait'; ms: number; global?: boolean } | { status: 'retry' } | { status: 'fail'; why: string }

const nameOf = (u: { username: string; global_name?: string | null }) => (u.global_name || u.username).slice(0, 256)
const now = () => Date.now()

export class DiscordSource {
  private draining = false
  private again = false
  private channelTypes = new Map<string, number>()

  constructor(private readonly hub: SourceHost) {
    for (const statement of DISCORD_SCHEMA) hub.sql.exec(statement)
  }

  private get sql() {
    return this.hub.sql
  }

  private get env() {
    return this.hub.env
  }

  // --- Bots and conversations ---

  private bot(id: string): HelloBot | undefined {
    return this.hub.bots().find((b) => b.id === id)
  }

  /** The bot a message names by handle (its first word), else the default bot. */
  pickBot(text: string, handle?: string): { bot: HelloBot | null; text: string; named: boolean } {
    const bots = this.hub.bots()
    if (handle !== undefined) {
      const h = handle.replace(/^@/, '').toLowerCase()
      return { bot: bots.find((b) => b.handle === h) ?? null, text, named: true }
    }
    const match = /^\s*@?([a-z0-9][a-z0-9_-]*)\b[,:]?\s*/i.exec(text)
    const named = match ? bots.find((b) => b.handle === match[1]!.toLowerCase()) : undefined
    if (named && match) return { bot: named, text: text.slice(match[0].length), named: true }
    const fallback = bots.find((b) => b.isDefault) ?? (bots.length === 1 ? bots[0] : undefined)
    return { bot: fallback ?? null, text, named: false }
  }

  private conv(externalId: string): ConvRow | undefined {
    return this.sql.exec<ConvRow>('SELECT * FROM discord_convs WHERE external_id = ?', externalId).toArray()[0]
  }

  private convByChannel(channelId: string, dm: boolean): ConvRow | undefined {
    if (dm) {
      const pointer = this.sql.exec<{ external_id: string }>('SELECT external_id FROM discord_dms WHERE channel_id = ?', channelId).toArray()[0]
      return pointer ? this.conv(pointer.external_id) : undefined
    }
    return this.sql
      .exec<ConvRow>('SELECT * FROM discord_convs WHERE post_channel = ? ORDER BY created_at DESC LIMIT 1', channelId)
      .toArray()[0]
  }

  private insertConv(row: ConvRow) {
    this.sql.exec(
      `INSERT OR REPLACE INTO discord_convs (external_id, bot_id, guild_id, channel_id, anchor_id, post_channel, needs_thread,
         token, token_expires, asker_id, ref_message, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.external_id,
      row.bot_id,
      row.guild_id,
      row.channel_id,
      row.anchor_id,
      row.post_channel,
      row.needs_thread,
      row.token,
      row.token_expires,
      row.asker_id,
      row.ref_message,
      row.title,
      now()
    )
    if (row.guild_id === '@me') {
      this.sql.exec('INSERT OR REPLACE INTO discord_dms (channel_id, external_id) VALUES (?, ?)', row.channel_id, row.external_id)
    }
  }

  private dropConv(externalId: string) {
    const conv = this.conv(externalId)
    if (!conv) return
    this.sql.exec('DELETE FROM discord_convs WHERE external_id = ?', externalId)
    this.sql.exec('DELETE FROM discord_dms WHERE external_id = ?', externalId)
    this.sql.exec('DELETE FROM discord_context WHERE external_id = ?', externalId)
    if (conv.guild_id !== '@me' && conv.post_channel && !this.convByChannel(conv.post_channel, false)) {
      this.queue({ t: 'watch', channelId: conv.post_channel, watch: false }, `unwatch:${externalId}`, GLOBAL_LANE)
    }
  }

  private placeId(guild: string, channel: string) {
    return `discord:${guild}:${channel}`
  }

  // --- Inbound: Gateway messages ---

  /** A message the Gateway object forwarded: a mention, a DM, or one in a watched thread. */
  async onMessage(msg: GatewayMessage, selfId: string): Promise<void> {
    if (msg.author.bot || msg.author.id === selfId) return
    if (!this.hub.markSeen(`discord:msg:${msg.id}`)) return
    const dm = !msg.guild_id
    const guild = msg.guild_id ?? '@me'
    const mentioned = new RegExp(`<@!?${selfId}>`).test(msg.content)
    let text = msg.content.replace(new RegExp(`<@!?${selfId}>`, 'g'), '').trim()
    let conv = this.convByChannel(msg.channel_id, dm)

    if (dm && /^new\b/i.test(text)) {
      if (conv) this.dropConv(conv.external_id)
      conv = undefined
      text = text.replace(/^new\b[\s,:]*/i, '')
      if (!text) return
    }

    if (conv) {
      const bot = this.bot(conv.bot_id)
      if (!bot) return
      const role = askerRole(bot, 'discord', msg.author.id)
      if (role === 'other') {
        this.sql.exec(
          'INSERT OR IGNORE INTO discord_context (message_id, external_id, author_id, author_name, text, at) VALUES (?, ?, ?, ?, ?, ?)',
          msg.id,
          conv.external_id,
          msg.author.id,
          nameOf(msg.author),
          msg.content.slice(0, 4000),
          Date.parse(msg.timestamp ?? '') || now()
        )
        return
      }
      const asker = { source: 'discord' as const, id: msg.author.id, name: nameOf(msg.author), role }
      const conversation = { source: 'discord' as const, externalId: conv.external_id }
      this.sql.exec('UPDATE discord_convs SET asker_id = ?, ref_message = ? WHERE external_id = ?', msg.author.id, msg.id, conv.external_id)
      // A question answered by reply takes the asker's next message as its answer.
      const byReply = this.sql
        .exec<{ prompt_id: string }>(
          'SELECT prompt_id FROM discord_prompts WHERE external_id = ? AND by_reply = 1 AND cleared IS NULL AND answered_by IS NULL ORDER BY n DESC LIMIT 1',
          conv.external_id
        )
        .toArray()[0]
      if (byReply) {
        this.sql.exec('UPDATE discord_prompts SET answered_by = ? WHERE prompt_id = ?', msg.author.id, byReply.prompt_id)
        await this.hub.enqueue({
          id: `discord-${msg.id}`,
          kind: 'answer',
          botId: bot.id,
          conversation,
          askedAt: now(),
          asker,
          promptId: byReply.prompt_id,
          text: text.slice(0, limits.maxAnswerTextChars)
        })
        return
      }
      await this.hub.enqueue({ id: `discord-${msg.id}`, kind: 'send', botId: bot.id, conversation, askedAt: now(), asker, text, context: this.takeContext(conv.external_id) })
      return
    }

    if (!dm && !mentioned) return
    const picked = this.pickBot(text)
    if (!picked.bot) {
      this.queue({ t: 'channel-note', channelId: msg.channel_id, replyTo: msg.id, content: this.noBotNote() }, `nobot:${msg.id}`, `ch:${msg.channel_id}`)
      return this.drainSoon()
    }
    const bot = picked.bot
    const role = askerRole(bot, 'discord', msg.author.id)
    if (role === 'other') {
      this.queue(
        { t: 'dm', userId: msg.author.id, content: NOTES.askOwner(bot.name, bot.owner.discord), components: accessRow(bot.id) },
        `askowner:${msg.id}`,
        `dm:${msg.author.id}`
      )
      return this.drainSoon()
    }

    const inThread = !dm && THREAD_TYPES.has(await this.channelType(msg.channel_id))
    const externalId = `${guild}:${msg.channel_id}:${msg.id}`
    const ownThread = !dm && !inThread
    this.insertConv({
      external_id: externalId,
      bot_id: bot.id,
      guild_id: guild,
      channel_id: msg.channel_id,
      anchor_id: msg.id,
      // A thread started from a message has the message's id.
      post_channel: ownThread ? msg.id : msg.channel_id,
      needs_thread: ownThread ? 1 : 0,
      token: null,
      token_expires: null,
      asker_id: msg.author.id,
      ref_message: msg.id,
      title: threadName(picked.text)
    })
    // Watched before anything else, so a quick reply in the thread is not dropped by the Gateway.
    if (!dm) await this.hub.watchChannel(ownThread ? msg.id : msg.channel_id, true).catch(() => {})
    const context = await this.channelContext(bot, msg.channel_id, msg.id, selfId)
    await this.hub.enqueue({
      id: `discord-${msg.id}`,
      kind: 'start',
      botId: bot.id,
      conversation: { source: 'discord', externalId },
      askedAt: Date.parse(msg.timestamp ?? '') || now(),
      asker: { source: 'discord', id: msg.author.id, name: nameOf(msg.author), role },
      placeId: this.placeId(guild, msg.channel_id),
      text: picked.text,
      context,
      links: [],
      attachments: (msg.attachments ?? []).slice(0, limits.maxContextFiles).map((a) => ({
        name: a.filename.slice(0, 512),
        url: a.url,
        ...(a.content_type ? { mimeType: a.content_type } : {}),
        ...(a.size !== undefined ? { size: a.size } : {})
      }))
    })
    await this.drain()
  }

  private noBotNote() {
    const bots = this.hub.bots()
    return bots.length ? NOTES.unknownBot(bots.map((b) => b.handle)) : NOTES.noBots
  }

  private takeContext(externalId: string): ContextItem[] {
    const rows = this.sql
      .exec<{ author_id: string; author_name: string; text: string; at: number }>(
        'SELECT author_id, author_name, text, at FROM discord_context WHERE external_id = ? ORDER BY at LIMIT 20',
        externalId
      )
      .toArray()
    this.sql.exec('DELETE FROM discord_context WHERE external_id = ?', externalId)
    return rows.map((r) => ({ label: 'no_access', author: { id: r.author_id, name: r.author_name }, text: r.text, at: r.at }))
  }

  private async channelType(channelId: string): Promise<number> {
    const known = this.channelTypes.get(channelId)
    if (known !== undefined) return known
    const res = await discordCall<{ type: number }>(this.env, 'GET', `/channels/${channelId}`)
    const type = res.body?.type ?? 0
    if (res.ok) this.channelTypes.set(channelId, type)
    return type
  }

  /** Up to the last 20 messages before the request, labelled as the contract says. */
  private async channelContext(bot: HelloBot, channelId: string, before: string, selfId: string, signal?: AbortSignal): Promise<ContextItem[]> {
    const res = await discordCall<GatewayMessage[]>(this.env, 'GET', `/channels/${channelId}/messages?before=${before}&limit=${CONTEXT_MESSAGES}`, {
      signal
    })
    if (!res.ok || !Array.isArray(res.body)) return []
    return res.body
      .slice()
      .reverse()
      .filter((m) => m.content)
      .map((m) => ({
        label: m.author.id === selfId ? 'bot' : askerRole(bot, 'discord', m.author.id) === 'other' ? 'no_access' : 'earlier',
        author: { id: m.author.id, name: nameOf(m.author) },
        text: m.content.slice(0, 4000),
        at: Date.parse(m.timestamp ?? '') || undefined
      }))
  }

  // --- Inbound: HTTP interactions (the signature is checked by the Worker) ---

  /** Answers an interaction within Discord's 3 s; slow work goes to the outbound queue. */
  async onInteraction(body: any): Promise<unknown> {
    if (body?.type === InteractionType.Ping) return { type: ResponseType.Pong }
    const user = body?.member?.user ?? body?.user
    if (!user?.id) return ephemeral('Unknown user.')
    if (body.type === InteractionType.Command) return this.onCommand(body, user)
    if (body.type === InteractionType.Component) return this.onComponent(body, user)
    return ephemeral('Not supported.')
  }

  private async onCommand(body: any, user: { id: string; username: string; global_name?: string | null }) {
    if (!this.hub.markSeen(`discord:int:${body.id}`)) return { type: ResponseType.DeferredUpdate }
    const data = body.data ?? {}
    const guild: string = body.guild_id ?? '@me'
    const channelId: string = body.channel_id ?? body.channel?.id
    const channelType: number = body.channel?.type ?? (body.guild_id ? 0 : 1)
    let text: string
    let picked: ReturnType<DiscordSource['pickBot']>
    let anchor: string | null = null
    if (data.type === 3) {
      // The message command "Ask bot": the target message is the request.
      const target = data.resolved?.messages?.[data.target_id]
      text = String(target?.content ?? '').replace(/<@!?\d+>/g, '').trim()
      picked = this.pickBot(text)
      anchor = target?.id ?? data.target_id ?? null
    } else {
      const option = (name: string) => (data.options ?? []).find((o: any) => o.name === name)?.value as string | undefined
      text = option('prompt') ?? ''
      const handle = option('bot')
      picked = this.pickBot(text, handle?.trim() || undefined)
    }
    if (!picked.bot) return ephemeral(this.noBotNote())
    const bot = picked.bot
    const role = askerRole(bot, 'discord', user.id)
    if (role === 'other') return ephemeral(NOTES.askOwner(bot.name, bot.owner.discord), accessRow(bot.id))

    const dm = guild === '@me'
    const inThread = THREAD_TYPES.has(channelType)
    const ownThread = !dm && !inThread
    const externalId = `${guild}:${channelId}:i${body.id}`
    this.insertConv({
      external_id: externalId,
      bot_id: bot.id,
      guild_id: guild,
      channel_id: channelId,
      anchor_id: anchor,
      post_channel: ownThread ? anchor : channelId,
      needs_thread: ownThread ? 1 : 0,
      token: anchor || !ownThread ? null : body.token,
      token_expires: now() + TOKEN_TTL_MS,
      asker_id: user.id,
      ref_message: anchor,
      title: threadName(picked.text)
    })
    if (!dm && (anchor || !ownThread)) {
      const watched = ownThread ? anchor! : channelId
      await this.hub.watchChannel(watched, true).catch(() => {})
    }
    const context = anchor ? [] : await this.channelContext(bot, channelId, body.id, String(body.application_id ?? ''), AbortSignal.timeout(800)).catch(() => [])
    await this.hub.enqueue({
      id: `discord-i${body.id}`,
      kind: 'start',
      botId: bot.id,
      conversation: { source: 'discord', externalId },
      askedAt: now(),
      asker: { source: 'discord', id: user.id, name: nameOf(user), role },
      placeId: this.placeId(guild, channelId),
      text: picked.text,
      context,
      links: [],
      attachments: []
    })
    void this.drainSoon()
    if (anchor) return ephemeral(NOTES.asked(bot.name))
    // The reply to `/ask` is the message the conversation's thread starts from.
    return {
      type: ResponseType.Message,
      data: { content: `<@${user.id}> asked **${bot.name}**: ${picked.text}`.slice(0, 2000), allowed_mentions: { parse: [] } }
    }
  }

  private async onComponent(body: any, user: { id: string; username: string; global_name?: string | null }) {
    const parsed = parseCustomId(String(body.data?.custom_id ?? ''))
    if (!parsed) return ephemeral('This button is no longer active.')

    if (parsed.kind === 'access') {
      const bot = this.bot(parsed.botId)
      if (!bot) return ephemeral('This bot is gone.')
      await this.hub.enqueue({
        id: `discord-access-${bot.id}-${user.id}`,
        kind: 'access_request',
        botId: bot.id,
        conversation: { source: 'discord', externalId: `access:${user.id}` },
        askedAt: now(),
        requester: { source: 'discord', id: user.id, name: nameOf(user) }
      })
      return { type: ResponseType.UpdateMessage, data: { content: NOTES.accessRequested, components: [] } }
    }

    if (parsed.kind === 'stop') {
      const turn = this.turnByKey(parsed.turnKey)
      const conv = turn && this.conv(turn.external_id)
      const bot = conv && this.bot(conv.bot_id)
      if (!turn || !conv || !bot || turn.ended) return ephemeral('This turn has ended.')
      const role = askerRole(bot, 'discord', user.id)
      if (user.id !== conv.asker_id && role !== 'owner') return ephemeral(NOTES.onlyAsker(conv.asker_id))
      await this.hub.enqueue({
        id: `discord-stop-${turn.turn_id}`,
        kind: 'cancel',
        botId: bot.id,
        conversation: { source: 'discord', externalId: conv.external_id },
        askedAt: now(),
        asker: { source: 'discord', id: user.id, name: nameOf(user), role },
        turnId: turn.turn_id
      })
      this.sql.exec('UPDATE discord_turns SET status_text = ? WHERE turn_id = ?', NOTES.stopping, turn.turn_id)
      this.queueStatusEdit(turn.turn_id, 0)
      void this.drainSoon()
      return { type: ResponseType.DeferredUpdate }
    }

    const prompt = this.promptByKey(parsed.promptKey)
    const conv = prompt && this.conv(prompt.external_id)
    const bot = conv && this.bot(conv.bot_id)
    if (!prompt || !conv || !bot) return ephemeral('This question is no longer open.')
    if (parsed.index === 'zomfy') return ephemeral(NOTES.answerInZomfy(bot.name))
    if (prompt.cleared || prompt.answered_by) return ephemeral('This was already answered.')
    const role = askerRole(bot, 'discord', user.id)
    if (user.id !== conv.asker_id && role !== 'owner') return ephemeral(NOTES.onlyAsker(conv.asker_id))
    const body_ = JSON.parse(prompt.body) as Prompt
    const option = body_.kind === 'unsupported' ? undefined : body_.options[parsed.index]
    if (!option) return ephemeral('That option is gone.')
    this.sql.exec('UPDATE discord_prompts SET answered_by = ? WHERE prompt_id = ?', user.id, prompt.prompt_id)
    await this.hub.enqueue({
      id: `discord-answer-${prompt.prompt_id}`,
      kind: 'answer',
      botId: bot.id,
      conversation: { source: 'discord', externalId: conv.external_id },
      askedAt: now(),
      asker: { source: 'discord', id: user.id, name: nameOf(user), role },
      promptId: prompt.prompt_id,
      optionId: option.id
    })
    return { type: ResponseType.DeferredUpdate }
  }

  private turnByKey(key: string) {
    const where = key.startsWith('#') ? 'n = ?' : 'turn_id = ?'
    return this.sql
      .exec<{ n: number; turn_id: string; external_id: string; status_id: string | null; ended: string | null; replaced: number; status_text: string; last_edit_at: number }>(
        `SELECT * FROM discord_turns WHERE ${where}`,
        key.startsWith('#') ? Number(key.slice(1)) : key
      )
      .toArray()[0]
  }

  private promptByKey(key: string) {
    const where = key.startsWith('#') ? 'n = ?' : 'prompt_id = ?'
    return this.sql
      .exec<{ n: number; prompt_id: string; external_id: string; body: string; message_id: string | null; answered_by: string | null; cleared: string | null }>(
        `SELECT * FROM discord_prompts WHERE ${where}`,
        key.startsWith('#') ? Number(key.slice(1)) : key
      )
      .toArray()[0]
  }

  // --- The daemon's events (called inside the Hub's events transaction: SQL only) ---

  onEvent(event: BotEvent): void {
    if (!('conversation' in event) || event.conversation.source !== 'discord') return
    const externalId = event.conversation.externalId
    if (event.kind === 'unlinked' || event.kind === 'chat-gone') return this.dropConv(externalId)
    const conv = this.conv(externalId)
    if (!conv) return
    const t = now()
    switch (event.kind) {
      case 'turn-started': {
        this.sql.exec(
          'INSERT OR IGNORE INTO discord_turns (turn_id, external_id, session_id, status_text, created_at) VALUES (?, ?, ?, ?, ?)',
          event.turnId,
          externalId,
          event.sessionId,
          statusText(),
          t
        )
        const turn = this.turnByKey(event.turnId)!
        this.queue(
          { t: 'post', conv: externalId, as: 'status', turnId: event.turnId, content: statusText(), components: stopRow(shortKey(event.turnId, turn.n, 4)), reference: true },
          `status:${event.turnId}`,
          `conv:${externalId}`
        )
        return
      }
      case 'activity': {
        const turn = this.turnByKey(event.turnId)
        if (!turn || turn.ended || turn.replaced) return
        this.sql.exec('UPDATE discord_turns SET status_text = ? WHERE turn_id = ?', statusText(event.text, event.steps), event.turnId)
        this.queueStatusEdit(event.turnId, turn.last_edit_at + limits.activityThrottleMs)
        return
      }
      case 'turn-ended': {
        this.sql.exec('UPDATE discord_turns SET ended = ? WHERE turn_id = ?', event.outcome, event.turnId)
        this.queue({ t: 'ended', turnId: event.turnId, outcome: event.outcome }, `ended:${event.turnId}`, `conv:${externalId}`)
        return
      }
      case 'reply': {
        let text = replyText(event.outcome, event.text, event.failure)
        if (text !== null && event.prLinks.length) text += `\n\n${event.prLinks.map((l) => `<${l}>`).join('\n')}`
        if (text === null) return
        let chunks = splitMessage(text)
        let file: string | undefined
        if (chunks.length > MAX_REPLY_MESSAGES) {
          file = text
          chunks = [`${splitMessage(text, 1500)[0]}\n\n-# The full answer is attached.`]
        }
        this.sql.exec('UPDATE discord_turns SET replaced = 1 WHERE turn_id = ?', event.turnId)
        this.queue({ t: 'reply', conv: externalId, turnId: event.turnId, chunks, file, sent: 0 }, `reply:${event.idempotencyKey}`, `conv:${externalId}`)
        return
      }
      case 'prompt': {
        const byReply = event.prompt.kind === 'question' && event.prompt.byReply ? 1 : 0
        this.sql.exec(
          'INSERT OR IGNORE INTO discord_prompts (prompt_id, external_id, body, by_reply, created_at) VALUES (?, ?, ?, ?, ?)',
          event.promptId,
          externalId,
          JSON.stringify(event.prompt),
          byReply,
          t
        )
        const row = this.promptByKey(event.promptId)!
        const message = promptMessage(event.prompt, shortKey(event.promptId, row.n), this.bot(conv.bot_id)?.name ?? 'The bot')
        this.queue({ t: 'post', conv: externalId, as: 'prompt', promptId: event.promptId, ...message }, `prompt:${event.promptId}`, `conv:${externalId}`)
        return
      }
      case 'prompt-cleared': {
        const prompt = this.promptByKey(event.promptId)
        if (!prompt || prompt.cleared) return
        this.sql.exec('UPDATE discord_prompts SET cleared = ? WHERE prompt_id = ?', event.by ?? 'zomfy', event.promptId)
        const body = JSON.parse(prompt.body) as Prompt
        const original = promptMessage(body, '-', this.bot(conv.bot_id)?.name ?? 'The bot').content
        const note =
          event.by === 'source' && prompt.answered_by
            ? `Answered by <@${prompt.answered_by}>.`
            : event.by === 'expired'
              ? 'Expired.'
              : 'Answered in Zomfy.'
        this.queue({ t: 'prompt-edit', promptId: event.promptId, content: `${original}\n-# ${note}`.slice(0, 2000) }, `prompt-cleared:${event.promptId}`, `conv:${externalId}`)
        return
      }
      default:
        return
    }
  }

  /** A `start` or `send` that expired or was refused: tell the asker where they asked. */
  onSettled(delivery: Delivery, outcome: 'expired' | 'refused' | 'unsupported', failure?: Failure): void {
    if (delivery.conversation.source !== 'discord' || (delivery.kind !== 'start' && delivery.kind !== 'send')) return
    const conv = this.conv(delivery.conversation.externalId)
    if (!conv) return
    const botName = this.bot(delivery.botId)?.name ?? 'The bot'
    const content =
      outcome === 'expired'
        ? NOTES.expired
        : outcome === 'unsupported'
          ? NOTES.unsupported(botName)
          : failure
            ? `${NOTES.refused(botName)} ${replyText('failed', '', failure) ?? ''}`.trim()
            : NOTES.refused(botName)
    this.queue({ t: 'post', conv: conv.external_id, as: 'note', content, reference: true }, `settled:${delivery.id}`, `conv:${conv.external_id}`)
  }

  private queueStatusEdit(turnId: string, notBefore: number) {
    const pending = this.sql.exec("SELECT 1 FROM outbound WHERE state = 'pending' AND kind = 'status' AND ref = ?", turnId).toArray()
    if (pending.length) return
    this.queue({ t: 'status', turnId }, `status-edit:${turnId}:${now()}:${Math.random()}`, `conv:${this.turnByKey(turnId)?.external_id}`, notBefore, turnId)
  }

  // --- The outbound queue ---

  /** Queues one call; a key already queued (or done in the last 7 days) is not queued again. */
  private queue(op: Op, key: string, lane: string, notBefore = 0, ref?: string) {
    this.sql.exec(
      `INSERT OR IGNORE INTO outbound (key, lane, kind, ref, op, state, not_before, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      key,
      lane,
      op.t,
      ref ?? ('turnId' in op ? op.turnId : null),
      JSON.stringify(op),
      notBefore,
      now()
    )
  }

  /** Runs the queue without the caller waiting on Discord; the timer catches what is left. */
  drainSoon(): Promise<void> {
    return this.drain().catch((error) => console.log(`discord queue: ${error instanceof Error ? error.message : String(error)}`))
  }

  /** Runs every runnable call in order; one drain at a time. Re-arms the timer for the rest. */
  async drain(): Promise<void> {
    if (this.draining) {
      this.again = true
      return
    }
    this.draining = true
    try {
      do {
        this.again = false
        await this.drainOnce()
      } while (this.again)
    } finally {
      this.draining = false
    }
    const next = this.nextRunnableAt()
    if (next !== null) await this.hub.scheduleDue(OUTBOUND_DUE, next)
  }

  private lanes(): Map<string, number> {
    const t = now()
    return new Map(
      this.sql.exec<{ lane: string; blocked_until: number }>('SELECT lane, blocked_until FROM outbound_lanes WHERE blocked_until > ?', t).toArray().map((r) => [r.lane, r.blocked_until])
    )
  }

  private nextRunnableAt(): number | null {
    const rows = this.sql.exec<{ lane: string; not_before: number }>("SELECT lane, not_before FROM outbound WHERE state = 'pending'").toArray()
    if (!rows.length) return null
    const blocked = this.lanes()
    const global = blocked.get(GLOBAL_LANE) ?? 0
    return Math.min(...rows.map((r) => Math.max(r.not_before, blocked.get(r.lane) ?? 0, global)))
  }

  private async drainOnce() {
    const rows = this.sql
      .exec<{ n: number; lane: string; op: string; attempts: number; not_before: number }>(
        "SELECT n, lane, op, attempts, not_before FROM outbound WHERE state = 'pending' ORDER BY n LIMIT 100"
      )
      .toArray()
    const blocked = this.lanes()
    const skip = new Set<string>()
    for (const row of rows) {
      const t = now()
      if ((blocked.get(GLOBAL_LANE) ?? 0) > t) return
      if (skip.has(row.lane) || (blocked.get(row.lane) ?? 0) > t || row.not_before > t) {
        skip.add(row.lane)
        continue
      }
      let result: OpResult
      try {
        result = await this.run(JSON.parse(row.op) as Op, row.n)
      } catch (error) {
        console.log(`discord call failed: ${error instanceof Error ? error.message : String(error)}`)
        result = { status: 'retry' }
      }
      if (result.status === 'done') {
        this.sql.exec("UPDATE outbound SET state = 'done', done_at = ? WHERE n = ?", now(), row.n)
      } else if (result.status === 'wait') {
        const lane = result.global ? GLOBAL_LANE : row.lane
        this.sql.exec('INSERT OR REPLACE INTO outbound_lanes (lane, blocked_until) VALUES (?, ?)', lane, now() + result.ms)
        blocked.set(lane, now() + result.ms)
        skip.add(row.lane)
      } else if (result.status === 'retry' && row.attempts + 1 < MAX_ATTEMPTS) {
        this.sql.exec('UPDATE outbound SET attempts = attempts + 1, not_before = ? WHERE n = ?', now() + 1000 * 2 ** row.attempts, row.n)
        skip.add(row.lane)
      } else {
        console.log(`discord call dropped (${result.status === 'fail' ? result.why : 'too many attempts'})`)
        this.sql.exec("UPDATE outbound SET state = 'failed', done_at = ? WHERE n = ?", now(), row.n)
      }
    }
  }

  /** Classifies a Discord response for the queue. */
  private outcome(res: DiscordResult, what: string): OpResult | null {
    if (res.ok) return null
    if (res.status === 429 || res.retryAfterMs) return { status: 'wait', ms: res.retryAfterMs ?? 1000, global: res.global }
    if (res.status === 0 || res.status >= 500) return { status: 'retry' }
    return { status: 'fail', why: `${what} ${res.status}${res.code ? ` code ${res.code}` : ''}` }
  }

  /** The channel a conversation posts in, creating its thread first when it needs one. */
  private async postChannel(conv: ConvRow): Promise<string | OpResult> {
    if (!conv.needs_thread && conv.post_channel) return conv.post_channel
    let anchor = conv.anchor_id
    if (!anchor && conv.token) {
      const original = await discordCall<{ id: string }>(this.env, 'GET', `/webhooks/${this.env.DISCORD_APPLICATION_ID}/${conv.token}/messages/@original`, { noAuth: true })
      const failed = this.outcome(original, 'read /ask reply')
      if (failed) return failed
      anchor = original.body!.id
      this.sql.exec('UPDATE discord_convs SET anchor_id = ?, ref_message = ? WHERE external_id = ?', anchor, anchor, conv.external_id)
    }
    if (!anchor) return { status: 'fail', why: 'no message to thread from' }
    const res = await discordCall<{ id: string }>(this.env, 'POST', `/channels/${conv.channel_id}/messages/${anchor}/threads`, {
      body: { name: conv.title, auto_archive_duration: 1440 }
    })
    let channel: string
    if (res.ok || res.code === 160004) channel = res.body?.id ?? anchor // 160004: the message has a thread already
    else if (res.status === 403 || res.code === 50001 || res.code === 50013) channel = conv.channel_id // no thread rights: answer in the channel
    else return this.outcome(res, 'create thread')!
    this.sql.exec('UPDATE discord_convs SET post_channel = ?, needs_thread = 0, token = NULL WHERE external_id = ?', channel, conv.external_id)
    if (channel !== conv.channel_id) await this.hub.watchChannel(channel, true)
    return channel
  }

  private async run(op: Op, n: number): Promise<OpResult> {
    switch (op.t) {
      case 'watch':
        await this.hub.watchChannel(op.channelId, op.watch)
        return { status: 'done' }

      case 'channel-note': {
        const res = await discordCall(this.env, 'POST', `/channels/${op.channelId}/messages`, {
          body: { content: op.content, message_reference: { message_id: op.replyTo, fail_if_not_exists: false }, allowed_mentions: { parse: [] } }
        })
        return this.outcome(res, 'post note') ?? { status: 'done' }
      }

      case 'dm': {
        const channel = await discordCall<{ id: string }>(this.env, 'POST', '/users/@me/channels', { body: { recipient_id: op.userId } })
        const failed = this.outcome(channel, 'open DM')
        if (failed) return failed
        const res = await discordCall(this.env, 'POST', `/channels/${channel.body!.id}/messages`, {
          body: { content: op.content, components: op.components ?? [], allowed_mentions: { parse: [] } }
        })
        return this.outcome(res, 'post DM') ?? { status: 'done' }
      }

      case 'post': {
        const conv = this.conv(op.conv)
        if (!conv) return { status: 'done' }
        const channel = await this.postChannel(conv)
        if (typeof channel !== 'string') return channel
        const reference = op.reference && channel === conv.channel_id && conv.ref_message
        const res = await discordCall<{ id: string }>(this.env, 'POST', `/channels/${channel}/messages`, {
          body: {
            content: op.content,
            components: op.components ?? [],
            allowed_mentions: { parse: [] },
            ...(reference ? { message_reference: { message_id: conv.ref_message, fail_if_not_exists: false } } : {})
          }
        })
        const failed = this.outcome(res, 'post')
        if (failed) return failed
        const id = res.body!.id
        if (op.as === 'status' && op.turnId) this.sql.exec('UPDATE discord_turns SET status_id = ?, last_edit_at = ? WHERE turn_id = ?', id, now(), op.turnId)
        if (op.as === 'prompt' && op.promptId) this.sql.exec('UPDATE discord_prompts SET message_id = ? WHERE prompt_id = ?', id, op.promptId)
        return { status: 'done' }
      }

      case 'status': {
        const turn = this.turnByKey(op.turnId)
        if (!turn || turn.replaced || turn.ended || !turn.status_id) return { status: 'done' }
        const conv = this.conv(turn.external_id)
        if (!conv?.post_channel) return { status: 'done' }
        const res = await discordCall(this.env, 'PATCH', `/channels/${conv.post_channel}/messages/${turn.status_id}`, { body: { content: turn.status_text } })
        const failed = this.outcome(res, 'edit status')
        if (failed) return failed
        this.sql.exec('UPDATE discord_turns SET last_edit_at = ? WHERE turn_id = ?', now(), op.turnId)
        return { status: 'done' }
      }

      case 'ended': {
        const turn = this.turnByKey(op.turnId)
        if (!turn || turn.replaced || !turn.status_id) return { status: 'done' }
        const conv = this.conv(turn.external_id)
        if (!conv?.post_channel) return { status: 'done' }
        const res = await discordCall(this.env, 'PATCH', `/channels/${conv.post_channel}/messages/${turn.status_id}`, {
          body: { content: endedText(op.outcome as never), components: [] }
        })
        return this.outcome(res, 'end status') ?? { status: 'done' }
      }

      case 'reply': {
        const conv = this.conv(op.conv)
        if (!conv) return { status: 'done' }
        const channel = await this.postChannel(conv)
        if (typeof channel !== 'string') return channel
        const turn = this.turnByKey(op.turnId)
        for (let i = op.sent; i < op.chunks.length; i++) {
          const content = op.chunks[i]!
          const last = i === op.chunks.length - 1
          let res: DiscordResult
          if (i === 0 && turn?.status_id) {
            // The status message becomes the answer.
            res = await discordCall(this.env, 'PATCH', `/channels/${channel}/messages/${turn.status_id}`, {
              ...(last && op.file ? { form: this.fileForm({ content, components: [], attachments: [{ id: 0, filename: 'answer.md' }] }, op.file) } : { body: { content, components: [] } })
            })
          } else {
            const reference = i === 0 && channel === conv.channel_id && conv.ref_message
            const payload = {
              content,
              allowed_mentions: { parse: [] },
              ...(reference ? { message_reference: { message_id: conv.ref_message, fail_if_not_exists: false } } : {})
            }
            res = await discordCall(this.env, 'POST', `/channels/${channel}/messages`, last && op.file ? { form: this.fileForm({ ...payload, attachments: [{ id: 0, filename: 'answer.md' }] }, op.file) } : { body: payload })
          }
          const failed = this.outcome(res, 'post reply')
          if (failed) return failed
          // Progress is kept, so a retry after a rate limit does not post a part twice.
          this.sql.exec('UPDATE outbound SET op = ? WHERE n = ?', JSON.stringify({ ...op, sent: i + 1 }), n)
        }
        return { status: 'done' }
      }

      case 'prompt-edit': {
        const prompt = this.promptByKey(op.promptId)
        const conv = prompt && this.conv(prompt.external_id)
        if (!prompt?.message_id || !conv?.post_channel) return { status: 'done' }
        const res = await discordCall(this.env, 'PATCH', `/channels/${conv.post_channel}/messages/${prompt.message_id}`, { body: { content: op.content, components: [] } })
        return this.outcome(res, 'clear prompt') ?? { status: 'done' }
      }
    }
  }

  private fileForm(payload: object, text: string): FormData {
    const form = new FormData()
    form.append('payload_json', JSON.stringify(payload))
    form.append('files[0]', new Blob([text], { type: 'text/markdown' }), 'answer.md')
    return form
  }

  /** Rows of `outbound` done or failed more than 7 days ago go; their keys stop deduping then. */
  purge(before: number) {
    this.sql.exec("DELETE FROM outbound WHERE state != 'pending' AND done_at < ?", before)
    this.sql.exec('DELETE FROM outbound_lanes WHERE blocked_until < ?', now())
    this.sql.exec('DELETE FROM discord_turns WHERE created_at < ?', before)
    this.sql.exec('DELETE FROM discord_prompts WHERE created_at < ?', before)
  }

  /** Summary for tests. */
  outboundRows() {
    return this.sql.exec<{ key: string; kind: string; state: string }>('SELECT key, kind, state FROM outbound ORDER BY n').toArray()
  }
}

function ephemeral(content: string, components: Row[] = []) {
  return { type: ResponseType.Message, data: { content, flags: EPHEMERAL, components, allowed_mentions: { parse: [] } } }
}
