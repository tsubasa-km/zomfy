import type {
  Automation,
  AutomationBotTarget,
  AutomationSourceTrigger,
  AutomationSourceTriggerKind,
  Bot
} from '@zomfy/protocol'

// A bot's schedules and event triggers (docs/specs/bots/daemon.md#schedules-and-triggers) as pure
// functions, for the automation editor, Settings → Bots and their tests.

export type BotTriggerSource = 'discord' | 'slack' | 'github' | 'linear' | 'webhook'

/**
 * What each source can start a bot automation on: the relay contract's `TRIGGER_KINDS`
 * (packages/relay-contract/src/bots/triggers.ts), copied since the desktop does not depend on it.
 */
export const BOT_TRIGGER_KINDS: Record<BotTriggerSource, readonly string[]> = {
  discord: ['message'],
  slack: ['mentioned', 'message', 'reaction'],
  github: [
    'issue_opened',
    'pr_opened',
    'pr_pushed',
    'pr_merged',
    'comment',
    'review_comment',
    'review',
    'mentioned',
    'review_requested',
    'assigned',
    'ci_failed',
    'ci_passed',
    'pr_conflicted',
    'pr_closed',
    'pr_ready',
    'labeled',
    'issue_closed',
    'deploy_finished',
    'security_alert',
    'workflow_finished'
  ],
  linear: ['assigned', 'mentioned', 'issue_created', 'issue_moved'],
  webhook: ['call']
}

export const BOT_TRIGGER_SOURCES: BotTriggerSource[] = ['discord', 'slack', 'github', 'linear', 'webhook']

const TRIGGER_KIND_OF: Record<BotTriggerSource, AutomationSourceTriggerKind> = {
  discord: 'discord-message',
  slack: 'slack-message',
  github: 'github-event',
  linear: 'linear-event',
  webhook: 'webhook'
}

export function triggerKindOf(source: BotTriggerSource): AutomationSourceTriggerKind {
  return TRIGGER_KIND_OF[source]
}

export function sourceOfTriggerKind(kind: string): BotTriggerSource | null {
  return BOT_TRIGGER_SOURCES.find((s) => TRIGGER_KIND_OF[s] === kind) ?? null
}

export function isSourceTrigger(trigger: { kind: string }): trigger is AutomationSourceTrigger {
  return sourceOfTriggerKind(trigger.kind) !== null
}

/** The bot fields of the automation editor's draft. */
export interface BotAutomationDraft {
  botId: string
  /** A schedule, or an event in one of the bot's sources. */
  mode: 'schedule' | 'trigger'
  runsIn: 'new' | 'chat'
  /** The chat `runsIn: 'chat'` continues. */
  chat: string
  resultsTo: 'chat' | 'thread' | 'none' | 'ref'
  resultsRef: string
  source: BotTriggerSource
  kinds: string[]
  /** Refs, one per line. */
  places: string
  from: string
  textContains: string
  /** `webhook`: the minted hook. */
  hookId: string
  /** The trigger as saved, so fields the editor does not show survive an edit. */
  base: AutomationSourceTrigger | null
}

export function initialBotDraft(bot: Pick<Bot, 'id'>, mode: 'schedule' | 'trigger', existing: Pick<Automation, 'bot' | 'trigger'> | null): BotAutomationDraft {
  const target = existing?.bot
  const trigger = existing && isSourceTrigger(existing.trigger) ? existing.trigger : null
  const resultsTo = target?.resultsTo
  return {
    botId: target?.botId ?? bot.id,
    mode: existing ? (trigger ? 'trigger' : 'schedule') : mode,
    runsIn: target?.runsIn ?? 'new',
    chat: target?.chat ?? '',
    resultsTo: resultsTo === undefined ? 'chat' : typeof resultsTo === 'object' ? 'ref' : resultsTo,
    resultsRef: typeof resultsTo === 'object' ? resultsTo.ref : '',
    source: (trigger && sourceOfTriggerKind(trigger.kind)) || 'discord',
    kinds: trigger ? [...trigger.kinds] : [],
    places: trigger ? trigger.places.join('\n') : '',
    from: trigger?.from ?? '',
    textContains: (trigger?.kind === 'webhook' ? trigger.webhook?.textContains : trigger?.textContains) ?? '',
    hookId: trigger?.webhook?.hookId ?? '',
    base: trigger
  }
}

