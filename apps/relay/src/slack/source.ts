// The Slack source inside the Hub (docs/specs/bots/sources/slack.md): turns Events API callbacks and
// Block Kit presses into deliveries for the right bot, and the daemon's events into thread posts,
// status edits and buttons. Everything it posts goes through the Hub's outbound queue, one lane per
// channel, honouring Slack's 429s, so a retried event never posts twice.

import { formatRef, limits, parseRef, PLACE_KINDS, type Action, type BotEvent, type ContextItem, type Delivery, type Failure, type HelloBot, type Prompt } from '../contract'
import { parseCustomId } from '../discord/format'
import type { OpResult, OutboundRunner } from '../outbound'
import {
  activityLine,
  endedText,
  fail,
  NOTES,
  ok,
  optionFromReply,
  pickBot,
  replyText,
  roleOf,
  settledText,
  sourceFetch,
  type ActionOutcome,
  type HubSource,
  type SourceHub
} from '../sources/common'
import { queueTriggers, type SourceEvent } from '../sources/triggers'
import { isPermanent, slackCall, slackRespond, slackUpload, type SlackResult } from './api'
import {
  accessBlocks,
  answerSections,
  clearedPrompt,
  escapeSlack,
  fallback,
  MAX_SECTIONS,
  noteBlocks,
  promptMessage,
  slackKey,
  slackStyle,
  statusBlocks,
  textBlocks,
  toMrkdwn,
  type Block
} from './format'

