// The GitHub source inside the Hub (docs/specs/bots/sources/github.md): turns the app's webhooks
// into deliveries (mentions by handle and Who can ask, answers by reply, PR events for the owner's
// own pull requests, triggers), and the daemon's events into comments, reviews and a 👀 reaction.
// GitHub has no buttons and no private replies: questions are numbered comments, approvals are
// answered in Zomfy only, and a non-asker gets a public note.

import { formatRef, limits, parseRef, type Action, type BotEvent, type ContextItem, type Delivery, type Failure, type HelloBot, type Prompt } from '../contract'
import type { OpResult, OutboundRunner } from '../outbound'
import {
  askedByLine,
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
import { githubCall, REACTIONS, type GitHubResult } from './api'

export const GITHUB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS gh_convs (
     external_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, installation TEXT NOT NULL, repo TEXT NOT NULL COLLATE NOCASE,
     number INTEGER NOT NULL, is_pr INTEGER NOT NULL, asker_id TEXT NOT NULL, askers TEXT NOT NULL DEFAULT '[]',
     anchor TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS gh_convs_by_issue ON gh_convs (repo, number)`,
  `CREATE TABLE IF NOT EXISTS gh_turns (turn_id TEXT PRIMARY KEY, external_id TEXT NOT NULL, reaction TEXT, ended TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gh_prompts (
     prompt_id TEXT PRIMARY KEY, external_id TEXT NOT NULL, body TEXT NOT NULL, comment_id INTEGER,
     answered_by TEXT, cleared TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gh_context (
     key TEXT PRIMARY KEY, external_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)`,
  /** Checks that failed on a pull request, so a later success is `check_passed`. */
  `CREATE TABLE IF NOT EXISTS gh_checks (repo TEXT NOT NULL COLLATE NOCASE, number INTEGER NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (repo, number, name))`,
  `CREATE TABLE IF NOT EXISTS gh_posts (key TEXT PRIMARY KEY, result TEXT NOT NULL, at INTEGER NOT NULL)`
]

/** GitHub's comment limit. */
const COMMENT_LIMIT = 65_536
const CONTEXT_COMMENTS = 20

const now = () => Date.now()

type Anchor = { type: 'issue' } | { type: 'comment'; id: number } | { type: 'review_comment'; id: number }
type ConvRow = { external_id: string; bot_id: string; installation: string; repo: string; number: number; is_pr: number; asker_id: string; askers: string; anchor: string }
type PromptRow = { prompt_id: string; external_id: string; body: string; comment_id: number | null; answered_by: string | null; cleared: string | null }

type Op =
  | { t: 'comment'; installation: string; repo: string; number: number; body: string; as?: 'prompt' | 'note'; promptId?: string; turnId?: string }
  | { t: 'review'; installation: string; repo: string; number: number; body: string; notes: { path: string; line?: number; side?: 'LEFT' | 'RIGHT'; body: string }[]; turnId: string }
  | { t: 'react'; conv: string; turnId: string }
  | { t: 'unreact'; turnId: string }
  | { t: 'edit-comment'; installation: string; repo: string; commentId?: number; promptId?: string; body: string }

/** Who did it, as GitHub's webhooks tell. */
interface Sender {
  login: string
  type?: string
}

const tidy = (text: string | null | undefined) => (text ?? '').replace(/\r\n/g, '\n')
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export class GitHubSource implements HubSource, OutboundRunner {
  readonly name = 'github' as const
  readonly verbs = ['reply', 'post', 'react', 'read', 'edit', 'delete', 'check'] as const

  constructor(private readonly hub: SourceHub) {
    for (const statement of GITHUB_SCHEMA) hub.sql.exec(statement)
  }

  private get sql() {
    return this.hub.sql
  }

  private get env() {
    return this.hub.env
  }

  private get slug() {
    return (this.env.GITHUB_APP_SLUG ?? 'zomfy').toLowerCase()
  }

  /** The app's own login, as its comments and reviews show it. */
  private get selfLogin() {
    return `${this.slug}[bot]`
  }

  private bot(id: string): HelloBot | undefined {
    return this.hub.bots().find((b) => b.id === id)
  }

  private conv(externalId: string): ConvRow | undefined {
    return this.sql.exec<ConvRow>('SELECT * FROM gh_convs WHERE external_id = ?', externalId).toArray()[0]
  }

  /** The conversation of an issue, whatever installation it came through. */
  private convOf(repo: string, number: number): ConvRow | undefined {
    return this.sql.exec<ConvRow>('SELECT * FROM gh_convs WHERE repo = ? AND number = ? ORDER BY created_at DESC LIMIT 1', repo, number).toArray()[0]
  }

  private mentionRe() {
    const slug = this.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\w/-])@${slug}(?![\\w-])`, 'i')
  }

  // --- Inbound: webhooks (the signature is checked by the Worker) ---

  async onWebhook(event: string, deliveryId: string, payload: any): Promise<void> {
    if (!this.hub.markSeen(`github:${deliveryId}`)) return
    const installation = String(payload?.installation?.id ?? '')
    const sender: Sender | undefined = payload?.sender
    const repo: string | undefined = payload?.repository?.full_name
    if (!installation || !repo || !sender?.login) return
    // The bot never acts on, or triggers on, its own doings.
    if (sender.login.toLowerCase() === this.selfLogin) return
    const action: string = payload.action ?? ''
    const ask = this.askOf(event, action, payload)
    const events = this.triggerEvents(event, action, payload, installation, repo, sender, deliveryId, ask?.mentioned ?? false)
    // Rules of the asked bot that the same event matches run inside its turn.
    const inTurn = ask ? await this.onAsk({ ...ask, installation, repo, sender, deliveryId, events }) : []
    await this.prEvents(event, action, payload, installation, repo, sender, deliveryId, Boolean(ask?.mentioned))
    const skip = new Set(inTurn)
    for (const e of events) await queueTriggers(this.hub, e, undefined, skip)
    await this.hub.outbound.drain()
  }

  /** The text that may ask the bot, and where it was written. */
  private askOf(event: string, action: string, payload: any): { number: number; isPr: boolean; title: string; body: string; text: string; anchor: Anchor; url?: string; mentioned: boolean; issueBody: string } | null {
    let found: { number: number; isPr: boolean; title: string; text: string; anchor: Anchor; url?: string; issueBody: string } | null = null
    if (event === 'issue_comment' && action === 'created') {
      found = { number: payload.issue.number, isPr: Boolean(payload.issue.pull_request), title: payload.issue.title, text: tidy(payload.comment.body), anchor: { type: 'comment', id: payload.comment.id }, url: payload.comment.html_url, issueBody: tidy(payload.issue.body) }
    } else if (event === 'pull_request_review_comment' && action === 'created') {
      found = { number: payload.pull_request.number, isPr: true, title: payload.pull_request.title, text: tidy(payload.comment.body), anchor: { type: 'review_comment', id: payload.comment.id }, url: payload.comment.html_url, issueBody: tidy(payload.pull_request.body) }
    } else if (event === 'pull_request_review' && action === 'submitted' && payload.review?.body) {
      found = { number: payload.pull_request.number, isPr: true, title: payload.pull_request.title, text: tidy(payload.review.body), anchor: { type: 'issue' }, url: payload.review.html_url, issueBody: tidy(payload.pull_request.body) }
    } else if (event === 'issues' && action === 'opened') {
      found = { number: payload.issue.number, isPr: false, title: payload.issue.title, text: tidy(payload.issue.body), anchor: { type: 'issue' }, url: payload.issue.html_url, issueBody: '' }
    } else if (event === 'pull_request' && action === 'opened') {
      found = { number: payload.pull_request.number, isPr: true, title: payload.pull_request.title, text: tidy(payload.pull_request.body), anchor: { type: 'issue' }, url: payload.pull_request.html_url, issueBody: '' }
    }
    if (!found) return null
    return { ...found, body: found.text, mentioned: this.mentionRe().test(found.text) }
  }

  /** A mention, or a reply to an open question. Returns the asked bot's rules run inside its turn. */
  private async onAsk(a: { number: number; isPr: boolean; title: string; text: string; anchor: Anchor; url?: string; mentioned: boolean; issueBody: string; installation: string; repo: string; sender: Sender; deliveryId: string; events: SourceEvent[] }): Promise<string[]> {
    const login = a.sender.login
    const conv = this.convOf(a.repo, a.number)
    if (!a.mentioned) {
      // A comment without a mention answers the open question of the bot's conversation, if any.
      if (!conv || a.anchor.type === 'issue') {
        if (conv) this.keepContext(conv, a, login)
        return []
      }
      const bot = this.bot(conv.bot_id)
      if (!bot) return []
      const role = roleOf(bot, 'github', login, true)
      if (role === 'other') {
        this.keepContext(conv, a, login)
        return []
      }
      const open = this.sql
        .exec<PromptRow>("SELECT * FROM gh_prompts WHERE external_id = ? AND cleared IS NULL AND answered_by IS NULL ORDER BY created_at DESC LIMIT 1", conv.external_id)
        .toArray()[0]
      const prompt = open && (JSON.parse(open.body) as Prompt)
      if (!open || !prompt || prompt.kind !== 'question') {
        this.keepContext(conv, a, login)
        return []
      }
      this.sql.exec('UPDATE gh_prompts SET answered_by = ? WHERE prompt_id = ?', login, open.prompt_id)
      await this.hub.enqueue({
        id: `github-${a.deliveryId}`,
        kind: 'answer',
        botId: bot.id,
        conversation: { source: 'github', externalId: conv.external_id },
        askedAt: now(),
        asker: { source: 'github', id: login, name: login, role },
        promptId: open.prompt_id,
        ...optionFromReply(prompt.options, a.text)
      })
      return []
    }

    const afterMention = a.text.replace(this.mentionRe(), '$1').trim()
    const named = pickBot(this.hub.bots(), afterMention)
    const bot = conv && !named.named ? this.bot(conv.bot_id) ?? named.bot : named.bot
    const text = named.named ? named.text : afterMention
    const issue = { installation: a.installation, repo: a.repo, number: a.number }
    if (!bot) {
      this.queueComment(issue, `@${login} ${this.noBotNote()}`, `github:nobot:${a.deliveryId}`)
      return []
    }
    const role = roleOf(bot, 'github', login, true)
    if (role === 'other') {
      if (/^request access\b/i.test(text)) {
        await this.hub.enqueue({
          id: `github-access-${bot.id}-${login.toLowerCase()}`,
          kind: 'access_request',
          botId: bot.id,
          conversation: { source: 'github', externalId: `access:${login.toLowerCase()}` },
          askedAt: now(),
          requester: { source: 'github', id: login, name: login },
          message: `Asked on ${a.repo}#${a.number}`
        })
        this.queueComment(issue, `@${login} ${NOTES.accessRequested}`, `github:access:${a.deliveryId}`)
        return []
      }
      const owner = bot.owner.github
      this.queueComment(
        issue,
        `@${login}, you can’t ask ${bot.name} yet. Ask its owner${owner ? ` @${owner}` : ''} to add you in Zomfy, or comment \`@${this.slug} ${bot.handle} request access\`.`,
        `github:askowner:${a.deliveryId}`
      )
      return []
    }

    const externalId = conv?.external_id ?? `${a.installation}:${a.repo}:${a.number}`
    const conversation = { source: 'github' as const, externalId }
    const asker = { source: 'github' as const, id: login, name: login, role }
    const rules = this.hub.rules()
    const ruleIds = [...new Set(a.events.flatMap((e) => matchRules(rules, [bot], e).map((m) => m.rule.id)))]
    const askers = role === 'owner' ? [] : [login]
    if (conv) {
      const known = JSON.parse(conv.askers) as string[]
      this.sql.exec('UPDATE gh_convs SET asker_id = ?, anchor = ?, askers = ?, bot_id = ? WHERE external_id = ?', login, JSON.stringify(a.anchor), JSON.stringify([...new Set([...known, ...askers])]), bot.id, externalId)
      await this.hub.enqueue({
        id: `github-${a.deliveryId}`,
        kind: 'send',
        botId: bot.id,
        conversation,
        askedAt: now(),
        asker,
        text,
        context: this.takeContext(externalId),
        ...(ruleIds.length ? { ruleIds } : {})
      })
      return ruleIds
    }
    this.sql.exec(
      'INSERT OR REPLACE INTO gh_convs (external_id, bot_id, installation, repo, number, is_pr, asker_id, askers, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      externalId,
      bot.id,
      a.installation,
      a.repo,
      a.number,
      a.isPr ? 1 : 0,
      login,
      JSON.stringify(askers),
      JSON.stringify(a.anchor),
      now()
    )
    const context: ContextItem[] = []
    const issueText = a.anchor.type === 'issue' ? '' : a.issueBody
    context.push({ label: 'issue', text: clip(`${a.isPr ? 'Pull request' : 'Issue'} ${a.repo}#${a.number}: ${a.title}${issueText ? `\n\n${issueText}` : ''}`, 32 * 1024) })
    if (a.anchor.type !== 'issue') context.push(...(await this.commentContext(bot, a.installation, a.repo, a.number, a.anchor.id)))
    await this.hub.enqueue({
      id: `github-${a.deliveryId}`,
      kind: 'start',
      botId: bot.id,
      conversation,
      askedAt: now(),
      asker,
      placeId: formatRef({ source: 'github', installation: a.installation, repo: a.repo }),
      placeKind: a.isPr ? 'pull_request' : 'issue',
      text,
      context,
      links: a.url ? [{ url: a.url, title: `${a.repo}#${a.number}` }] : [],
      attachments: [],
      ...(ruleIds.length ? { ruleIds } : {})
    })
    return ruleIds
  }

  private noBotNote() {
    const bots = this.hub.bots()
    return bots.length ? NOTES.unknownBot(bots.map((b) => b.handle), `@${this.slug}`) : NOTES.noBots
  }

  private keepContext(conv: ConvRow, a: { text: string; deliveryId: string }, login: string) {
    this.sql.exec('INSERT OR IGNORE INTO gh_context (key, external_id, author, text, at) VALUES (?, ?, ?, ?, ?)', a.deliveryId, conv.external_id, login, a.text.slice(0, 4000), now())
  }

  private takeContext(externalId: string): ContextItem[] {
    const conv = this.conv(externalId)
    const bot = conv && this.bot(conv.bot_id)
    const rows = this.sql.exec<{ author: string; text: string; at: number }>('SELECT author, text, at FROM gh_context WHERE external_id = ? ORDER BY at LIMIT 20', externalId).toArray()
    this.sql.exec('DELETE FROM gh_context WHERE external_id = ?', externalId)
    return rows.map((r) => ({ label: bot && roleOf(bot, 'github', r.author, true) !== 'other' ? 'earlier' : 'no_access', author: { id: r.author, name: r.author }, text: r.text, at: r.at }))
  }

  /** The issue's last comments before the asking one, labelled. */
  private async commentContext(bot: HelloBot, installation: string, repo: string, number: number, before: number): Promise<ContextItem[]> {
    const res = await githubCall<{ id: number; body?: string; user?: { login: string }; created_at?: string }[]>(this.env, installation, 'GET', `/repos/${repo}/issues/${number}/comments?per_page=100`, undefined, AbortSignal.timeout(3000)).catch(() => null)
    if (!res?.ok || !Array.isArray(res.body)) return []
    return res.body
      .filter((c) => c.id !== before && c.body)
      .slice(-CONTEXT_COMMENTS)
      .map((c) => {
        const login = c.user?.login ?? ''
        const label = login.toLowerCase() === this.selfLogin ? 'bot' : roleOf(bot, 'github', login, true) === 'other' ? 'no_access' : 'earlier'
        return { label, author: { id: login, name: login }, text: tidy(c.body).slice(0, 4000), at: Date.parse(c.created_at ?? '') || undefined }
      })
  }

  // --- PR events for pull requests the bots' owner opened ---

  private async prEvents(event: string, action: string, payload: any, installation: string, repo: string, sender: Sender, deliveryId: string, mentioned: boolean) {
    let type: string | null = null
    let numbers: number[] = []
    let extra: { check?: string; reviewState?: string; url?: string; text?: string } = {}
    let pr: any = payload.pull_request
    if (event === 'check_run' && action === 'completed') {
      const run = payload.check_run
      numbers = (run.pull_requests ?? []).map((p: any) => p.number)
      const failed = ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion)
      if (failed) type = 'check_failed'
      else if (run.conclusion === 'success') type = 'check_passed'
      extra = { check: clip(String(run.name ?? 'check'), 256), url: run.html_url, text: run.output?.title ? clip(String(run.output.title), 4096) : undefined }
      pr = null
    } else if (event === 'issue_comment' && action === 'created' && payload.issue?.pull_request && !mentioned) {
      type = 'comment'
      numbers = [payload.issue.number]
      extra = { url: payload.comment.html_url, text: clip(tidy(payload.comment.body), 4096) }
      pr = null
    } else if (event === 'pull_request_review_comment' && action === 'created' && !mentioned) {
      type = 'review_comment'
      numbers = [pr.number]
      extra = { url: payload.comment.html_url, text: clip(tidy(payload.comment.body), 4096) }
    } else if (event === 'pull_request_review' && action === 'submitted' && !mentioned) {
      type = 'review'
      numbers = [pr.number]
      extra = { reviewState: String(payload.review.state ?? '').slice(0, 32), url: payload.review.html_url, text: payload.review.body ? clip(tidy(payload.review.body), 4096) : undefined }
    } else if (event === 'pull_request' && (action === 'closed' || action === 'reopened')) {
      type = action === 'reopened' ? 'reopened' : pr.merged ? 'merged' : 'closed'
      numbers = [pr.number]
      extra = { url: pr.html_url }
    }
    if (!type || !numbers.length) return
    const owners = new Map<string, HelloBot[]>()
    for (const b of this.hub.bots()) if (b.owner.github) owners.set(b.owner.github.toLowerCase(), [...(owners.get(b.owner.github.toLowerCase()) ?? []), b])
    if (!owners.size) return
    for (const number of numbers) {
      const pull = pr && pr.number === number ? pr : (await githubCall(this.env, installation, 'GET', `/repos/${repo}/pulls/${number}`, undefined, AbortSignal.timeout(3000)).catch(() => null))?.body
      if (!pull?.user?.login || !pull.head?.sha) continue
      // Only the owner's own pull requests, never a fork's.
      if (pull.head.repo?.full_name && pull.base?.repo?.full_name && pull.head.repo.full_name.toLowerCase() !== pull.base.repo.full_name.toLowerCase()) continue
      const bots = owners.get(String(pull.user.login).toLowerCase())
      if (!bots?.length) continue
      let kind = type
      if (event === 'check_run') {
        const name = extra.check ?? 'check'
        if (kind === 'check_failed') this.sql.exec('INSERT OR REPLACE INTO gh_checks (repo, number, name, at) VALUES (?, ?, ?, ?)', repo, number, name, now())
        else {
          // A pass counts only after a failure of the same check.
          const was = this.sql.exec('DELETE FROM gh_checks WHERE repo = ? AND number = ? AND name = ?', repo, number, name).rowsWritten
          if (!was) continue
          kind = 'check_passed'
        }
      }
      // One wake per host: the default bot of the owner's bots there, or the first.
      const byHost = new Map<string, HelloBot>()
      for (const b of bots) {
        const host = this.sql.exec<{ host_id: string }>('SELECT host_id FROM bots WHERE id = ?', b.id).toArray()[0]?.host_id ?? ''
        if (!byHost.has(host) || b.isDefault) byHost.set(host, b)
      }
      for (const [host, bot] of byHost) {
        await this.hub.enqueue({
          id: `github-pr-${deliveryId}-${number}${byHost.size > 1 ? `-${host}` : ''}`.slice(0, 128),
          kind: 'pr_event',
          botId: bot.id,
          conversation: { source: 'github', externalId: `${installation}:${repo}:${number}` },
          askedAt: now(),
          repo,
          number,
          branch: String(pull.head.ref).slice(0, 255),
          headSha: String(pull.head.sha),
          event: kind,
          actor: sender.login,
          ref: formatRef({ source: 'github', installation, repo, number }),
          ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
        })
      }
    }
  }

  // --- Triggers (Orca's GitHub kinds) ---

  private sourceEvent(kind: string, deliveryId: string, installation: string, repo: string, number: number | undefined, sender: Sender, text?: string, url?: string, more: Partial<SourceEvent> = {}): SourceEvent {
    return {
      source: 'github',
      kind,
      key: `${deliveryId}:${kind}`,
      actorId: sender.login,
      actor: sender.login,
      placeRef: formatRef({ source: 'github', installation, repo }),
      place: repo,
      ...(number !== undefined ? { subject: `${repo}#${number}`, subjectRef: formatRef({ source: 'github', installation, repo, number }) } : {}),
      ...(url ? { url } : {}),
      ...(text ? { text: text.slice(0, limits.maxRuleTextChars) } : {}),
      occurredAt: now(),
      selfIds: [this.selfLogin],
      ...(number !== undefined ? { conversation: { source: 'github' as const, externalId: `${installation}:${repo}:${number}` } } : {}),
      ...more
    }
  }

  private triggerEvents(event: string, action: string, payload: any, installation: string, repo: string, sender: Sender, deliveryId: string, mentioned: boolean): SourceEvent[] {
    const out: SourceEvent[] = []
    const add = (kind: string, number: number | undefined, text?: string, url?: string, more: Partial<SourceEvent> = {}) =>
      out.push(this.sourceEvent(kind, deliveryId, installation, repo, number, sender, text, url, more))
    const issue = payload.issue
    const pr = payload.pull_request
    switch (event) {
      case 'issues':
        if (action === 'opened') add('issue_opened', issue.number, `${issue.title}\n\n${tidy(issue.body)}`, issue.html_url)
        if (action === 'closed') add('issue_closed', issue.number, issue.title, issue.html_url)
        if (action === 'assigned') add('assigned', issue.number, issue.title, issue.html_url, { label: payload.assignee?.login })
        if (action === 'labeled') add('labeled', issue.number, issue.title, issue.html_url, { label: payload.label?.name })
        break
      case 'pull_request':
        if (action === 'opened') add('pr_opened', pr.number, `${pr.title}\n\n${tidy(pr.body)}`, pr.html_url)
        if (action === 'synchronize') add('pr_pushed', pr.number, pr.title, pr.html_url)
        if (action === 'closed') add(pr.merged ? 'pr_merged' : 'pr_closed', pr.number, pr.title, pr.html_url)
        if (action === 'ready_for_review') add('pr_ready', pr.number, pr.title, pr.html_url)
        if (action === 'review_requested') add('review_requested', pr.number, pr.title, pr.html_url)
        if (action === 'assigned') add('assigned', pr.number, pr.title, pr.html_url)
        if (action === 'labeled') add('labeled', pr.number, pr.title, pr.html_url, { label: payload.label?.name })
        // A pull request's mergeable state is known only when GitHub has worked it out and sent it.
        if (pr?.mergeable_state === 'dirty' && action !== 'closed') add('pr_conflicted', pr.number, pr.title, pr.html_url)
        break
      case 'issue_comment':
        if (action === 'created') {
          add('comment', issue.number, tidy(payload.comment.body), payload.comment.html_url)
          if (mentioned) add('mentioned', issue.number, tidy(payload.comment.body), payload.comment.html_url)
        }
        break
      case 'pull_request_review_comment':
        if (action === 'created') {
          add('review_comment', pr.number, tidy(payload.comment.body), payload.comment.html_url)
          if (mentioned) add('mentioned', pr.number, tidy(payload.comment.body), payload.comment.html_url)
        }
        break
      case 'pull_request_review':
        if (action === 'submitted') add('review', pr.number, tidy(payload.review.body), payload.review.html_url)
        break
      case 'check_run':
        if (action === 'completed') {
          const run = payload.check_run
          const kind = ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion) ? 'ci_failed' : run.conclusion === 'success' ? 'ci_passed' : null
          if (!kind) break
          const numbers: number[] = (run.pull_requests ?? []).map((p: any) => p.number)
          for (const n of numbers.length ? numbers : [undefined]) add(kind, n, `${run.name}: ${run.conclusion}`, run.html_url)
        }
        break
      case 'workflow_run':
        if (action === 'completed') {
          const run = payload.workflow_run
          add('workflow_finished', undefined, `${run.name}: ${run.conclusion}`, run.html_url, { run: String(run.id) })
        }
        break
      case 'deployment_status':
        if (['success', 'failure', 'error'].includes(payload.deployment_status?.state)) {
          add('deploy_finished', undefined, `${payload.deployment?.environment ?? 'deployment'}: ${payload.deployment_status.state}`, payload.deployment_status.target_url || undefined)
        }
        break
      case 'dependabot_alert':
      case 'code_scanning_alert':
      case 'security_advisory':
        if (['created', 'reopened', 'appeared_in_branch', 'published'].includes(action)) {
          const alert = payload.alert ?? payload.security_advisory
          add('security_alert', undefined, String(alert?.security_advisory?.summary ?? alert?.rule?.description ?? alert?.summary ?? event), alert?.html_url)
        }
        break
      default:
        break
    }
    return out
  }

  // --- The daemon's events (inside the Hub's events transaction: SQL only) ---

  onEvent(event: BotEvent): void {
    if (!('conversation' in event) || event.conversation.source !== 'github') return
    const externalId = event.conversation.externalId
    if (event.kind === 'unlinked' || event.kind === 'chat-gone') {
      this.sql.exec('DELETE FROM gh_context WHERE external_id = ?', externalId)
      return
    }
    const conv = this.conv(externalId)
    if (!conv) return
    const bot = this.bot(conv.bot_id)
    const botName = bot?.name ?? 'The bot'
    const issue = { installation: conv.installation, repo: conv.repo, number: conv.number }
    switch (event.kind) {
      case 'turn-started':
        this.sql.exec('INSERT OR IGNORE INTO gh_turns (turn_id, external_id, created_at) VALUES (?, ?, ?)', event.turnId, externalId, now())
        this.queue({ t: 'react', conv: externalId, turnId: event.turnId }, `github:react:${event.turnId}`, this.lane(conv))
        return
      case 'turn-ended':
        this.sql.exec('UPDATE gh_turns SET ended = ? WHERE turn_id = ?', event.outcome, event.turnId)
        this.queue({ t: 'unreact', turnId: event.turnId }, `github:unreact:${event.turnId}`, this.lane(conv))
        return
      case 'reply': {
        let text = replyText(event.outcome, event.text, event.failure, plainStyle)
        if (text === null) return
        if (event.prLinks.length) text += `\n\n${event.prLinks.join('\n')}`
        const names = JSON.parse(conv.askers) as string[]
        text = withAskedBy(text, askedByLine(names, botName))
        this.sql.exec("UPDATE gh_convs SET askers = '[]' WHERE external_id = ?", externalId)
        const key = `github:reply:${event.idempotencyKey}`
        if (event.reviewNotes.length && conv.is_pr) {
          this.queue({ t: 'review', ...issue, body: clip(text, COMMENT_LIMIT), notes: event.reviewNotes, turnId: event.turnId }, key, this.lane(conv))
        } else {
          const notes = event.reviewNotes.map((n) => `- \`${n.path}${n.line ? `:${n.line}` : ''}\`: ${n.body}`).join('\n')
          this.queue({ t: 'comment', ...issue, body: clip(notes ? `${text}\n\n${notes}` : text, COMMENT_LIMIT), turnId: event.turnId }, key, this.lane(conv))
        }
        this.queue({ t: 'unreact', turnId: event.turnId }, `github:unreact:${event.turnId}`, this.lane(conv))
        return
      }
      case 'prompt': {
        this.sql.exec('INSERT OR IGNORE INTO gh_prompts (prompt_id, external_id, body, created_at) VALUES (?, ?, ?, ?)', event.promptId, externalId, JSON.stringify(event.prompt), now())
        const body = this.promptText(event.prompt, botName)
        this.queue({ t: 'comment', ...issue, body, as: 'prompt', promptId: event.promptId }, `github:prompt:${event.promptId}`, this.lane(conv))
        return
      }
      case 'prompt-cleared': {
        const prompt = this.sql.exec<PromptRow>('SELECT * FROM gh_prompts WHERE prompt_id = ?', event.promptId).toArray()[0]
        if (!prompt || prompt.cleared) return
        this.sql.exec('UPDATE gh_prompts SET cleared = ? WHERE prompt_id = ?', event.by ?? 'zomfy', event.promptId)
        const note = event.by === 'source' && prompt.answered_by ? `Answered by @${prompt.answered_by}.` : event.by === 'expired' ? 'Expired.' : 'Answered in Zomfy.'
        const original = this.promptText(JSON.parse(prompt.body) as Prompt, botName)
        this.queue({ t: 'edit-comment', installation: conv.installation, repo: conv.repo, promptId: event.promptId, body: `${original}\n\n_${note}_` }, `github:prompt-cleared:${event.promptId}`, this.lane(conv))
        return
      }
      default:
        return
    }
  }

  /** Questions as numbered comments; approvals only in Zomfy, since a comment is easy to spoof by quoting. */
  private promptText(prompt: Prompt, botName: string): string {
    if (prompt.kind === 'question') return numberedQuestion(prompt, botName)
    if (prompt.kind === 'approval') return `${botName} needs an approval in Zomfy to use **${prompt.tool}**:\n\n${prompt.summary}\n\n_Approvals asked on GitHub are answered in Zomfy only._`
    return `${botName} needs you in Zomfy:\n\n${prompt.text}`
  }

  onSettled(delivery: Delivery, outcome: 'expired' | 'refused' | 'unsupported', failure?: Failure): void {
    if (delivery.conversation.source !== 'github' || (delivery.kind !== 'start' && delivery.kind !== 'send')) return
    const conv = this.conv(delivery.conversation.externalId)
    if (!conv) return
    const text = settledText(outcome, this.bot(delivery.botId)?.name ?? 'The bot', failure, plainStyle)
    this.queue({ t: 'comment', installation: conv.installation, repo: conv.repo, number: conv.number, body: `@${delivery.asker?.id ?? conv.asker_id} ${text}`, as: 'note' }, `github:settled:${delivery.id}`, this.lane(conv))
  }

  purge(before: number) {
    this.sql.exec('DELETE FROM gh_turns WHERE created_at < ?', before)
    this.sql.exec('DELETE FROM gh_prompts WHERE created_at < ?', before)
    this.sql.exec('DELETE FROM gh_context WHERE at < ?', before)
    this.sql.exec('DELETE FROM gh_checks WHERE at < ?', before)
    this.sql.exec('DELETE FROM gh_posts WHERE at < ?', before)
  }

  private lane(conv: { repo: string; number: number }) {
    return `github:${conv.repo.toLowerCase()}#${conv.number}`
  }

  private queueComment(issue: { installation: string; repo: string; number: number }, body: string, key: string) {
    this.queue({ t: 'comment', ...issue, body, as: 'note' }, key, this.lane(issue))
  }

  private queue(op: Op, key: string, lane: string) {
    this.hub.outbound.queue('github', op, key, lane)
  }

  // --- The outbound queue's runner ---

  private outcome(res: GitHubResult, what: string): OpResult | null {
    if (res.ok) return null
    if (res.retryAfterMs !== null) return { status: 'wait', ms: res.retryAfterMs, global: res.status === 403 || res.status === 429 }
    if (res.status === 0 || res.status >= 500) return { status: 'retry' }
    return { status: 'fail', why: `${what} ${res.status} ${res.message ?? ''}` }
  }

  private reactionPath(conv: ConvRow): string {
    const anchor = JSON.parse(conv.anchor) as Anchor
    if (anchor.type === 'comment') return `/repos/${conv.repo}/issues/comments/${anchor.id}/reactions`
    if (anchor.type === 'review_comment') return `/repos/${conv.repo}/pulls/comments/${anchor.id}/reactions`
    return `/repos/${conv.repo}/issues/${conv.number}/reactions`
  }

  async run(op: Op): Promise<OpResult> {
    switch (op.t) {
      case 'comment': {
        const res = await githubCall<{ id: number }>(this.env, op.installation, 'POST', `/repos/${op.repo}/issues/${op.number}/comments`, { body: op.body })
        const failed = this.outcome(res, 'comment')
        if (failed) return failed
        if (op.as === 'prompt' && op.promptId) this.sql.exec('UPDATE gh_prompts SET comment_id = ? WHERE prompt_id = ?', res.body!.id, op.promptId)
        return { status: 'done' }
      }
      case 'review': {
        const inline = op.notes.filter((n) => n.line !== undefined)
        const loose = op.notes.filter((n) => n.line === undefined)
        const body = loose.length ? `${op.body}\n\n${loose.map((n) => `- \`${n.path}\`: ${n.body}`).join('\n')}` : op.body
        const res = await githubCall(this.env, op.installation, 'POST', `/repos/${op.repo}/pulls/${op.number}/reviews`, {
          event: 'COMMENT',
          body,
          comments: inline.map((n) => ({ path: n.path, line: n.line, side: n.side ?? 'RIGHT', body: n.body }))
        })
        // A review GitHub refuses (a line outside the diff, a closed PR) becomes one comment.
        if (res.status === 422) {
          const all = `${op.body}\n\n${op.notes.map((n) => `- \`${n.path}${n.line ? `:${n.line}` : ''}\`: ${n.body}`).join('\n')}`
          const comment = await githubCall(this.env, op.installation, 'POST', `/repos/${op.repo}/issues/${op.number}/comments`, { body: clip(all, COMMENT_LIMIT) })
          return this.outcome(comment, 'comment') ?? { status: 'done' }
        }
        return this.outcome(res, 'review') ?? { status: 'done' }
      }
      case 'react': {
        const conv = this.conv(op.conv)
        if (!conv) return { status: 'done' }
        const turn = this.sql.exec<{ ended: string | null; reaction: string | null }>('SELECT ended, reaction FROM gh_turns WHERE turn_id = ?', op.turnId).toArray()[0]
        if (!turn || turn.ended || turn.reaction) return { status: 'done' }
        const path = this.reactionPath(conv)
        const res = await githubCall<{ id: number }>(this.env, conv.installation, 'POST', path, { content: 'eyes' })
        const failed = this.outcome(res, 'react')
        if (failed) return failed
        this.sql.exec('UPDATE gh_turns SET reaction = ? WHERE turn_id = ?', JSON.stringify({ path, id: res.body!.id, installation: conv.installation }), op.turnId)
        return { status: 'done' }
      }
      case 'unreact': {
        const turn = this.sql.exec<{ reaction: string | null }>('SELECT reaction FROM gh_turns WHERE turn_id = ?', op.turnId).toArray()[0]
        if (!turn?.reaction) return { status: 'done' }
        const reaction = JSON.parse(turn.reaction) as { path: string; id: number; installation: string }
        const res = await githubCall(this.env, reaction.installation, 'DELETE', `${reaction.path}/${reaction.id}`)
        if (res.ok || res.status === 404) {
          this.sql.exec('UPDATE gh_turns SET reaction = NULL WHERE turn_id = ?', op.turnId)
          return { status: 'done' }
        }
        return this.outcome(res, 'unreact') ?? { status: 'done' }
      }
      case 'edit-comment': {
        const id = op.commentId ?? (op.promptId ? this.sql.exec<{ comment_id: number | null }>('SELECT comment_id FROM gh_prompts WHERE prompt_id = ?', op.promptId).toArray()[0]?.comment_id : null)
        if (!id) return { status: 'done' }
        const res = await githubCall(this.env, op.installation, 'PATCH', `/repos/${op.repo}/issues/comments/${id}`, { body: clip(op.body, COMMENT_LIMIT) })
        return this.outcome(res, 'edit comment') ?? { status: 'done' }
      }
    }
  }

  // --- Actions ---

  async action(action: Action): Promise<ActionOutcome> {
    const ref = action.ref ? parseRef(action.ref) : null
    if (!ref || ref.source !== 'github') return fail('bad_ref', 'a GitHub ref is needed: github:<installation>:<owner/repo>:<number>')
    const args = action.args as Record<string, any>
    const { installation, repo, number } = ref
    const check = (res: GitHubResult, what: string) => (res.ok ? null : fail(res.retryAfterMs !== null ? 'rate_limited' : `http_${res.status}`, `${what}: ${res.message}`))
    switch (action.verb) {
      case 'reply':
      case 'post': {
        if (number === undefined || typeof args.text !== 'string' || !args.text) return fail('invalid_args', 'an issue ref and text are needed')
        const key = action.idempotencyKey ?? (typeof args.postId === 'string' ? args.postId : undefined)
        const done = key ? this.sql.exec<{ result: string }>('SELECT result FROM gh_posts WHERE key = ?', key).toArray()[0] : undefined
        if (done) return ok(JSON.parse(done.result))
        const res = await githubCall<{ id: number; html_url: string }>(this.env, installation, 'POST', `/repos/${repo}/issues/${number}/comments`, { body: clip(args.text, COMMENT_LIMIT) })
        const failed = check(res, 'comment')
        if (failed) return failed
        const result = { commentId: res.body!.id, url: res.body!.html_url }
        if (key) this.sql.exec('INSERT OR REPLACE INTO gh_posts (key, result, at) VALUES (?, ?, ?)', key, JSON.stringify(result), now())
        return ok(result)
      }
      case 'react': {
        const emoji = String(args.emoji ?? '')
        if (!REACTIONS.has(emoji)) return fail('invalid_args', `emoji is one of ${[...REACTIONS].join(', ')}`)
        const path = args.commentId ? `/repos/${repo}/issues/comments/${Number(args.commentId)}/reactions` : `/repos/${repo}/issues/${number}/reactions`
        const res = await githubCall(this.env, installation, 'POST', path, { content: emoji })
        return check(res, 'react') ?? ok({})
      }
      case 'read': {
        if (number === undefined) return fail('invalid_args', 'an issue ref is needed')
        const issue = await githubCall<any>(this.env, installation, 'GET', `/repos/${repo}/issues/${number}`)
        const failed = check(issue, 'read')
        if (failed) return failed
        const limit = Math.min(Number(args.limit ?? 30) || 30, 100)
        const comments = await githubCall<any[]>(this.env, installation, 'GET', `/repos/${repo}/issues/${number}/comments?per_page=100`)
        return ok({
          title: issue.body.title,
          body: issue.body.body ?? '',
          state: issue.body.state,
          author: issue.body.user?.login,
          comments: (comments.body ?? []).slice(-limit).map((c) => ({ id: c.id, author: c.user?.login, text: c.body ?? '', at: c.created_at }))
        })
      }
      case 'edit': {
        if (!args.commentId || typeof args.text !== 'string') return fail('invalid_args', 'commentId and text are needed')
        const res = await githubCall(this.env, installation, 'PATCH', `/repos/${repo}/issues/comments/${Number(args.commentId)}`, { body: clip(args.text, COMMENT_LIMIT) })
        return check(res, 'edit') ?? ok({})
      }
      case 'delete': {
        if (!args.commentId) return fail('invalid_args', 'commentId is needed')
        const res = await githubCall(this.env, installation, 'DELETE', `/repos/${repo}/issues/comments/${Number(args.commentId)}`)
        return check(res, 'delete') ?? ok({})
      }
      case 'check': {
        if (number === undefined) return fail('invalid_args', 'a pull request ref is needed')
        const pull = await githubCall<any>(this.env, installation, 'GET', `/repos/${repo}/pulls/${number}`)
        const failed = check(pull, 'check')
        if (failed) return failed
        const runs = await githubCall<{ check_runs: any[] }>(this.env, installation, 'GET', `/repos/${repo}/commits/${pull.body.head.sha}/check-runs?per_page=100`)
        return ok({
          state: pull.body.state,
          merged: pull.body.merged,
          mergeable: pull.body.mergeable,
          mergeableState: pull.body.mergeable_state,
          headSha: pull.body.head.sha,
          branch: pull.body.head.ref,
          checks: (runs.body?.check_runs ?? []).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url }))
        })
      }
      default:
        return fail('unsupported', `${action.verb} is not available for GitHub`)
    }
  }
}
