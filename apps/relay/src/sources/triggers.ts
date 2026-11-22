// Event triggers (docs/specs/bots/contract.md#triggers): the Hub matches each source event against
// the rules the hosts announced and queues a `trigger` delivery per rule that matches. Orca's one
// matcher (`matchesTrigger`): the bot never starts itself, `from` narrows who may fire a rule, and
// each source says whether the owner's own events reach a rule at all. Who can ask does not gate
// triggers.

import { GITHUB_STATE_KINDS, limits, parseRef, type Conversation, type HelloBot, type Rule, type Source, type TriggerEvent } from '../contract'
import { sha256Short, type SourceHub } from './common'

/** An event as a source sees it, before it is matched. */
export interface SourceEvent {
  source: Exclude<Source, 'webhook'>
  kind: string
  /** The source's own id for the event: one run per rule and key. */
  key: string
  actorId: string
  actor?: string
  /** Where it happened, as a ref (`slack:T1:C1`, `github:42:acme/app`, `linear:org:ENG-1`). */
  placeRef?: string
  place?: string
  /** The thread, PR or issue, as a name (`acme/app#7`, `ENG-1`) and as a ref. */
  subject?: string
  subjectRef?: string
  url?: string
  text?: string
  label?: string
  run?: string
  team?: string
  state?: string
  occurredAt: number
  conversation?: Conversation
  /** The bot app's own user in the source: its own doings never fire a rule. */
  selfIds?: string[]
}

const same = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()

/** Whether the rule's place names where the event happened (refs by their ids; GitHub by repository, whatever the installation). */
export function samePlace(wanted: string, event: SourceEvent): boolean {
  const want = parseRef(wanted)
  if (!want) return same(wanted, event.place) || same(wanted, event.subject)
  for (const text of [event.placeRef, event.subjectRef]) {
    const got = text ? parseRef(text) : null
    if (!got || got.source !== want.source) continue
    switch (want.source) {
      case 'github':
        if (got.source === 'github' && same(got.repo, want.repo) && (want.number === undefined || got.number === want.number)) return true
        break
      case 'slack':
        if (got.source === 'slack' && got.team === want.team && got.channel === want.channel && (!want.threadTs || got.threadTs === want.threadTs)) return true
        break
      case 'discord':
        if (got.source === 'discord' && got.guild === want.guild && got.channel === want.channel) return true
        break
      case 'linear':
        if (got.source === 'linear' && got.org === want.org && same(got.issue, want.issue)) return true
        break
      default:
        break
    }
  }
  return false
}

function ownerOf(bot: HelloBot, source: Source) {
  return bot.owner[source]
}

/** Whether the owner's own event reaches this rule: on GitHub only state changes and `pr_opened` with `fromOwner`. */
function ownerReaches(rule: Rule, event: SourceEvent): boolean {
  if (event.source !== 'github') return true
  return GITHUB_STATE_KINDS.includes(event.kind) || (event.kind === 'pr_opened' && rule.fromOwner === true)
}

export function matchesRule(rule: Rule, bot: HelloBot, event: SourceEvent): boolean {
  if (rule.source !== event.source || !rule.kinds.includes(event.kind)) return false
  const anyCase = event.source === 'github'
  const isActor = (id: string | undefined) => id !== undefined && (anyCase ? same(id, event.actorId) : id === event.actorId)
  if ((event.selfIds ?? []).some(isActor)) return false
  const isOwner = isActor(ownerOf(bot, event.source))
  if (isOwner && !ownerReaches(rule, event)) return false
  const from = (rule.from ?? '').split(/[\s,]+/).filter(Boolean)
  if (from.length || rule.fromOwner) {
    if (!(from.some(isActor) || (rule.fromOwner === true && isOwner))) return false
  }
  if (rule.places.length && !rule.places.some((p) => samePlace(p, event))) return false
  if (rule.subject && !(same(rule.subject, event.subject) || same(rule.subject, event.subjectRef) || samePlace(rule.subject, { ...event, placeRef: event.subjectRef }))) return false
  if (rule.label && !same(rule.label, event.label)) return false
  if (rule.workflowRun && rule.workflowRun !== event.run) return false
  if (rule.team && !same(rule.team, event.team)) return false
  if (rule.states?.length && !rule.states.some((s) => same(s, event.state))) return false
  if (rule.textContains && !(event.text ?? '').slice(0, limits.maxRuleTextChars).toLowerCase().includes(rule.textContains.toLowerCase())) return false
  return true
}

/** The rules an event matches, with their bots (paused bots fire nothing). */
export function matchRules(rules: Rule[], bots: HelloBot[], event: SourceEvent): { rule: Rule; bot: HelloBot }[] {
  const out: { rule: Rule; bot: HelloBot }[] = []
  for (const rule of rules) {
    const bot = bots.find((b) => b.id === rule.botId)
    if (bot && !bot.paused && matchesRule(rule, bot, event)) out.push({ rule, bot })
  }
  return out
}

function triggerEvent(event: SourceEvent, bot: HelloBot): TriggerEvent {
  const isOwner = event.source === 'github' ? same(bot.owner.github, event.actorId) : bot.owner[event.source] === event.actorId
  const clip = (text: string | undefined, max: number) => (text === undefined ? undefined : text.slice(0, max))
  return {
    source: event.source,
    kind: event.kind,
    key: event.key.slice(0, 256),
    actorId: event.actorId.slice(0, 128),
    ...(isOwner ? { fromOwner: true } : {}),
    ...(event.actor ? { actor: clip(event.actor, 256) } : {}),
    ...(event.placeRef ? { placeRef: event.placeRef } : {}),
    ...(event.place ? { place: clip(event.place, 256) } : {}),
    ...(event.subject ? { subject: clip(event.subject, 256) } : {}),
    ...(event.url ? { url: event.url } : {}),
    ...(event.text ? { text: clip(event.text, limits.maxRuleTextChars) } : {}),
    occurredAt: event.occurredAt,
    ...(event.conversation ? { conversation: event.conversation } : {})
  }
}

/**
 * Queues a `trigger` delivery for every rule the event matches. Rules of `inTurnBot` (the bot the
 * same message asks) are not queued: their ids are returned, to run inside that turn.
 */
export async function queueTriggers(hub: SourceHub, event: SourceEvent, inTurnBot?: string): Promise<string[]> {
  const inTurn: string[] = []
  for (const { rule, bot } of matchRules(hub.rules(), hub.bots(), event)) {
    if (bot.id === inTurnBot) {
      inTurn.push(rule.id)
      continue
    }
    const askedAt = event.occurredAt || Date.now()
    await hub.enqueue({
      id: `trig-${await sha256Short(`${rule.id}|${event.key}`)}`,
      kind: 'trigger',
      botId: bot.id,
      conversation: event.conversation ?? { source: event.source, externalId: `trigger:${event.key}`.slice(0, 512) },
      askedAt,
      expiresAt: askedAt + limits.maxTriggerWaitMs,
      ruleId: rule.id,
      event: triggerEvent(event, bot),
      graceMs: rule.graceMs
    })
  }
  return inTurn
}
