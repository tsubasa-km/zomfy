// The Linear source inside the Hub (docs/specs/bots/sources/linear.md): issue comments and
// descriptions that mention the app, and `bot:<handle>` labels added to an issue, become deliveries
// by handle and Who can ask; the daemon's events become an "On it…" comment edited with the
// activity and plan and replaced by the reply (with an asked-by line), numbered questions answered
// by reply, and approvals left to Zomfy. Linear has no private replies: a non-asker gets a public
// note.

import { formatRef, limits, parseRef, type Action, type BotEvent, type ContextItem, type Delivery, type Failure, type HelloBot, type Prompt } from '../contract'
import type { OpResult, OutboundRunner } from '../outbound'
import {
  activityLine,
  askedByLine,
  checklist,
  endedText,
  fail,
  NOTES,
  numberedQuestion,
  ok,
  optionFromReply,
  pickBot,
  plainStyle,
  replyText,
  roleOf,
  settledText,
  withAskedBy,
  type ActionOutcome,
  type HubSource,
  type SourceHub
} from '../sources/common'
import { matchRules, queueTriggers, type SourceEvent } from '../sources/triggers'
import { COMMENT_LIMIT, ISSUE_ID, linearCall, type LinearResult } from './api'

export const LINEAR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS linear_convs (
     external_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, org TEXT NOT NULL, issue TEXT NOT NULL COLLATE NOCASE, issue_uuid TEXT NOT NULL,
     asker_id TEXT NOT NULL, askers TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS linear_turns (
     turn_id TEXT PRIMARY KEY, external_id TEXT NOT NULL, comment_id TEXT, line TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]',
     last_edit_at INTEGER NOT NULL DEFAULT 0, ended TEXT, replaced INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS linear_prompts (
     prompt_id TEXT PRIMARY KEY, external_id TEXT NOT NULL, body TEXT NOT NULL, comment_id TEXT, answered_by TEXT, cleared TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS linear_context (key TEXT PRIMARY KEY, external_id TEXT NOT NULL, author_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS linear_posts (key TEXT PRIMARY KEY, result TEXT NOT NULL, at INTEGER NOT NULL)`
]

const now = () => Date.now()
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

type ConvRow = { external_id: string; bot_id: string; org: string; issue: string; issue_uuid: string; asker_id: string; askers: string }
type TurnRow = { turn_id: string; external_id: string; comment_id: string | null; line: string; steps: string; last_edit_at: number; ended: string | null; replaced: number }
type PromptRow = { prompt_id: string; external_id: string; body: string; comment_id: string | null; answered_by: string | null; cleared: string | null }

/** The issue as the source reads it. */
interface IssueInfo {
  id: string
  identifier: string
  title: string
  description?: string | null
  url?: string
  team?: { key?: string } | null
  state?: { name?: string } | null
}

type Op =
  | { t: 'comment'; issueUuid: string; body: string; as?: 'status' | 'prompt' | 'note'; turnId?: string; promptId?: string }
  | { t: 'status'; turnId: string }
  | { t: 'reply'; conv: string; turnId: string; body: string }
  | { t: 'ended'; turnId: string; outcome: string }
  | { t: 'edit'; promptId: string; body: string }

const ISSUE_FIELDS = 'id identifier title description url team { key } state { name }'

export class LinearSource implements HubSource, OutboundRunner {
  readonly name = 'linear' as const
  readonly verbs = ['reply', 'post', 'react', 'read', 'find', 'edit', 'delete'] as const
  private viewer: { id: string; name: string; displayName: string } | null = null

  constructor(private readonly hub: SourceHub) {
    for (const statement of LINEAR_SCHEMA) hub.sql.exec(statement)
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
    return this.sql.exec<ConvRow>('SELECT * FROM linear_convs WHERE external_id = ?', externalId).toArray()[0]
  }

  /** The app's own Linear user: its comments are the bot's, and it is who gets mentioned or assigned. */
  private async self(): Promise<{ id: string; name: string; displayName: string }> {
    if (this.viewer) return this.viewer
    const res = await linearCall<{ viewer: { id: string; name: string; displayName: string } }>(this.env, 'query { viewer { id name displayName } }', {}, AbortSignal.timeout(2000)).catch(() => null)
    if (res?.ok && res.data) this.viewer = res.data.viewer
    return this.viewer ?? { id: '', name: 'Zomfy', displayName: 'zomfy' }
  }

  private mentionRe(self: { name: string; displayName: string }) {
    const names = [...new Set([self.displayName, self.name, 'zomfy'].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))]
    // As typed (`@zomfy`), or as Linear writes a mention: a link to the profile.
    return new RegExp(`(?:\\[@?(?:${names.join('|')})\\]\\([^)]*\\)|(^|[^\\w])@(?:${names.join('|')})(?![\\w-]))`, 'i')
  }

  private async issue(id: string): Promise<IssueInfo | null> {
    const res = await linearCall<{ issue: IssueInfo }>(this.env, `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id }, AbortSignal.timeout(3000)).catch(() => null)
    return res?.ok ? (res.data?.issue ?? null) : null
  }

  // --- Inbound: webhooks (the signature is checked by the Worker) ---

  async onWebhook(deliveryId: string, payload: any): Promise<void> {
    if (!this.hub.markSeen(`linear:${deliveryId}`)) return
    const org = String(payload?.organizationId ?? '')
    const actor: { id?: string; name?: string } = payload?.actor ?? {}
    const self = await this.self()
    if (!org || !actor.id || actor.id === self.id) return
    const data = payload.data ?? {}
    const from = payload.updatedFrom ?? {}
    const mention = this.mentionRe(self)
    const events: SourceEvent[] = []
    let ask: { issueId: string; text: string; kind: 'comment' | 'description' | 'label'; commentId?: string; handle?: string } | null = null
    let issue: IssueInfo | null = null

    if (payload.type === 'Comment' && payload.action === 'create') {
      const body = String(data.body ?? '')
      issue = data.issue?.identifier ? (data.issue as IssueInfo) : await this.issue(String(data.issueId ?? data.issue?.id ?? ''))
      if (!issue) return
      const mentioned = mention.test(body)
      if (mentioned) events.push(this.event('mentioned', deliveryId, org, issue, actor, body))
      ask = { issueId: issue.identifier, text: body, kind: 'comment', commentId: data.id }
      if (!mentioned) {
        await this.onReply(org, issue, actor, body, deliveryId)
        for (const e of events) await queueTriggers(this.hub, e)
        return
      }
    } else if (payload.type === 'Issue') {
      issue = data as IssueInfo
      if (!issue.identifier) return
      const description = String(data.description ?? '')
      if (payload.action === 'create') {
        events.push(this.event('issue_created', deliveryId, org, issue, actor, `${issue.title}\n\n${description}`))
        if (data.assigneeId && data.assigneeId === self.id) events.push(this.event('assigned', deliveryId, org, issue, actor, issue.title))
      }
      if (payload.action === 'update' && 'stateId' in from) events.push(this.event('issue_moved', deliveryId, org, issue, actor, issue.title))
      if (payload.action === 'update' && 'assigneeId' in from && data.assigneeId && data.assigneeId === self.id) events.push(this.event('assigned', deliveryId, org, issue, actor, issue.title))
      const newlyMentioned = mention.test(description) && (payload.action === 'create' || ('description' in from && !mention.test(String(from.description ?? ''))))
      if (newlyMentioned) {
        events.push(this.event('mentioned', deliveryId, org, issue, actor, description))
        ask = { issueId: issue.identifier, text: description, kind: 'description' }
      }
      // A `bot:<handle>` label added (not removed) asks that bot.
      const before = new Set<string>(Array.isArray(from.labelIds) ? from.labelIds : payload.action === 'create' ? [] : (data.labelIds ?? []))
      const added = ((data.labels ?? []) as { id: string; name: string }[]).filter((l) => !before.has(l.id) && /^bot:[a-z0-9][a-z0-9_-]*$/i.test(l.name))
      if (!ask && added.length) ask = { issueId: issue.identifier, text: '', kind: 'label', handle: added[0]!.name.slice(4).toLowerCase() }
    }

    let inTurn: string[] = []
    if (ask && issue) inTurn = await this.onAsk(org, issue, actor, ask, deliveryId, events)
    const skip = new Set(inTurn)
    for (const e of events) await queueTriggers(this.hub, e, undefined, skip)
    await this.hub.outbound.drain()
  }

  private event(kind: string, deliveryId: string, org: string, issue: IssueInfo, actor: { id?: string; name?: string }, text: string): SourceEvent {
    const ref = formatRef({ source: 'linear', org, issue: issue.identifier })
    return {
      source: 'linear',
      kind,
      key: `${deliveryId}:${kind}`,
      actorId: actor.id ?? '',
      ...(actor.name ? { actor: actor.name } : {}),
      placeRef: ref,
      place: issue.team?.key ?? undefined,
      subject: issue.identifier,
      subjectRef: ref,
      ...(issue.url ? { url: issue.url } : {}),
      text: text.slice(0, limits.maxRuleTextChars),
      ...(issue.team?.key ? { team: issue.team.key } : {}),
      ...(issue.state?.name ? { state: issue.state.name } : {}),
      occurredAt: now(),
      selfIds: this.viewer?.id ? [this.viewer.id] : [],
      conversation: { source: 'linear', externalId: `${org}:${issue.identifier}` }
    }
  }

  /** A comment without a mention: the answer to an open question, or context. */
  private async onReply(org: string, issue: IssueInfo, actor: { id?: string; name?: string }, body: string, deliveryId: string) {
    const conv = this.conv(`${org}:${issue.identifier}`)
    if (!conv) return
    const bot = this.bot(conv.bot_id)
    if (!bot) return
    const role = roleOf(bot, 'linear', actor.id!)
    const open = role === 'other' ? undefined : this.sql.exec<PromptRow>('SELECT * FROM linear_prompts WHERE external_id = ? AND cleared IS NULL AND answered_by IS NULL ORDER BY created_at DESC LIMIT 1', conv.external_id).toArray()[0]
    const prompt = open && (JSON.parse(open.body) as Prompt)
    if (!open || !prompt || prompt.kind !== 'question') {
      this.sql.exec('INSERT OR IGNORE INTO linear_context (key, external_id, author_id, author, text, at) VALUES (?, ?, ?, ?, ?, ?)', deliveryId, conv.external_id, actor.id!, actor.name ?? actor.id!, body.slice(0, 4000), now())
      return
    }
    this.sql.exec('UPDATE linear_prompts SET answered_by = ? WHERE prompt_id = ?', actor.name ?? actor.id!, open.prompt_id)
    await this.hub.enqueue({
      id: `linear-${deliveryId}`,
      kind: 'answer',
      botId: bot.id,
      conversation: { source: 'linear', externalId: conv.external_id },
      askedAt: now(),
      asker: { source: 'linear', id: actor.id!, name: actor.name ?? actor.id!, role },
      promptId: open.prompt_id,
      ...optionFromReply(prompt.options, body)
    })
  }

  /** A mention or a bot label; returns the asked bot's rules run inside its turn. */
  private async onAsk(org: string, issue: IssueInfo, actor: { id?: string; name?: string }, ask: { text: string; kind: 'comment' | 'description' | 'label'; handle?: string }, deliveryId: string, events: SourceEvent[]): Promise<string[]> {
    const externalId = `${org}:${issue.identifier}`
    const conv = this.conv(externalId)
    const afterMention = ask.text.replace(this.mentionRe(await this.self()), '$1').trim()
    const bots = this.hub.bots()
    const named = ask.handle !== undefined ? { bot: bots.find((b) => b.handle === ask.handle) ?? null, text: '', named: true } : pickBot(bots, afterMention)
    const bot = conv && !named.named ? (this.bot(conv.bot_id) ?? named.bot) : named.bot
    const text = ask.kind === 'label' ? issue.title : named.named ? named.text : afterMention
    const name = actor.name ?? actor.id!
    const issueUuid = issue.id
    if (!bot) {
      this.queueComment(issueUuid, `${name}: ${NOTES.unknownBot(bots.map((b) => b.handle), '@Zomfy')}`, `linear:nobot:${deliveryId}`, issue.identifier)
      return []
    }
    const role = roleOf(bot, 'linear', actor.id!)
    if (role === 'other') {
      if (/^request access\b/i.test(text)) {
        await this.hub.enqueue({
          id: `linear-access-${bot.id}-${actor.id}`,
          kind: 'access_request',
          botId: bot.id,
          conversation: { source: 'linear', externalId: `access:${actor.id}:${issueUuid}:${issue.identifier}` },
          askedAt: now(),
          requester: { source: 'linear', id: actor.id!, name },
          message: `Asked on ${issue.identifier}`
        })
        this.queueComment(issueUuid, `${name}: ${NOTES.accessRequested}`, `linear:access:${deliveryId}`, issue.identifier)
        return []
      }
      this.queueComment(issueUuid, `${name}, you can’t ask ${bot.name} yet. Ask its owner to add you in Zomfy, or comment \`@Zomfy ${bot.handle} request access\`.`, `linear:askowner:${deliveryId}`, issue.identifier)
      return []
    }
    const rules = this.hub.rules()
    const ruleIds = [...new Set(events.flatMap((e) => matchRules(rules, [bot], e).map((m) => m.rule.id)))]
    const asker = { source: 'linear' as const, id: actor.id!, name, role }
    const askers = role === 'owner' ? [] : [name]
    const conversation = { source: 'linear' as const, externalId }
    if (conv) {
      this.sql.exec('UPDATE linear_convs SET asker_id = ?, bot_id = ?, askers = ? WHERE external_id = ?', actor.id!, bot.id, JSON.stringify([...new Set([...(JSON.parse(conv.askers) as string[]), ...askers])]), externalId)
      await this.hub.enqueue({ id: `linear-${deliveryId}`, kind: 'send', botId: bot.id, conversation, askedAt: now(), asker, text, context: this.takeContext(externalId, bot), ...(ruleIds.length ? { ruleIds } : {}) })
      return ruleIds
    }
    this.sql.exec(
      'INSERT OR REPLACE INTO linear_convs (external_id, bot_id, org, issue, issue_uuid, asker_id, askers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      externalId,
      bot.id,
      org,
      issue.identifier,
      issueUuid,
      actor.id!,
      JSON.stringify(askers),
      now()
    )
    const full = issue.description === undefined ? await this.issue(issue.identifier) : issue
    const context: ContextItem[] = [
      { label: 'issue', text: clip(`Linear issue ${issue.identifier}: ${issue.title}${full?.description && ask.kind !== 'description' ? `\n\n${full.description}` : ''}`, 32 * 1024) }
    ]
    context.push(...(await this.comments(bot, issue.identifier)))
    await this.hub.enqueue({
      id: `linear-${deliveryId}`,
      kind: 'start',
      botId: bot.id,
      conversation,
      askedAt: now(),
      asker,
      placeId: formatRef({ source: 'linear', org, issue: issue.identifier }),
      placeKind: 'issue',
      text,
      context,
      links: issue.url ? [{ url: issue.url, title: issue.identifier }] : [],
      attachments: [],
      ...(ruleIds.length ? { ruleIds } : {})
    })
    return ruleIds
  }

  /** The issue's last 20 comments, labelled. */
  private async comments(bot: HelloBot, identifier: string): Promise<ContextItem[]> {
    const res = await linearCall<{ issue: { comments: { nodes: { body: string; createdAt?: string; user?: { id: string; name: string } | null }[] } } }>(
      this.env,
      'query Comments($id: String!) { issue(id: $id) { comments(last: 20) { nodes { body createdAt user { id name } } } } }',
      { id: identifier },
      AbortSignal.timeout(3000)
    ).catch(() => null)
    const selfId = this.viewer?.id
    return (res?.data?.issue?.comments?.nodes ?? []).map((c) => {
      const id = c.user?.id ?? ''
      const label = id && id === selfId ? 'bot' : id && roleOf(bot, 'linear', id) !== 'other' ? 'earlier' : 'no_access'
      return { label, author: { id, name: c.user?.name ?? '' }, text: c.body.slice(0, 4000), at: Date.parse(c.createdAt ?? '') || undefined }
    })
  }

  private takeContext(externalId: string, bot: HelloBot): ContextItem[] {
    const rows = this.sql.exec<{ author_id: string; author: string; text: string; at: number }>('SELECT author_id, author, text, at FROM linear_context WHERE external_id = ? ORDER BY at LIMIT 20', externalId).toArray()
    this.sql.exec('DELETE FROM linear_context WHERE external_id = ?', externalId)
    return rows.map((r) => ({ label: roleOf(bot, 'linear', r.author_id) === 'other' ? 'no_access' : 'earlier', author: { id: r.author_id, name: r.author }, text: r.text, at: r.at }))
  }

  // --- The daemon's events (inside the Hub's events transaction: SQL only) ---

  onEvent(event: BotEvent): void {
    if (!('conversation' in event) || event.conversation.source !== 'linear') return
    const externalId = event.conversation.externalId
    if (event.kind === 'unlinked' || event.kind === 'chat-gone') {
      this.sql.exec('DELETE FROM linear_context WHERE external_id = ?', externalId)
      return
    }
    if (event.kind === 'access-answered') {
      const [, , issueUuid, identifier] = /^access:([^:]+):([^:]+):([^:]+)$/.exec(externalId) ?? []
      if (!issueUuid || !identifier) return
      const body = `${event.requester.name}: ${NOTES.accessAnswered(this.bot(event.botId)?.name ?? 'the bot', event.allowed)}`
      this.queueComment(issueUuid, body, `linear:access-answered:${externalId}:${now()}`, identifier)
      return
    }
    const conv = this.conv(externalId)
    if (!conv) return
    const botName = this.bot(conv.bot_id)?.name ?? 'The bot'
    const lane = `linear:${conv.issue.toUpperCase()}`
    switch (event.kind) {
      case 'turn-started':
        this.sql.exec('INSERT OR IGNORE INTO linear_turns (turn_id, external_id, line, created_at) VALUES (?, ?, ?, ?)', event.turnId, externalId, 'On it…', now())
        this.queue({ t: 'comment', issueUuid: conv.issue_uuid, body: 'On it…', as: 'status', turnId: event.turnId }, `linear:status:${event.turnId}`, lane)
        return
      case 'activity': {
        const turn = this.turn(event.turnId)
        if (!turn || turn.ended || turn.replaced) return
        this.sql.exec('UPDATE linear_turns SET line = ?, steps = ? WHERE turn_id = ?', activityLine(event.text, event.steps).replace('Working…', 'On it…'), JSON.stringify(event.steps), event.turnId)
        if (!this.hub.outbound.hasPending('linear', 'status', event.turnId)) {
          this.hub.outbound.queue('linear', { t: 'status', turnId: event.turnId }, `linear:status-edit:${event.turnId}:${now()}:${Math.random()}`, lane, turn.last_edit_at + limits.activityThrottleMs, event.turnId)
        }
        return
      }
      case 'turn-ended':
        this.sql.exec('UPDATE linear_turns SET ended = ? WHERE turn_id = ?', event.outcome, event.turnId)
        this.queue({ t: 'ended', turnId: event.turnId, outcome: event.outcome }, `linear:ended:${event.turnId}`, lane)
        return
      case 'reply': {
        let text = replyText(event.outcome, event.text, event.failure, plainStyle)
        if (text === null) return
        if (event.prLinks.length) text += `\n\n${event.prLinks.join('\n')}`
        text = withAskedBy(text, askedByLine(JSON.parse(conv.askers) as string[], botName))
        this.sql.exec("UPDATE linear_convs SET askers = '[]' WHERE external_id = ?", externalId)
        this.sql.exec('INSERT OR IGNORE INTO linear_turns (turn_id, external_id, line, created_at) VALUES (?, ?, ?, ?)', event.turnId, externalId, 'On it…', now())
        this.sql.exec('UPDATE linear_turns SET replaced = 1 WHERE turn_id = ?', event.turnId)
        this.queue({ t: 'reply', conv: externalId, turnId: event.turnId, body: clip(text, COMMENT_LIMIT) }, `linear:reply:${event.idempotencyKey}`, lane)
        return
      }
      case 'prompt':
        this.sql.exec('INSERT OR IGNORE INTO linear_prompts (prompt_id, external_id, body, created_at) VALUES (?, ?, ?, ?)', event.promptId, externalId, JSON.stringify(event.prompt), now())
        this.queue({ t: 'comment', issueUuid: conv.issue_uuid, body: this.promptText(event.prompt, botName), as: 'prompt', promptId: event.promptId }, `linear:prompt:${event.promptId}`, lane)
        return
      case 'prompt-cleared': {
        const prompt = this.sql.exec<PromptRow>('SELECT * FROM linear_prompts WHERE prompt_id = ?', event.promptId).toArray()[0]
        if (!prompt || prompt.cleared) return
        this.sql.exec('UPDATE linear_prompts SET cleared = ? WHERE prompt_id = ?', event.by ?? 'zomfy', event.promptId)
        const note = event.by === 'source' && prompt.answered_by ? `Answered by ${prompt.answered_by}.` : event.by === 'expired' ? 'Expired.' : 'Answered in Zomfy.'
        this.queue({ t: 'edit', promptId: event.promptId, body: `${this.promptText(JSON.parse(prompt.body) as Prompt, botName)}\n\n_${note}_` }, `linear:prompt-cleared:${event.promptId}`, lane)
        return
      }
      default:
        return
    }
  }

  private promptText(prompt: Prompt, botName: string): string {
    if (prompt.kind === 'question') return numberedQuestion(prompt, botName)
    if (prompt.kind === 'approval') return `${botName} needs an approval in Zomfy to use **${prompt.tool}**:\n\n${prompt.summary}\n\n_Approvals asked on Linear are answered in Zomfy only._`
    return `${botName} needs you in Zomfy:\n\n${prompt.text}`
  }

  onSettled(delivery: Delivery, outcome: 'expired' | 'refused' | 'unsupported', failure?: Failure): void {
    if (delivery.conversation.source !== 'linear' || (delivery.kind !== 'start' && delivery.kind !== 'send')) return
    const conv = this.conv(delivery.conversation.externalId)
    if (!conv) return
    const text = settledText(outcome, this.bot(delivery.botId)?.name ?? 'The bot', failure, plainStyle)
    this.queue({ t: 'comment', issueUuid: conv.issue_uuid, body: text, as: 'note' }, `linear:settled:${delivery.id}`, `linear:${conv.issue.toUpperCase()}`)
  }

  purge(before: number) {
    this.sql.exec('DELETE FROM linear_turns WHERE created_at < ?', before)
    this.sql.exec('DELETE FROM linear_prompts WHERE created_at < ?', before)
    this.sql.exec('DELETE FROM linear_context WHERE at < ?', before)
    this.sql.exec('DELETE FROM linear_posts WHERE at < ?', before)
  }

  private turn(turnId: string): TurnRow | undefined {
    return this.sql.exec<TurnRow>('SELECT * FROM linear_turns WHERE turn_id = ?', turnId).toArray()[0]
  }

  private queueComment(issueUuid: string, body: string, key: string, identifier: string) {
    this.queue({ t: 'comment', issueUuid, body, as: 'note' }, key, `linear:${identifier.toUpperCase()}`)
  }

  private queue(op: Op, key: string, lane: string) {
    this.hub.outbound.queue('linear', op, key, lane)
  }

  // --- The outbound queue's runner ---

  private outcome(res: LinearResult, what: string): OpResult | null {
    if (res.ok) return null
    if (res.retryAfterMs !== null) return { status: 'wait', ms: res.retryAfterMs, global: true }
    if (res.status === 0 || res.status >= 500) return { status: 'retry' }
    return { status: 'fail', why: `${what}: ${res.message}` }
  }

  private async create(issueId: string, body: string): Promise<LinearResult<{ commentCreate: { success: boolean; comment: { id: string; url?: string } } }>> {
    return linearCall(this.env, 'mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }', { input: { issueId, body } })
  }

  private async update(id: string, body: string): Promise<LinearResult> {
    return linearCall(this.env, 'mutation Edit($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success } }', { id, input: { body } })
  }

  private statusBody(turn: TurnRow): string {
    const steps = JSON.parse(turn.steps) as { text: string; status: string }[]
    return steps.length ? `${turn.line}\n\n${checklist(steps)}` : turn.line
  }

  async run(op: Op): Promise<OpResult> {
    switch (op.t) {
      case 'comment': {
        const res = await this.create(op.issueUuid, op.body)
        const failed = this.outcome(res, 'comment')
        if (failed) return failed
        const id = res.data!.commentCreate.comment.id
        if (op.as === 'status' && op.turnId) this.sql.exec('UPDATE linear_turns SET comment_id = ?, last_edit_at = ? WHERE turn_id = ?', id, now(), op.turnId)
        if (op.as === 'prompt' && op.promptId) this.sql.exec('UPDATE linear_prompts SET comment_id = ? WHERE prompt_id = ?', id, op.promptId)
        return { status: 'done' }
      }
      case 'status': {
        const turn = this.turn(op.turnId)
        if (!turn?.comment_id || turn.ended || turn.replaced) return { status: 'done' }
        const res = await this.update(turn.comment_id, this.statusBody(turn))
        const failed = this.outcome(res, 'edit status')
        if (failed) return failed
        this.sql.exec('UPDATE linear_turns SET last_edit_at = ? WHERE turn_id = ?', now(), op.turnId)
        return { status: 'done' }
      }
      case 'ended': {
        const turn = this.turn(op.turnId)
        if (!turn?.comment_id || turn.replaced) return { status: 'done' }
        return this.outcome(await this.update(turn.comment_id, endedText(op.outcome as never)), 'end status') ?? { status: 'done' }
      }
      case 'reply': {
        const conv = this.conv(op.conv)
        if (!conv) return { status: 'done' }
        const turn = this.turn(op.turnId)
        // The "On it…" comment becomes the answer.
        const res = turn?.comment_id ? await this.update(turn.comment_id, op.body) : await this.create(conv.issue_uuid, op.body)
        return this.outcome(res, 'reply') ?? { status: 'done' }
      }
      case 'edit': {
        const prompt = this.sql.exec<PromptRow>('SELECT * FROM linear_prompts WHERE prompt_id = ?', op.promptId).toArray()[0]
        if (!prompt?.comment_id) return { status: 'done' }
        return this.outcome(await this.update(prompt.comment_id, op.body), 'clear prompt') ?? { status: 'done' }
      }
    }
  }

  // --- Actions ---

  async action(action: Action): Promise<ActionOutcome> {
    const args = action.args as Record<string, any>
    const check = (res: LinearResult, what: string) => (res.ok ? null : fail(res.retryAfterMs !== null ? 'rate_limited' : 'failed', `${what}: ${res.message}`))
    if (action.verb === 'find') {
      // Members for Who can ask: active people, never apps or guests.
      const query = String(args.text ?? args.name ?? '')
      const res = await linearCall<{ users: { nodes: { id: string; name: string; displayName?: string; active?: boolean; guest?: boolean; app?: boolean; avatarUrl?: string }[] } }>(
        this.env,
        'query Users($q: String!) { users(first: 50, filter: { or: [{ name: { containsIgnoreCase: $q } }, { displayName: { containsIgnoreCase: $q } }] }) { nodes { id name displayName active guest app avatarUrl } } }',
        { q: query }
      )
      const failed = check(res, 'find')
      if (failed) return failed
      const members = res.data!.users.nodes.filter((u) => u.active !== false && !u.guest && !u.app)
      return ok({ members: members.map((u) => ({ id: u.id, name: u.name, ...(u.displayName ? { handle: u.displayName } : {}), ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}) })), complete: members.length < 50 })
    }
    const ref = action.ref ? parseRef(action.ref) : null
    if (!ref || ref.source !== 'linear' || !ISSUE_ID.test(ref.issue)) return fail('bad_ref', 'a Linear issue ref is needed: linear:<org>:<ENG-123>')
    switch (action.verb) {
      case 'reply':
      case 'post': {
        if (typeof args.text !== 'string' || !args.text) return fail('invalid_args', 'text is needed')
        const key = action.idempotencyKey ?? (typeof args.postId === 'string' ? args.postId : undefined)
        const done = key ? this.sql.exec<{ result: string }>('SELECT result FROM linear_posts WHERE key = ?', key).toArray()[0] : undefined
        if (done) return ok(JSON.parse(done.result))
        const issue = await this.issue(ref.issue)
        if (!issue) return fail('not_found', `no issue ${ref.issue}`)
        const res = await this.create(issue.id, clip(args.text, COMMENT_LIMIT))
        const failed = check(res, 'comment')
        if (failed) return failed
        const result = { commentId: res.data!.commentCreate.comment.id }
        if (key) this.sql.exec('INSERT OR REPLACE INTO linear_posts (key, result, at) VALUES (?, ?, ?)', key, JSON.stringify(result), now())
        return ok(result)
      }
      case 'react': {
        if (!args.commentId || !args.emoji) return fail('invalid_args', 'commentId and emoji are needed')
        const res = await linearCall(this.env, 'mutation React($input: ReactionCreateInput!) { reactionCreate(input: $input) { success } }', { input: { commentId: String(args.commentId), emoji: String(args.emoji) } })
        return check(res, 'react') ?? ok({})
      }
      case 'read': {
        const res = await linearCall<{ issue: IssueInfo & { comments: { nodes: { id: string; body: string; user?: { name: string } }[] } } }>(
          this.env,
          `query Read($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} comments(last: 50) { nodes { id body user { name } } } } }`,
          { id: ref.issue }
        )
        const failed = check(res, 'read')
        if (failed) return failed
        const issue = res.data!.issue
        return ok({ identifier: issue.identifier, title: issue.title, description: issue.description ?? '', state: issue.state?.name, team: issue.team?.key, url: issue.url, comments: issue.comments.nodes.map((c) => ({ id: c.id, author: c.user?.name, text: c.body })) })
      }
      case 'edit': {
        if (!args.commentId || typeof args.text !== 'string') return fail('invalid_args', 'commentId and text are needed')
        return check(await this.update(String(args.commentId), clip(args.text, COMMENT_LIMIT)), 'edit') ?? ok({})
      }
      case 'delete': {
        if (!args.commentId) return fail('invalid_args', 'commentId is needed')
        return check(await linearCall(this.env, 'mutation Delete($id: String!) { commentDelete(id: $id) { success } }', { id: String(args.commentId) }), 'delete') ?? ok({})
      }
      default:
        return fail('unsupported', `${action.verb} is not available for Linear`)
    }
  }
}
