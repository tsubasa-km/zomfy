// Event trigger rules a host announces in `hello`. The Hub matches source events against them and
// queues a `trigger` delivery; a webhook's rule carries the hook's filters instead, and its calls
// come as `webhook_notice` deliveries.

import { z } from 'zod'
import { maxPlacesPerRule, maxRuleGraceMs, maxRuleTextChars } from '../limits'
import { refSchema, sourceSchema } from './refs'
import { webhookFiltersSchema } from './webhooks'

const ruleText = z.string().max(maxRuleTextChars)

/** What each source can start a bot automation on, as Orca's `AUTOMATION_EVENT_KINDS`. */
export const TRIGGER_KINDS = {
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
} as const

/**
 * GitHub kinds that are a state change: they fire whoever caused them, the owner too. The owner's
 * other GitHub events start nothing, except `pr_opened` for a rule with `fromOwner`.
 */
export const GITHUB_STATE_KINDS: readonly string[] = [
  'ci_failed',
  'ci_passed',
  'pr_merged',
  'pr_conflicted',
  'deploy_finished',
  'security_alert',
  'workflow_finished'
]

export const ruleSchema = z.object({
  id: z.string().min(1).max(128),
  botId: z.string().min(1).max(128),
  source: sourceSchema,
  kinds: z.array(z.string().min(1).max(64)).max(32),
  /** Refs of channels, repositories (`github:<installation>:<owner/repo>`) or issues; none means anywhere. */
  places: z.array(refSchema).max(maxPlacesPerRule),
  /** Only these people's events: their ids in the source, separated by commas or spaces. */
  from: ruleText.optional(),
  /** The owner's own events count too (GitHub: `pr_opened` only). */
  fromOwner: z.boolean().optional(),
  /** `labeled`: that label, in any case. */
  label: ruleText.optional(),
  /** `workflow_finished`: the one GitHub Actions run, by its id. */
  workflowRun: ruleText.optional(),
  inThread: z.boolean().optional(),
  graceMs: z.number().int().nonnegative().max(maxRuleGraceMs),
  /** Matched case-insensitively against the event's text. */
  textContains: z.string().min(1).max(200).optional(),
  /** One thread, PR or issue to follow, as a ref or as written (`owner/repo#7`, `ENG-123`). */
  subject: z.string().min(1).max(256).optional(),
  /** Linear: the team key (`ENG`) the issue is in. */
  team: z.string().min(1).max(64).optional(),
  /** Linear `issue_moved`: the workflow state names it moved to, in any case. */
  states: z.array(z.string().min(1).max(64)).max(10).optional(),
  /** A webhook rule (`source: webhook`): its hook and filters. */
  webhook: webhookFiltersSchema.extend({ hookId: z.string().min(1).max(64) }).optional()
})
export type Rule = z.infer<typeof ruleSchema>

/**
 * The `event` of a `trigger` delivery: what happened, for the run's quoted block. Its text is
 * someone else's words, so the daemon only ever quotes it.
 */
export const triggerEventSchema = z.object({
  source: sourceSchema,
  kind: z.string().min(1).max(64),
  /** The source's own id for the event: one run per key. */
  key: z.string().min(1).max(256),
  /** Who did it, by their id in the source, and whether that was the bot's owner. */
  actorId: z.string().max(128),
  fromOwner: z.boolean().optional(),
  actor: z.string().max(256).optional(),
  /** Where it happened, as a ref and as a name (`#eng`, `acme/app`, `ENG`). */
  placeRef: z.string().max(512).optional(),
  place: z.string().max(256).optional(),
  /** The thread, PR or issue; later events on it fold into its unfinished run. */
  subject: z.string().max(256).optional(),
  url: z.url().max(2048).optional(),
  text: z.string().max(maxRuleTextChars).optional(),
  occurredAt: z.number().int().nonnegative(),
  /** The conversation the event came in, for a rule that answers in the event's thread. */
  conversation: z.object({ source: sourceSchema, externalId: z.string().min(1).max(512) }).optional()
})
export type TriggerEvent = z.infer<typeof triggerEventSchema>