export const SLACK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS slack_convs (
     external_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, team TEXT NOT NULL, channel TEXT NOT NULL, thread_ts TEXT NOT NULL,
     channel_type TEXT NOT NULL, asker_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS slack_turns (
     n INTEGER PRIMARY KEY AUTOINCREMENT, turn_id TEXT UNIQUE NOT NULL, external_id TEXT NOT NULL, status_ts TEXT,
     line TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', last_edit_at INTEGER NOT NULL DEFAULT 0, ended TEXT,
     replaced INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS slack_prompts (
     n INTEGER PRIMARY KEY AUTOINCREMENT, prompt_id TEXT UNIQUE NOT NULL, external_id TEXT NOT NULL, body TEXT NOT NULL,
     message_ts TEXT, by_reply INTEGER NOT NULL, answered_by TEXT, cleared TEXT, created_at INTEGER NOT NULL)`,
  /** Messages by people who may not ask, kept as `no_access` context for the next turn. */
  `CREATE TABLE IF NOT EXISTS slack_context (
     key TEXT PRIMARY KEY, external_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
     text TEXT NOT NULL, at INTEGER NOT NULL)`,
  /** The app's bot user in each workspace, from the events' `authorizations`. */
  `CREATE TABLE IF NOT EXISTS slack_teams (team TEXT PRIMARY KEY, bot_user_id TEXT NOT NULL)`,
  /** Results of posts made by actions, by idempotency key, so a retried action posts once. */
  `CREATE TABLE IF NOT EXISTS slack_posts (key TEXT PRIMARY KEY, result TEXT NOT NULL, at INTEGER NOT NULL)`
]

const CONTEXT_MESSAGES = 20
const EARLIER_SCAN = 50
/** Slack allows scheduled posts up to 120 days ahead. */
const MAX_SCHEDULE_MS = 120 * 24 * 60 * 60 * 1000
/** Files a `read` downloads inline (base64 in the action result, within the 1 MiB message cap). */
const MAX_DOWNLOAD_BYTES = 512 * 1024

const now = () => Date.now()
const tsMs = (ts: string | undefined) => (ts ? Math.round(Number(ts) * 1000) || now() : now())

type ConvRow = { external_id: string; bot_id: string; team: string; channel: string; thread_ts: string; channel_type: string; asker_id: string }
type TurnRow = { n: number; turn_id: string; external_id: string; status_ts: string | null; line: string; steps: string; last_edit_at: number; ended: string | null; replaced: number }
type PromptRow = { n: number; prompt_id: string; external_id: string; body: string; message_ts: string | null; by_reply: number; answered_by: string | null; cleared: string | null }

/** The slice of a Slack message event the source reads. */
export interface SlackMessage {
  type: string
  subtype?: string
  user?: string
  bot_id?: string
  text?: string
  ts: string
  thread_ts?: string
  channel: string
  channel_type?: string
  files?: { id: string; name?: string; mimetype?: string; size?: number; url_private?: string; permalink?: string }[]
}

type Op =
  | { t: 'post'; conv: string; as: 'status' | 'note' | 'prompt'; turnId?: string; promptId?: string; text: string; blocks: Block[] }
  | { t: 'status'; turnId: string }
  | { t: 'ended'; turnId: string; outcome: string }
  | { t: 'reply'; conv: string; turnId: string; text: string; sections: string[]; file?: string; done?: boolean }
  | { t: 'prompt-edit'; promptId: string; text: string; blocks: Block[] }
  | { t: 'ephemeral'; channel: string; user: string; threadTs?: string; text: string; blocks: Block[] }
  | { t: 'respond'; url: string; body: Record<string, unknown> }

const PLACE_KIND: Record<string, (typeof PLACE_KINDS)[number]> = {
  im: 'direct_message',
  mpim: 'group_message',
  channel: 'public_channel',
  group: 'private_channel'
}

export class SlackSource implements HubSource, OutboundRunner {
  readonly name = 'slack' as const
  readonly verbs = ['reply', 'post', 'react', 'read', 'find', 'check', 'edit', 'delete', 'attach', 'pin', 'canvas', 'list', 'scheduled'] as const
  private names = new Map<string, string>()

  constructor(private readonly hub: SourceHub) {
    for (const statement of SLACK_SCHEMA) hub.sql.exec(statement)
  }

  private get sql() {
    return this.hub.sql
  }

  private get env() {
    return this.hub.env
  }

  private bot(id: string): HelloBot | undefined {
    return this.hub.bots().find((b) => b.id === id)
  }

  private conv(externalId: string): ConvRow | undefined {
    return this.sql.exec<ConvRow>('SELECT * FROM slack_convs WHERE external_id = ?', externalId).toArray()[0]
  }

  private selfId(team: string): string | null {
    return this.sql.exec<{ bot_user_id: string }>('SELECT bot_user_id FROM slack_teams WHERE team = ?', team).toArray()[0]?.bot_user_id ?? null
  }

  private async userName(id: string): Promise<string> {
    const known = this.names.get(id)
    if (known) return known
    const res = await slackCall<{ user: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } } }>(this.env, 'users.info', { user: id }, AbortSignal.timeout(800)).catch(() => null)
    const u = res?.body?.user
    const name = (u?.profile?.display_name || u?.profile?.real_name || u?.real_name || u?.name || id).slice(0, 256)
    if (res?.ok) this.names.set(id, name)
    return name
  }

  private noBotNote() {
    const bots = this.hub.bots()
    return bots.length ? NOTES.unknownBot(bots.map((b) => b.handle), '@Zomfy') : NOTES.noBots
  }

  private askOwnerNote(bot: HelloBot) {
    const owner = bot.owner.slack
    return `You can’t ask *${escapeSlack(bot.name)}* yet. Ask its owner${owner ? ` <@${owner}>` : ''} to add you in Zomfy, or request access.`
  }

  // --- Inbound: the Events API (the signature is checked by the Worker) ---

  /** An `event_callback`; deduped on `event_id`, and on the message itself (Slack sends a mention as both `app_mention` and `message`). */
  async onEventCallback(body: any): Promise<void> {
    if (body?.type !== 'event_callback' || typeof body.event_id !== 'string') return
    if (!this.hub.markSeen(`slack:evt:${body.event_id}`)) return
    const team: string = body.team_id ?? body.event?.team ?? ''
    const self: string | undefined = body.authorizations?.find((a: any) => a?.is_bot)?.user_id ?? body.authorizations?.[0]?.user_id
    if (team && self && self !== this.selfId(team)) this.sql.exec('INSERT OR REPLACE INTO slack_teams (team, bot_user_id) VALUES (?, ?)', team, self)
    const ev = body.event ?? {}
    if (ev.type === 'app_mention' || ev.type === 'message') await this.onMessage(team, ev as SlackMessage, self ?? this.selfId(team) ?? '')
    else if (ev.type === 'reaction_added') await this.onReaction(team, ev, self ?? this.selfId(team) ?? '')
    await this.hub.outbound.drain()
  }

  private async onReaction(team: string, ev: any, self: string) {
    if (!ev.user || ev.user === self || ev.item?.type !== 'message') return
    await queueTriggers(this.hub, {
      source: 'slack',
      kind: 'reaction',
      key: `${team}:${ev.item.channel}:${ev.item.ts}:${ev.reaction}:${ev.user}`,
      actorId: ev.user,
      placeRef: formatRef({ source: 'slack', team, channel: ev.item.channel }),
      subjectRef: formatRef({ source: 'slack', team, channel: ev.item.channel, threadTs: ev.item.ts }),
      text: `:${ev.reaction}:`,
      occurredAt: tsMs(ev.event_ts),
      selfIds: [self]
    } satisfies SourceEvent)
  }

  private async onMessage(team: string, msg: SlackMessage, self: string): Promise<void> {
    if (msg.bot_id || !msg.user || msg.user === self) return
    if (msg.subtype && msg.subtype !== 'file_share' && msg.subtype !== 'thread_broadcast') return
    if (!this.hub.markSeen(`slack:msg:${msg.channel}:${msg.ts}`)) return
    const mentionRe = self ? new RegExp(`<@${self}(\\|[^>]*)?>`, 'g') : null
    const raw = msg.text ?? ''
    const mentioned = mentionRe ? mentionRe.test(raw) : msg.type === 'app_mention'
    const text = (mentionRe ? raw.replace(mentionRe, '') : raw).trim()
    const channelType = msg.channel_type ?? (msg.channel.startsWith('D') ? 'im' : 'channel')
    const dm = channelType === 'im'
    const placeRef = formatRef({ source: 'slack', team, channel: msg.channel })
    const threadTs = msg.thread_ts
    const conv = threadTs ? this.conv(`${team}:${msg.channel}:${threadTs}`) : undefined
    const triggerEvent = (kind: string, conversation?: { source: 'slack'; externalId: string }): SourceEvent => ({
      source: 'slack',
      kind,
      key: `${team}:${msg.channel}:${msg.ts}`,
      actorId: msg.user!,
      placeRef,
      subjectRef: formatRef({ source: 'slack', team, channel: msg.channel, threadTs: threadTs ?? msg.ts }),
      text: raw.slice(0, limits.maxRuleTextChars),
      occurredAt: tsMs(msg.ts),
      selfIds: [self],
      ...(conversation ? { conversation } : {})
    })

    if (conv) {
      const bot = this.bot(conv.bot_id)
      if (!bot) return
      const conversation = { source: 'slack' as const, externalId: conv.external_id }
      const role = roleOf(bot, 'slack', msg.user)
      if (role === 'other') {
        if (mentioned) this.queueEphemeral(msg.channel, msg.user, threadTs, this.askOwnerNote(bot), accessBlocks(this.askOwnerNote(bot), bot.id))
        this.sql.exec(
          'INSERT OR IGNORE INTO slack_context (key, external_id, author_id, author_name, text, at) VALUES (?, ?, ?, ?, ?, ?)',
          `${msg.channel}:${msg.ts}`,
          conv.external_id,
          msg.user,
          await this.userName(msg.user),
          raw.slice(0, 4000),
          tsMs(msg.ts)
        )
        await queueTriggers(this.hub, triggerEvent(mentioned ? 'mentioned' : 'message', conversation))
        return
      }
      const asker = { source: 'slack' as const, id: msg.user, name: await this.userName(msg.user), role }
      this.sql.exec('UPDATE slack_convs SET asker_id = ? WHERE external_id = ?', msg.user, conv.external_id)
      const byReply = this.sql
        .exec<{ prompt_id: string; body: string }>(
          'SELECT prompt_id, body FROM slack_prompts WHERE external_id = ? AND by_reply = 1 AND cleared IS NULL AND answered_by IS NULL ORDER BY n DESC LIMIT 1',
          conv.external_id
        )
        .toArray()[0]
      if (byReply) {
        this.sql.exec('UPDATE slack_prompts SET answered_by = ? WHERE prompt_id = ?', msg.user, byReply.prompt_id)
        const prompt = JSON.parse(byReply.body) as Prompt
        const answer = prompt.kind === 'question' ? optionFromReply(prompt.options, text) : { text: text.slice(0, limits.maxAnswerTextChars) }
        await this.hub.enqueue({ id: `slack-${msg.channel}-${msg.ts}`, kind: 'answer', botId: bot.id, conversation, askedAt: now(), asker, promptId: byReply.prompt_id, ...answer })
        return
      }
      const ruleIds = await queueTriggers(this.hub, triggerEvent(mentioned ? 'mentioned' : 'message', conversation), bot.id)
      await this.hub.enqueue({
        id: `slack-${msg.channel}-${msg.ts}`,
        kind: 'send',
        botId: bot.id,
        conversation,
        askedAt: tsMs(msg.ts),
        asker,
        text,
        context: this.takeContext(conv.external_id),
        ...(ruleIds.length ? { ruleIds } : {})
      })
      return
    }

    if (!mentioned && !dm) {
      await queueTriggers(this.hub, triggerEvent('message'))
      return
    }
    const picked = pickBot(this.hub.bots(), text)
    if (!picked.bot) {
      this.queueEphemeral(msg.channel, msg.user, threadTs, this.noBotNote(), noteBlocks(this.noBotNote()))
      return
    }
    const bot = picked.bot
    const role = roleOf(bot, 'slack', msg.user)
    if (role === 'other') {
      const note = this.askOwnerNote(bot)
      this.queueEphemeral(msg.channel, msg.user, threadTs, note, accessBlocks(note, bot.id))
      await queueTriggers(this.hub, triggerEvent(mentioned ? 'mentioned' : 'message'))
      return
    }
    const thread = threadTs ?? msg.ts
    const externalId = `${team}:${msg.channel}:${thread}`
    this.sql.exec(
      'INSERT OR REPLACE INTO slack_convs (external_id, bot_id, team, channel, thread_ts, channel_type, asker_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      externalId,
      bot.id,
      team,
      msg.channel,
      thread,
      channelType,
      msg.user,
      now()
    )
    const conversation = { source: 'slack' as const, externalId }
    const bare = !picked.text.trim()
    const context = threadTs ? await this.threadContext(bot, msg.channel, threadTs, msg.ts, self) : []
    let attachments = this.files(msg.files)
    if (bare) {
      const earlier = await this.earlierOwn(msg.channel, threadTs, msg.ts, msg.user, self)
      context.push(...earlier.items)
      attachments = [...earlier.files, ...attachments].slice(0, limits.maxContextFiles)
    }
    const ruleIds = await queueTriggers(this.hub, triggerEvent(mentioned ? 'mentioned' : 'message', conversation), bot.id)
    await this.hub.enqueue({
      id: `slack-${msg.channel}-${msg.ts}`,
      kind: 'start',
      botId: bot.id,
      conversation,
      askedAt: tsMs(msg.ts),
      asker: { source: 'slack', id: msg.user, name: await this.userName(msg.user), role },
      placeId: placeRef,
      placeKind: PLACE_KIND[channelType] ?? 'public_channel',
      text: picked.text,
      context: context.slice(-64),
      links: [],
      attachments,
      ...(ruleIds.length ? { ruleIds } : {})
    })
  }

  private files(files: SlackMessage['files']) {
    return (files ?? []).slice(0, limits.maxContextFiles).flatMap((f) => {
      const url = f.permalink ?? f.url_private
      if (!url) return []
      return [{ name: (f.name ?? f.id).slice(0, 512), url, ...(f.mimetype ? { mimeType: f.mimetype } : {}), ...(f.size !== undefined ? { size: f.size } : {}) }]
    })
  }

  private takeContext(externalId: string): ContextItem[] {
    const rows = this.sql
      .exec<{ author_id: string; author_name: string; text: string; at: number }>('SELECT author_id, author_name, text, at FROM slack_context WHERE external_id = ? ORDER BY at LIMIT 20', externalId)
      .toArray()
    this.sql.exec('DELETE FROM slack_context WHERE external_id = ?', externalId)
    return rows.map((r) => ({ label: 'no_access', author: { id: r.author_id, name: r.author_name }, text: r.text, at: r.at }))
  }

  /** The thread so far (`conversations.replies`), labelled as the contract says. */
  private async threadContext(bot: HelloBot, channel: string, threadTs: string, before: string, self: string): Promise<ContextItem[]> {
    const res = await slackCall<{ messages: SlackMessage[] }>(this.env, 'conversations.replies', { channel, ts: threadTs, limit: 100 }, AbortSignal.timeout(1500)).catch(() => null)
    if (!res?.ok || !res.body) return []
    const items: ContextItem[] = []
    for (const m of res.body.messages.filter((m) => m.ts !== before && Number(m.ts) < Number(before)).slice(-CONTEXT_MESSAGES)) {
      if (!m.text) continue
      const own = m.user === self || Boolean(m.bot_id)
      const label = own ? 'bot' : m.user && roleOf(bot, 'slack', m.user) !== 'other' ? 'earlier' : 'no_access'
      items.push({ label, author: { id: m.user ?? m.bot_id ?? '', name: m.user ? await this.userName(m.user) : 'bot' }, text: m.text.slice(0, 4000), at: tsMs(m.ts) })
    }
    return items
  }

  /**
   * A bare mention's request: the asker's own last messages before it, after the bot's last post
   * there, oldest first (≤ 10 of ≤ 4000 characters, ≤ 10 files), as Orca's `earlier-own-messages`.
   */
  private async earlierOwn(channel: string, threadTs: string | undefined, before: string, user: string, self: string) {
    const res = threadTs
      ? await slackCall<{ messages: SlackMessage[] }>(this.env, 'conversations.replies', { channel, ts: threadTs, limit: EARLIER_SCAN }, AbortSignal.timeout(1500)).catch(() => null)
      : await slackCall<{ messages: SlackMessage[] }>(this.env, 'conversations.history', { channel, latest: before, inclusive: false, limit: EARLIER_SCAN }, AbortSignal.timeout(1500)).catch(() => null)
    const items: ContextItem[] = []
    const files: ReturnType<SlackSource['files']> = []
    if (!res?.ok || !res.body) return { items, files }
    // Newest first, whichever call answered.
    const newest = res.body.messages.filter((m) => Number(m.ts) < Number(before)).sort((a, b) => Number(b.ts) - Number(a.ts))
    const mine: SlackMessage[] = []
    let more = false
    for (const m of newest) {
      if (m.user === self || m.bot_id) break
      if (m.user !== user) continue
      if (mine.length >= limits.maxEarlierOwnMessages) {
        more = true
        break
      }
      mine.push(m)
    }
    for (const m of mine.reverse()) {
      items.push({ label: 'earlier', author: { id: user, name: await this.userName(user) }, text: (m.text ?? '').slice(0, limits.maxEarlierOwnMessageChars), at: tsMs(m.ts) })
      files.push(...this.files(m.files))
    }
    if (more) items.unshift({ label: 'more', text: 'They wrote more before these.' })
    return { items, files: files.slice(0, limits.maxContextFiles) }
  }

  // --- Inbound: Block Kit presses (the signature is checked by the Worker) ---

  /** A `block_actions` payload; Slack has already had its 200. */
  async onInteraction(payload: any): Promise<void> {
    if (payload?.type !== 'block_actions') return
    const user: string | undefined = payload.user?.id
    const action = payload.actions?.[0]
    if (!user || !action) return
    const responseUrl: string | undefined = payload.response_url
    const note = (text: string) => {
      if (responseUrl) this.queueRespond(responseUrl, { response_type: 'ephemeral', replace_original: false, text })
      else if (payload.channel?.id) this.queueEphemeral(payload.channel.id, user, payload.message?.thread_ts, text, noteBlocks(text))
    }
    const parsed = parseCustomId(String(action.action_id ?? ''))
    if (!parsed) return note('This button is no longer active.')
    const name = payload.user?.name ?? payload.user?.username ?? (await this.userName(user))

    if (parsed.kind === 'access') {
      const bot = this.bot(parsed.botId)
      if (!bot) return note('This bot is gone.')
      await this.hub.enqueue({
        id: `slack-access-${bot.id}-${user}`,
        kind: 'access_request',
        botId: bot.id,
        conversation: { source: 'slack', externalId: `access:${user}` },
        askedAt: now(),
        requester: { source: 'slack', id: user, name }
      })
      if (responseUrl) this.queueRespond(responseUrl, { replace_original: true, text: NOTES.accessRequested })
      return
    }

    if (parsed.kind === 'stop') {
      const turn = this.turnByKey(parsed.turnKey)
      const conv = turn && this.conv(turn.external_id)
      const bot = conv && this.bot(conv.bot_id)
      if (!turn || !conv || !bot || turn.ended) return note('This turn has ended.')
      const role = roleOf(bot, 'slack', user)
      if (user !== conv.asker_id && role !== 'owner') return note(onlyAsker(conv.asker_id))
      await this.hub.enqueue({
        id: `slack-stop-${turn.turn_id}`,
        kind: 'cancel',
        botId: bot.id,
        conversation: { source: 'slack', externalId: conv.external_id },
        askedAt: now(),
        asker: { source: 'slack', id: user, name, role },
        turnId: turn.turn_id
      })
      this.sql.exec('UPDATE slack_turns SET line = ? WHERE turn_id = ?', NOTES.stopping, turn.turn_id)
      this.queueStatusEdit(turn.turn_id, 0)
      return
    }

    const prompt = this.promptByKey(parsed.promptKey)
    const conv = prompt && this.conv(prompt.external_id)
    const bot = conv && this.bot(conv.bot_id)
    if (!prompt || !conv || !bot) return note('This question is no longer open.')
    if (parsed.index === 'zomfy') return note(`Open Zomfy to answer: the chat is in *${escapeSlack(bot.name)}*’s home.`)
    if (prompt.cleared || prompt.answered_by) return note('This was already answered.')
    const role = roleOf(bot, 'slack', user)
    if (user !== conv.asker_id && role !== 'owner') return note(onlyAsker(conv.asker_id))
    const body = JSON.parse(prompt.body) as Prompt
    const option = body.kind === 'unsupported' ? undefined : body.options[parsed.index]
    if (!option) return note('That option is gone.')
    this.sql.exec('UPDATE slack_prompts SET answered_by = ? WHERE prompt_id = ?', user, prompt.prompt_id)
    await this.hub.enqueue({
      id: `slack-answer-${prompt.prompt_id}`,
      kind: 'answer',
      botId: bot.id,
      conversation: { source: 'slack', externalId: conv.external_id },
      askedAt: now(),
      asker: { source: 'slack', id: user, name, role },
      promptId: prompt.prompt_id,
      optionId: option.id
    })
    // The buttons go at once, so nobody presses twice.
    const cleared = clearedPrompt(body, bot.name, `<@${user}> chose *${escapeSlack(option.label)}*.`)
    this.queue({ t: 'prompt-edit', promptId: prompt.prompt_id, ...cleared }, `slack:prompt-answered:${prompt.prompt_id}`, `slack:ch:${conv.channel}`)
  }

  private turnByKey(key: string): TurnRow | undefined {
    const byN = key.startsWith('#')
    return this.sql.exec<TurnRow>(`SELECT * FROM slack_turns WHERE ${byN ? 'n' : 'turn_id'} = ?`, byN ? Number(key.slice(1)) : key).toArray()[0]
  }

  private promptByKey(key: string): PromptRow | undefined {
    const byN = key.startsWith('#')
    return this.sql.exec<PromptRow>(`SELECT * FROM slack_prompts WHERE ${byN ? 'n' : 'prompt_id'} = ?`, byN ? Number(key.slice(1)) : key).toArray()[0]
  }

  // --- The daemon's events (inside the Hub's events transaction: SQL only) ---

  onEvent(event: BotEvent): void {
    if (!('conversation' in event) || event.conversation.source !== 'slack') return
    const externalId = event.conversation.externalId
    if (event.kind === 'unlinked' || event.kind === 'chat-gone') {
      this.sql.exec('DELETE FROM slack_context WHERE external_id = ?', externalId)
      return
    }
    const conv = this.conv(externalId)
    if (!conv) return
    const lane = `slack:ch:${conv.channel}`
    const botName = this.bot(conv.bot_id)?.name ?? 'The bot'
    switch (event.kind) {
      case 'turn-started': {
        this.sql.exec('INSERT OR IGNORE INTO slack_turns (turn_id, external_id, line, created_at) VALUES (?, ?, ?, ?)', event.turnId, externalId, activityLine(), now())
        const turn = this.turnByKey(event.turnId)!
        const blocks = statusBlocks(activityLine(), [], slackKey(event.turnId, turn.n))
        this.queue({ t: 'post', conv: externalId, as: 'status', turnId: event.turnId, text: activityLine(), blocks }, `slack:status:${event.turnId}`, lane)
        return
      }
      case 'activity': {
        const turn = this.turnByKey(event.turnId)
        if (!turn || turn.ended || turn.replaced) return
        this.sql.exec('UPDATE slack_turns SET line = ?, steps = ? WHERE turn_id = ?', activityLine(event.text, event.steps), JSON.stringify(event.steps), event.turnId)
        this.queueStatusEdit(event.turnId, turn.last_edit_at + limits.activityThrottleMs)
        return
      }
      case 'turn-ended': {
        this.sql.exec('UPDATE slack_turns SET ended = ? WHERE turn_id = ?', event.outcome, event.turnId)
        this.queue({ t: 'ended', turnId: event.turnId, outcome: event.outcome }, `slack:ended:${event.turnId}`, lane)
        return
      }
      case 'reply': {
        let text = replyText(event.outcome, event.text, event.failure, slackStyle)
        if (text === null) return
        if (event.prLinks.length) text += `\n\n${event.prLinks.join('\n')}`
        const sections = answerSections(text)
        const file = sections.length > MAX_SECTIONS ? text : undefined
        this.sql.exec('UPDATE slack_turns SET replaced = 1 WHERE turn_id = ?', event.turnId)
        this.queue(
          { t: 'reply', conv: externalId, turnId: event.turnId, text: fallback(text), sections: file ? [`${sections[0]}\n\n_The full answer is attached._`] : sections, file },
          `slack:reply:${event.idempotencyKey}`,
          lane
        )
        return
      }
      case 'prompt': {
        const byReply = event.prompt.kind === 'question' && event.prompt.byReply ? 1 : 0
        this.sql.exec('INSERT OR IGNORE INTO slack_prompts (prompt_id, external_id, body, by_reply, created_at) VALUES (?, ?, ?, ?, ?)', event.promptId, externalId, JSON.stringify(event.prompt), byReply, now())
        const row = this.promptByKey(event.promptId)!
        const message = promptMessage(event.prompt, slackKey(event.promptId, row.n), botName)
        this.queue({ t: 'post', conv: externalId, as: 'prompt', promptId: event.promptId, ...message }, `slack:prompt:${event.promptId}`, lane)
        return
      }
      case 'prompt-cleared': {
        const prompt = this.promptByKey(event.promptId)
        if (!prompt || prompt.cleared) return
        this.sql.exec('UPDATE slack_prompts SET cleared = ? WHERE prompt_id = ?', event.by ?? 'zomfy', event.promptId)
        const note = event.by === 'source' && prompt.answered_by ? `Answered by <@${prompt.answered_by}>.` : event.by === 'expired' ? 'Expired.' : 'Answered in Zomfy.'
        this.queue({ t: 'prompt-edit', promptId: event.promptId, ...clearedPrompt(JSON.parse(prompt.body) as Prompt, botName, note) }, `slack:prompt-cleared:${event.promptId}`, lane)
        return
      }
      default:
        return
    }
  }

  onSettled(delivery: Delivery, outcome: 'expired' | 'refused' | 'unsupported', failure?: Failure): void {
    if (delivery.conversation.source !== 'slack' || (delivery.kind !== 'start' && delivery.kind !== 'send')) return
    const conv = this.conv(delivery.conversation.externalId)
    if (!conv) return
    const text = settledText(outcome, this.bot(delivery.botId)?.name ?? 'The bot', failure, slackStyle)
    this.queue({ t: 'post', conv: conv.external_id, as: 'note', text, blocks: noteBlocks(text) }, `slack:settled:${delivery.id}`, `slack:ch:${conv.channel}`)
  }

  purge(before: number) {
    this.sql.exec('DELETE FROM slack_turns WHERE created_at < ?', before)
    this.sql.exec('DELETE FROM slack_prompts WHERE created_at < ?', before)
    this.sql.exec('DELETE FROM slack_context WHERE at < ?', before)
    this.sql.exec('DELETE FROM slack_posts WHERE at < ?', before)
  }

  private queueStatusEdit(turnId: string, notBefore: number) {
    if (this.hub.outbound.hasPending('slack', 'status', turnId)) return
    const turn = this.turnByKey(turnId)
    const conv = turn && this.conv(turn.external_id)
    this.queue({ t: 'status', turnId }, `slack:status-edit:${turnId}:${now()}:${Math.random()}`, `slack:ch:${conv?.channel}`, notBefore, turnId)
  }

  private queueEphemeral(channel: string, user: string, threadTs: string | undefined, text: string, blocks: Block[]) {
    this.queue({ t: 'ephemeral', channel, user, threadTs, text, blocks }, `slack:ephemeral:${channel}:${user}:${now()}:${Math.random()}`, `slack:ch:${channel}`)
  }

  private queueRespond(url: string, body: Record<string, unknown>) {
    this.queue({ t: 'respond', url, body }, `slack:respond:${now()}:${Math.random()}`, 'slack:respond')
  }

  private queue(op: Op, key: string, lane: string, notBefore = 0, ref?: string) {
    this.hub.outbound.queue('slack', op, key, lane, notBefore, ref)
  }

  // --- The outbound queue's runner ---

  private outcome(res: SlackResult, what: string): OpResult | null {
    if (res.ok) return null
    if (res.retryAfterMs !== null) return { status: 'wait', ms: res.retryAfterMs }
    if (res.status === 0 || res.status >= 500 || !isPermanent(res.error)) return { status: 'retry' }
    return { status: 'fail', why: `${what}: ${res.error}` }
  }

  async run(op: Op, n: number): Promise<OpResult> {
    switch (op.t) {
      case 'post': {
        const conv = this.conv(op.conv)
        if (!conv) return { status: 'done' }
        const res = await slackCall<{ ts: string }>(this.env, 'chat.postMessage', { channel: conv.channel, thread_ts: conv.thread_ts, text: op.text, blocks: op.blocks, unfurl_links: false })
        const failed = this.outcome(res, 'post')
        if (failed) return failed
        if (op.as === 'status' && op.turnId) this.sql.exec('UPDATE slack_turns SET status_ts = ?, last_edit_at = ? WHERE turn_id = ?', res.body!.ts, now(), op.turnId)
        if (op.as === 'prompt' && op.promptId) this.sql.exec('UPDATE slack_prompts SET message_ts = ? WHERE prompt_id = ?', res.body!.ts, op.promptId)
        return { status: 'done' }
      }
      case 'status': {
        const turn = this.turnByKey(op.turnId)
        if (!turn || turn.replaced || turn.ended || !turn.status_ts) return { status: 'done' }
        const conv = this.conv(turn.external_id)
        if (!conv) return { status: 'done' }
        const steps = JSON.parse(turn.steps) as { text: string; status: string }[]
        const res = await slackCall(this.env, 'chat.update', { channel: conv.channel, ts: turn.status_ts, text: turn.line, blocks: statusBlocks(turn.line, steps, slackKey(turn.turn_id, turn.n)) })
        const failed = this.outcome(res, 'edit status')
        if (failed) return failed
        this.sql.exec('UPDATE slack_turns SET last_edit_at = ? WHERE turn_id = ?', now(), op.turnId)
        return { status: 'done' }
      }
      case 'ended': {
        const turn = this.turnByKey(op.turnId)
        if (!turn || turn.replaced || !turn.status_ts) return { status: 'done' }
        const conv = this.conv(turn.external_id)
        if (!conv) return { status: 'done' }
        const text = endedText(op.outcome as never)
        const res = await slackCall(this.env, 'chat.update', { channel: conv.channel, ts: turn.status_ts, text, blocks: noteBlocks(text) })
        return this.outcome(res, 'end status') ?? { status: 'done' }
      }
      case 'reply': {
        const conv = this.conv(op.conv)
        if (!conv) return { status: 'done' }
        const turn = this.turnByKey(op.turnId)
        if (!op.done) {
          const blocks = textBlocks(op.sections)
          // The status message becomes the answer.
          const res = turn?.status_ts
            ? await slackCall(this.env, 'chat.update', { channel: conv.channel, ts: turn.status_ts, text: op.text, blocks })
            : await slackCall(this.env, 'chat.postMessage', { channel: conv.channel, thread_ts: conv.thread_ts, text: op.text, blocks, unfurl_links: false })
          const failed = this.outcome(res, 'post reply')
          if (failed) return failed
          this.hub.outbound.setOp(n, { ...op, done: true })
        }
        if (op.file) {
          const res = await slackUpload(this.env, { name: 'answer.md', bytes: new TextEncoder().encode(op.file), title: 'The full answer' }, { channel: conv.channel, threadTs: conv.thread_ts })
          const failed = this.outcome(res, 'upload answer')
          if (failed) return failed
        }
        return { status: 'done' }
      }
      case 'prompt-edit': {
        const prompt = this.promptByKey(op.promptId)
        const conv = prompt && this.conv(prompt.external_id)
        if (!prompt?.message_ts || !conv) return { status: 'done' }
        const res = await slackCall(this.env, 'chat.update', { channel: conv.channel, ts: prompt.message_ts, text: op.text, blocks: op.blocks })
        return this.outcome(res, 'clear prompt') ?? { status: 'done' }
      }
      case 'ephemeral': {
        const res = await slackCall(this.env, 'chat.postEphemeral', { channel: op.channel, user: op.user, thread_ts: op.threadTs, text: op.text, blocks: op.blocks })
        return this.outcome(res, 'ephemeral note') ?? { status: 'done' }
      }
      case 'respond': {
        const res = await slackRespond(this.env, op.url, op.body)
        return this.outcome(res, 'respond') ?? { status: 'done' }
      }
    }
  }

  // --- Actions (the shared verbs plus Slack's pin, canvas, list and scheduled) ---

  async action(action: Action): Promise<ActionOutcome> {
    const ref = action.ref ? parseRef(action.ref) : null
    if (!ref || ref.source !== 'slack') return fail('bad_ref', 'a Slack ref is needed: slack:<team>:<channel>:<thread_ts?>')
    const args = action.args as Record<string, any>
    const channel = ref.channel
    const thread = ref.threadTs
    const text = typeof args.text === 'string' ? toMrkdwn(args.text).slice(0, 40_000) : undefined
    const check = (res: SlackResult, what: string) => (res.ok ? null : fail(res.retryAfterMs !== null ? 'rate_limited' : (res.error ?? 'failed'), `${what}: ${res.error}`))
    const once = async (make: () => Promise<ActionOutcome>): Promise<ActionOutcome> => {
      const key = action.idempotencyKey ?? (typeof args.postId === 'string' ? args.postId : undefined)
      if (!key) return make()
      const done = this.sql.exec<{ result: string }>('SELECT result FROM slack_posts WHERE key = ?', key).toArray()[0]
      if (done) return ok(JSON.parse(done.result))
      const outcome = await make()
      if (outcome.ok) this.sql.exec('INSERT OR REPLACE INTO slack_posts (key, result, at) VALUES (?, ?, ?)', key, JSON.stringify(outcome.result ?? null), now())
      return outcome
    }

    switch (action.verb) {
      case 'reply':
      case 'post': {
        if (!text) return fail('invalid_args', 'text is needed')
        return once(async () => {
          const as = args.mirror === true ? await this.ownerProfile(action.ref!) : null
          if (args.postAt !== undefined) return this.schedule(channel, thread, text, Number(args.postAt))
          const res = await slackCall<{ ts: string }>(this.env, 'chat.postMessage', {
            channel,
            thread_ts: thread,
            text,
            unfurl_links: false,
            ...(as ? { username: as.name, icon_url: as.icon } : {})
          })
          return check(res, 'post') ?? ok({ ts: res.body!.ts, ref: formatRef({ source: 'slack', team: ref.team, channel, threadTs: thread ?? res.body!.ts }) })
        })
      }
      case 'react': {
        const ts = String(args.ts ?? thread ?? '')
        const emoji = String(args.emoji ?? args.name ?? '').replace(/:/g, '')
        if (!ts || !emoji) return fail('invalid_args', 'emoji and a message are needed')
        const res = await slackCall(this.env, args.remove ? 'reactions.remove' : 'reactions.add', { channel, timestamp: ts, name: emoji })
        return res.ok || res.error === 'already_reacted' || res.error === 'no_reaction' ? ok({}) : check(res, 'react')!
      }
      case 'read': {
        if (typeof args.download === 'string') return this.download(args.download)
        const limit = Math.min(Number(args.limit ?? 20) || 20, 100)
        const res = thread
          ? await slackCall<{ messages: SlackMessage[]; has_more?: boolean }>(this.env, 'conversations.replies', { channel, ts: thread, limit })
          : await slackCall<{ messages: SlackMessage[]; has_more?: boolean }>(this.env, 'conversations.history', { channel, limit, latest: args.before })
        const failed = check(res, 'read')
        if (failed) return failed
        return ok({
          messages: res.body!.messages.map((m) => ({ ts: m.ts, user: m.user ?? m.bot_id, text: m.text ?? '', files: (m.files ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size })) })),
          more: res.body!.has_more === true
        })
      }
      case 'find': {
        const name = String(args.text ?? args.name ?? '').replace(/^#/, '').toLowerCase()
        const res = await slackCall<{ channels: { id: string; name: string; is_private?: boolean }[] }>(this.env, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 1000 })
        const failed = check(res, 'find')
        if (failed) return failed
        return ok({ places: res.body!.channels.filter((c) => !name || c.name.includes(name)).slice(0, 50).map((c) => ({ ref: formatRef({ source: 'slack', team: ref.team, channel: c.id }), name: `#${c.name}` })) })
      }
      case 'check': {
        const res = await slackCall<{ channel: { id: string; name?: string; is_archived?: boolean; is_member?: boolean } }>(this.env, 'conversations.info', { channel })
        return check(res, 'check') ?? ok({ channel: res.body!.channel })
      }
      case 'edit': {
        if (!text || !args.ts) return fail('invalid_args', 'ts and text are needed')
        const res = await slackCall(this.env, 'chat.update', { channel, ts: String(args.ts), text })
        return check(res, 'edit') ?? ok({})
      }
      case 'delete': {
        if (!args.ts) return fail('invalid_args', 'ts is needed')
        const res = await slackCall(this.env, 'chat.delete', { channel, ts: String(args.ts) })
        return check(res, 'delete') ?? ok({})
      }
      case 'attach': {
        const file = args.file as { name?: string; text?: string; base64?: string } | undefined
        if (!file?.name || (file.text === undefined && file.base64 === undefined)) return fail('invalid_args', 'file {name, text|base64} is needed')
        return once(async () => {
          const bytes = file.text !== undefined ? new TextEncoder().encode(file.text) : Uint8Array.from(atob(file.base64!), (c) => c.charCodeAt(0))
          const res = await slackUpload(this.env, { name: file.name!.slice(0, 255), bytes }, { channel, threadTs: thread, comment: text })
          return check(res, 'attach') ?? ok({ fileId: res.body?.files?.[0]?.id })
        })
      }
      case 'pin': {
        const ts = String(args.ts ?? thread ?? '')
        if (!ts) return fail('invalid_args', 'a message is needed')
        const res = await slackCall(this.env, args.remove ? 'pins.remove' : 'pins.add', { channel, timestamp: ts })
        return res.ok || res.error === 'already_pinned' || res.error === 'no_pin' ? ok({}) : check(res, 'pin')!
      }
      case 'canvas':
      case 'list': {
        // A list is a canvas holding a checklist, one item a line.
        const items = Array.isArray(args.items) ? (args.items as string[]) : []
        const markdown = action.verb === 'list' ? items.map((i) => `- [ ] ${i}`).join('\n') : String(args.text ?? '')
        if (!markdown) return fail('invalid_args', action.verb === 'list' ? 'items are needed' : 'text is needed')
        return once(async () => {
          const res = await slackCall<{ canvas_id: string }>(this.env, 'canvases.create', { title: String(args.title ?? (action.verb === 'list' ? 'List' : 'Canvas')).slice(0, 255), document_content: { type: 'markdown', markdown }, channel_id: channel })
          return check(res, action.verb) ?? ok({ canvasId: res.body!.canvas_id })
        })
      }
      case 'scheduled': {
        if (typeof args.cancel === 'string') {
          const res = await slackCall(this.env, 'chat.deleteScheduledMessage', { channel, scheduled_message_id: args.cancel })
          return check(res, 'cancel scheduled') ?? ok({})
        }
        const res = await slackCall<{ scheduled_messages: { id: string; post_at: number; text?: string }[] }>(this.env, 'chat.scheduledMessages.list', { channel })
        return check(res, 'scheduled') ?? ok({ scheduled: res.body!.scheduled_messages.map((m) => ({ id: m.id, postAt: m.post_at, text: m.text ?? '' })) })
      }
      default:
        return fail('unsupported', `${action.verb} is not available for Slack`)
    }
  }

  private async schedule(channel: string, thread: string | undefined, text: string, postAt: number): Promise<ActionOutcome> {
    const atMs = postAt > 1e12 ? postAt : postAt * 1000
    if (atMs <= now() || atMs > now() + MAX_SCHEDULE_MS) return fail('invalid_args', 'postAt must be in the next 120 days')
    const res = await slackCall<{ scheduled_message_id: string }>(this.env, 'chat.scheduleMessage', { channel, thread_ts: thread, text, post_at: Math.floor(atMs / 1000) })
    return res.ok ? ok({ scheduledId: res.body!.scheduled_message_id }) : fail(res.error ?? 'failed', `schedule: ${res.error}`)
  }

  /** The bot's owner as Slack shows them, for a mirrored post. */
  private async ownerProfile(refText: string): Promise<{ name: string; icon?: string } | null> {
    const ref = parseRef(refText)
    if (!ref || ref.source !== 'slack' || !ref.threadTs) return null
    const conv = this.conv(`${ref.team}:${ref.channel}:${ref.threadTs}`)
    const owner = conv && this.bot(conv.bot_id)?.owner.slack
    if (!owner) return null
    const res = await slackCall<{ user: { real_name?: string; profile?: { display_name?: string; real_name?: string; image_72?: string } } }>(this.env, 'users.info', { user: owner })
    const u = res.body?.user
    if (!u) return null
    return { name: (u.profile?.display_name || u.profile?.real_name || u.real_name || 'Owner').slice(0, 80), icon: u.profile?.image_72 }
  }

  /** A file on a message, inline as base64 (≤ 512 KiB). */
  private async download(fileId: string): Promise<ActionOutcome> {
    const info = await slackCall<{ file: { id: string; name?: string; size?: number; mimetype?: string; url_private_download?: string } }>(this.env, 'files.info', { file: fileId })
    if (!info.ok || !info.body?.file.url_private_download) return fail(info.error ?? 'not_found', 'file not found')
    const file = info.body.file
    if ((file.size ?? 0) > MAX_DOWNLOAD_BYTES) return fail('too_large', `files over ${MAX_DOWNLOAD_BYTES} bytes are not downloaded`)
    const res = await sourceFetch(this.env)(new Request(file.url_private_download!, { headers: { Authorization: `Bearer ${this.env.SLACK_BOT_TOKEN ?? ''}` } }))
    if (!res.ok) return fail('failed', `download ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length > MAX_DOWNLOAD_BYTES) return fail('too_large', 'file too large')
    let raw = ''
    for (const b of bytes) raw += String.fromCharCode(b)
    return ok({ id: file.id, name: file.name, mimeType: file.mimetype, base64: btoa(raw) })
  }
}

function onlyAsker(askerId: string | null) {
  return `Only ${askerId ? `<@${askerId}>` : 'the person who asked'} or the bot’s owner can answer this.`
}