/** The `bot` target the draft saves. */
export function botTargetOf(d: BotAutomationDraft): AutomationBotTarget {
  const resultsTo: AutomationBotTarget['resultsTo'] = d.resultsTo === 'ref' ? { ref: d.resultsRef.trim() } : d.resultsTo
  return {
    botId: d.botId,
    runsIn: d.runsIn,
    ...(d.runsIn === 'chat' && d.chat ? { chat: d.chat } : {}),
    resultsTo
  }
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** The source trigger the draft saves, keeping what the editor does not show from the saved one. */
export function sourceTriggerOf(d: BotAutomationDraft): AutomationSourceTrigger {
  const kind = triggerKindOf(d.source)
  // A changed source starts from nothing: another source's fields mean nothing here.
  const { from: _from, textContains: _text, webhook: oldHook, ...kept } = d.base && d.base.kind === kind ? d.base : { kind, kinds: [], places: [] }
  const allowed = BOT_TRIGGER_KINDS[d.source]
  const text = d.textContains.trim()
  const from = d.from.trim()
  if (d.source === 'webhook') {
    const { textContains: _hookText, ...hookKept } = oldHook ?? { hookId: d.hookId }
    return {
      ...kept,
      kind,
      kinds: d.kinds.filter((k) => allowed.includes(k)),
      places: [],
      ...(from ? { from } : {}),
      webhook: { ...hookKept, hookId: d.hookId, ...(text ? { textContains: text } : {}) }
    }
  }
  return {
    ...kept,
    kind,
    kinds: d.kinds.filter((k) => allowed.includes(k)),
    places: lines(d.places),
    ...(from ? { from } : {}),
    ...(text ? { textContains: text } : {})
  }
}

/** What the bot part of the draft still needs before it can be saved, or null. */
export function botDraftProblem(d: BotAutomationDraft): 'chat' | 'ref' | 'hook' | null {
  if (d.runsIn === 'chat' && !d.chat) return 'chat'
  if (d.resultsTo === 'ref' && !d.resultsRef.trim()) return 'ref'
  if (d.mode === 'trigger' && d.source === 'webhook' && !d.hookId) return 'hook'
  return null
}

/** A bot's automations, newest first. */
export function automationsForBot<A extends Pick<Automation, 'bot' | 'createdAt'>>(automations: readonly A[], botId: string): A[] {
  return automations.filter((a) => a.bot?.botId === botId).sort((a, b) => b.createdAt - a.createdAt)
}

/** The webhook URL and key `webhook.mint` answers, from the action's result as the daemon passes it on. */
export function mintedHook(result: unknown): { hookId: string; url: string; key: string; urlWithKey: string | null } | null {
  const inner = unwrapAction(result)
  if (!inner || typeof inner !== 'object') return null
  const r = inner as Record<string, unknown>
  if (typeof r.hookId !== 'string' || typeof r.url !== 'string' || typeof r.key !== 'string') return null
  return { hookId: r.hookId, url: r.url, key: r.key, urlWithKey: typeof r.urlWithKey === 'string' ? r.urlWithKey : null }
}

/** The members a source's `find` answers. */
export function foundMembers(result: unknown): { id: string; name: string; handle?: string }[] {
  const inner = unwrapAction(result)
  const members = inner && typeof inner === 'object' ? (inner as { members?: unknown }).members : undefined
  if (!Array.isArray(members)) return []
  return members.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    const { id, name, handle } = m as Record<string, unknown>
    if (typeof id !== 'string' || typeof name !== 'string') return []
    return [{ id, name, ...(typeof handle === 'string' ? { handle } : {}) }]
  })
}

/** An action's payload, whether the daemon hands back the outcome (`{ok, result}`) or the result itself. */
function unwrapAction(result: unknown): unknown {
  if (result && typeof result === 'object' && 'ok' in result) {
    const outcome = result as { ok: unknown; result?: unknown; error?: { message?: string } | string }
    if (outcome.ok === false) {
      const error = typeof outcome.error === 'string' ? outcome.error : outcome.error?.message
      throw new Error(error ?? 'The relay refused it.')
    }
    return outcome.result
  }
  return result
}
