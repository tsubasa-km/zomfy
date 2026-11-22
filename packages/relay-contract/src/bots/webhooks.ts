// Webhooks (docs/specs/bots/sources/webhooks.md): the names, the key and its redaction, the senders
// whose signatures the Hub checks, the one filter both sides run, the stored call the daemon fetches
// with `webhook.fetch`, and the arguments of the `webhook.*` actions. Copied from Orca's
// `webhook-names.ts`, `webhook-matcher.ts`, `webhook-envelope.ts` and `webhook-routes.ts`.

import { z } from 'zod'

// --- Names ---

/** Minted by the Hub. */
export const WEBHOOK_HOOK_ID_PATTERN = /^wh_[A-Za-z0-9]{16}$/
export const WEBHOOK_CALL_ID_PATTERN = /^call_[A-Za-z0-9]{20}$/

/** 256 random bits, base64url; the prefix lets scanners and the redaction find a key anywhere. */
export const WEBHOOK_KEY_PREFIX = 'zomfywh_'
export const WEBHOOK_KEY_PATTERN = /^zomfywh_[A-Za-z0-9_-]{43}$/

/** Callers POST to `<worker>/hooks/<hookId>` with the key as a Bearer token, or to `<worker>/hooks/<hookId>/<key>`. */
export const WEBHOOK_PATH_PREFIX = '/hooks/'

export function webhookPath(hookId: string, key?: string): string {
  return `${WEBHOOK_PATH_PREFIX}${hookId}${key === undefined ? '' : `/${key}`}`
}

// A key character's code, for its percent-encoded and JSON-escaped forms: 0-9, A-Z, a-z, _ and -.
const KEY_CHAR_CODE = '(?:3[0-9]|[46][1-9A-Fa-f]|[57][0-9Aa]|5[Ff]|2[Dd])'
// Markdown escapes _ and -.
const KEY_CHAR = String.raw`(?:[A-Za-z0-9_-]|\\[_-]|(?:%|\\u00)${KEY_CHAR_CODE})`

// A prefix character as written, Markdown-escaped, percent-encoded or JSON-escaped.
function writtenAs(char: string): string {
  const hex = char.charCodeAt(0).toString(16)
  const code = `${hex[0]}[${hex[1]?.toLowerCase()}${hex[1]?.toUpperCase()}]`
  const markdown = char === '_' ? String.raw`|\\_` : ''
  return String.raw`(?:${char}${markdown}|(?:%|\\u00)${code})`
}

// Any key token, as written or in the encodings ordinary output uses, and whatever follows a hook
// id in a URL path. Catches a key quoted by mistake, not one deliberately disguised.
const KEY_TOKEN = `${[...WEBHOOK_KEY_PREFIX].map(writtenAs).join('')}${KEY_CHAR}+`
const KEY_IN_PATH = String.raw`(?<=\/hooks\/wh_[A-Za-z0-9]{16}\/)[^\s/?#"'<>)\]]+`
const KEY_IN_TEXT = new RegExp(`${KEY_TOKEN}|${KEY_IN_PATH}`, 'g')

/** What a webhook key becomes in a stored call or an outbound post. */
export const REDACTED_WEBHOOK_KEY = '[zomfy webhook key]'

/** The text with every webhook key in it replaced, for text that leaves the Hub or the daemon. */
export function redactWebhookKeys(text: string, replacement = REDACTED_WEBHOOK_KEY): string {
  return text.replace(KEY_IN_TEXT, replacement)
}

/** Senders whose signatures the Hub checks natively; a hook without one is key-only. */
export const WEBHOOK_ADAPTERS = ['standard', 'github', 'sentry', 'linear', 'pagerduty', 'stripe'] as const
export type WebhookAdapterId = (typeof WEBHOOK_ADAPTERS)[number]

/** What a caller's 200 says: `{callId, status}`. None of them means the run is done. */
export const WEBHOOK_RECEIPT_STATUSES = ['queued', 'ignored', 'duplicate', 'paused'] as const
export type WebhookReceiptStatus = (typeof WEBHOOK_RECEIPT_STATUSES)[number]

/** Runs started per rolling hour: a hook's own cap (the owner may lower it) and the deployment's. */
export const WEBHOOK_RUN_CAPS = { hookDefault: 200, deployment: 300 } as const
/** Refused calls (bad key or signature) in this window that make one notice to the owner. */
export const WEBHOOK_REFUSAL_BURST = { count: 20, windowMs: 10 * 60 * 1000 } as const

export const WEBHOOK_NOTICE_CONDITIONS = ['refusal_burst', 'cap_reached'] as const
export type WebhookNoticeCondition = (typeof WEBHOOK_NOTICE_CONDITIONS)[number]

// --- The filter (Orca's webhook-matcher.ts) ---

export const WEBHOOK_FILTER_LIMITS = {
  maxWhere: 8,
  maxValues: 10,
  maxPick: 12,
  maxPathLength: 200,
  maxValueLength: 200,
  // As every trigger event's subject. A longer value folds nothing, rather than folding on a prefix.
  maxSubjectLength: 256
} as const

// The receiver refuses a parsed body past these before matching or storing it: JSON.stringify
// recurses, so a deep body within the byte cap could exhaust the stack.
export const WEBHOOK_BODY_LIMITS = { maxDepth: 128, maxNodes: 100_000 } as const

/** `in` takes up to maxValues values; `=`, `!=` and `contains` one; `exists` and `!exists` none. */
export const WEBHOOK_WHERE_OPS = ['=', '!=', 'in', 'contains', 'exists', '!exists'] as const
export type WebhookWhereOp = (typeof WEBHOOK_WHERE_OPS)[number]

/** One clause, `path op values`. Clauses are ANDed; there is no OR. */
export type WebhookWhere = { path: string; op: WebhookWhereOp; values?: string[] }

/** A webhook rule's filters. */
export type WebhookFilters = {
  where?: WebhookWhere[]
  /** Case-insensitive, in the body's text; a JSON or form body is read as its JSON. */
  textContains?: string
  /** Fields quoted to the run, in this order. */
  pick?: string[]
  /** Where each call's subject is; later calls with the same subject fold into its open run. */
  subjectFrom?: string
  /** A fixed value the subject must equal. */
  subject?: string
}

/**
 * What filters read: a call with the hook's own key scrubbed, header names in lower case. The body
 * is parsed JSON, a form as an object whose repeated keys are arrays, or any other body as its
 * text.
 */
export type WebhookCallView = { headers: Readonly<Record<string, string>>; body: unknown }

type Step = string | number

const SEGMENT = /^([^.[\]\s]+)((?:\[\d{1,6}\])*)$/
// Refused when a rule is saved, so no path reaches into what an object inherits.
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const ROOTS = new Set(['body', 'headers'])

// "body.data.items[0].id": dot-separated keys, [n] for an array item. Keys holding a dot can't be named.
function pathSteps(path: string): Step[] | null {
  if (path.length === 0 || path.length > WEBHOOK_FILTER_LIMITS.maxPathLength) return null
  const steps: Step[] = []
  for (const part of path.split('.')) {
    const match = SEGMENT.exec(part)
    const key = match?.[1]
    if (key === undefined || FORBIDDEN_SEGMENTS.has(key)) return null
    // Header names match in any case, as in HTTP.
    steps.push(steps.length === 1 && steps[0] === 'headers' ? key.toLowerCase() : key)
    for (const [, index] of match?.[2]?.matchAll(/\[(\d+)\]/g) ?? []) steps.push(Number(index))
  }
  return typeof steps[0] === 'string' && ROOTS.has(steps[0]) ? steps : null
}

function valueAt(call: WebhookCallView, path: string): unknown {
  const steps = pathSteps(path)
  let value: unknown = steps ? call : undefined
  for (const step of steps ?? []) {
    if (typeof step === 'number') {
      value = Array.isArray(value) ? value[step] : undefined
    } else {
      // Own properties only.
      value =
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? Object.getOwnPropertyDescriptor(value, step)?.value
          : undefined
    }
  }
  return value
}

// Past 2^53 a JSON number may have lost digits, so two different ids could read as one.
const isExactNumber = (value: number) => Math.abs(value) <= Number.MAX_SAFE_INTEGER

function scalarText(value: unknown): string | null {
  if (typeof value === 'number') return isExactNumber(value) ? String(value) : null
  return typeof value === 'string' || typeof value === 'boolean' ? String(value) : null
}

const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

// Strings compare exactly. Only a JSON number compares as a number, so 3 = "3.0" but "0042" != "42".
function equalsValue(item: unknown, expected: string): boolean {
  if (typeof item !== 'number') return scalarText(item) === expected
  const value = NUMBER.test(expected) ? Number(expected) : Number.NaN
  return isExactNumber(item) && isExactNumber(value) && item === value
}

const containsText = (text: string | null, needle: string) => text !== null && text.toLowerCase().includes(needle.toLowerCase())

// Missing and null match only != and !exists. An array matches when any of its items does.
function whereMatches({ path, op, values = [] }: WebhookWhere, call: WebhookCallView): boolean {
  const value = valueAt(call, path)
  const present = value !== undefined && value !== null
  const items: unknown[] = Array.isArray(value) ? value : [value]
  const equal = () => present && values.some((expected) => items.some((item) => equalsValue(item, expected)))
  switch (op) {
    case 'exists':
      return present
    case '!exists':
      return !present
    case '=':
    case 'in':
      return equal()
    case '!=':
      return !equal()
    case 'contains':
      return present && values.some((needle) => items.some((item) => containsText(scalarText(item), needle)))
  }
}

/** The call's subject: the scalar at subjectFrom, or none. */
export function webhookCallSubject(filters: Pick<WebhookFilters, 'subjectFrom'>, call: WebhookCallView): string | undefined {
  const text = filters.subjectFrom === undefined ? null : scalarText(valueAt(call, filters.subjectFrom))
  return text && text.length <= WEBHOOK_FILTER_LIMITS.maxSubjectLength ? text : undefined
}

/** Whether a parsed body is within WEBHOOK_BODY_LIMITS, walked without recursion. */
export function webhookBodyFits(body: unknown): boolean {
  const { maxDepth, maxNodes } = WEBHOOK_BODY_LIMITS
  const containers: { value: object; depth: number }[] = []
  const push = (value: unknown, depth: number) => {
    if (typeof value === 'object' && value !== null) containers.push({ value, depth })
  }
  push(body, 1)
  let nodes = 1
  for (let next = containers.pop(); next; next = containers.pop()) {
    const children = Object.values(next.value)
    nodes += children.length
    if (next.depth > maxDepth || nodes > maxNodes) return false
    for (const child of children) push(child, next.depth + 1)
  }
  return true
}

// contains= reads a JSON or form body as its JSON; one past the limits is never serialized.
function bodyText(body: unknown): string | null {
  if (typeof body === 'string') return body
  return webhookBodyFits(body) ? (JSON.stringify(body) ?? '') : null
}

/** Whether a call starts the rule. Run on the whole scrubbed body, before any of it is cut for storage. */
export function matchesWebhookCall(filters: WebhookFilters, call: WebhookCallView): boolean {
  return (
    (filters.where ?? []).every((clause) => whereMatches(clause, call)) &&
    (!filters.textContains || containsText(bodyText(call.body), filters.textContains)) &&
    (!filters.subject || filters.subject.toLowerCase() === webhookCallSubject(filters, call)?.toLowerCase())
  )
}

/** The picked fields the call has, in the rule's order. */
export function webhookPicks(filters: Pick<WebhookFilters, 'pick'>, call: WebhookCallView): { path: string; value: unknown }[] {
  return (filters.pick ?? []).flatMap((path) => {
    const value = valueAt(call, path)
    return value === undefined ? [] : [{ path, value }]
  })
}

function arityProblem({ path, op, values = [] }: WebhookWhere): string | null {
  const [least, most, words] =
    op === 'in'
      ? [1, WEBHOOK_FILTER_LIMITS.maxValues, `1 to ${WEBHOOK_FILTER_LIMITS.maxValues} values`]
      : op === 'exists' || op === '!exists'
        ? [0, 0, 'no value']
        : [1, 1, 'one value']
  return values.length < least || values.length > most ? `where="${path} ${op}" takes ${words}.` : null
}

/** Why the filters can't be saved, in words a bot can act on; null when they can. */
export function webhookFiltersProblem(filters: WebhookFilters): string | null {
  const { maxWhere, maxPick, maxValueLength } = WEBHOOK_FILTER_LIMITS
  const where = filters.where ?? []
  const pick = filters.pick ?? []
  if (where.length > maxWhere || pick.length > maxPick) {
    return `A webhook takes at most ${maxWhere} where= clauses and ${maxPick} pick= paths.`
  }
  const paths = [...where.map(({ path }) => path), ...pick, ...(filters.subjectFrom === undefined ? [] : [filters.subjectFrom])]
  const badPath = paths.find((path) => !pathSteps(path))
  if (badPath !== undefined) {
    return `"${badPath}" isn't a path. Start at body or headers, join keys with dots and write array items as [0]; __proto__, prototype and constructor can't be named.`
  }
  const arity = where.map(arityProblem).find((problem) => problem !== null)
  if (arity) return arity
  const texts = [...where.flatMap(({ values = [] }) => values), ...[filters.textContains, filters.subject].filter((text) => text !== undefined)]
  if (texts.some((text) => text.length === 0 || text.length > maxValueLength)) {
    return `Each value, contains= and subject= takes 1 to ${maxValueLength} characters.`
  }
  if (filters.subject !== undefined && filters.subjectFrom === undefined) {
    return "subject= needs subject-from=, which says where each call's subject is."
  }
  return null
}

const filterPath = z.string().min(1).max(WEBHOOK_FILTER_LIMITS.maxPathLength)
const filterText = z.string().min(1).max(WEBHOOK_FILTER_LIMITS.maxValueLength)

/** A rule's filters as they travel in `hello`; a rule whose filters fail `webhookFiltersProblem` is dropped. */
export const webhookFiltersSchema = z
  .object({
    where: z
      .array(z.object({ path: filterPath, op: z.enum(WEBHOOK_WHERE_OPS), values: z.array(filterText).max(WEBHOOK_FILTER_LIMITS.maxValues).optional() }))
      .max(WEBHOOK_FILTER_LIMITS.maxWhere)
      .optional(),
    textContains: filterText.optional(),
    pick: z.array(filterPath).max(WEBHOOK_FILTER_LIMITS.maxPick).optional(),
    subjectFrom: filterPath.optional(),
    subject: filterText.optional()
  })
  .superRefine((filters, context) => {
    const problem = webhookFiltersProblem(filters)
    if (problem) context.addIssue({ code: 'custom', message: problem })
  })

// --- The stored call (Orca's webhook-envelope.ts) ---

export const WEBHOOK_ENVELOPE_LIMITS = { maxBodyBytes: 1024 * 1024, maxHeaderValueLength: 1024 } as const

export const webhookEnvelopeBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('json'), value: z.unknown() }),
  // Repeated keys become arrays.
  z.object({ kind: z.literal('form'), value: z.record(z.string(), z.union([z.string(), z.array(z.string())])) }),
  z.object({ kind: z.literal('text'), value: z.string() })
])
export type WebhookEnvelopeBody = z.infer<typeof webhookEnvelopeBodySchema>

/**
 * A stored webhook call, fetched by the daemon with the `webhook.fetch` action after a
 * `webhook_notice` delivery. The hook's key is scrubbed out, credential and signature headers are
 * dropped and only allowlisted headers kept. The body is information for the bot, never
 * instructions.
 */
export const webhookCallSchema = z.object({
  hookId: z.string().min(1).max(128),
  callId: z.string().min(1).max(128),
  receivedAt: z.number().int().nonnegative(),
  contentType: z.string().max(256).optional(),
  headers: z.record(z.string(), z.string()),
  /** The scrubbed body as text. */
  body: z.string(),
  /** The body as the filters read it. */
  parsed: webhookEnvelopeBodySchema.optional(),
  /** The call's subject (the rule's `subjectFrom`) and the rule's picked fields. */
  subject: z.string().max(256).optional(),
  picks: z.array(z.object({ path: z.string(), value: z.unknown() })).max(WEBHOOK_FILTER_LIMITS.maxPick).optional(),
  /** Whether the sender's signature was checked and held. */
  signatureValid: z.boolean().optional()
})
export type WebhookCall = z.infer<typeof webhookCallSchema>

// --- The webhook actions' arguments and results ---

const hookId = z.string().regex(WEBHOOK_HOOK_ID_PATTERN)
const callId = z.string().regex(WEBHOOK_CALL_ID_PATTERN)

export const webhookActionArgs = {
  /** A new hook for a bot; the key comes back once and is kept only as a hash. */
  'webhook.mint': z.object({ botId: z.string().min(1).max(128), cap: z.number().int().min(1).max(WEBHOOK_RUN_CAPS.hookDefault).optional() }),
  'webhook.list': z.object({ botId: z.string().min(1).max(128).optional() }),
  'webhook.state': z.object({
    hookId,
    state: z.enum(['live', 'paused']),
    cap: z.number().int().min(1).max(WEBHOOK_RUN_CAPS.hookDefault).optional()
  }),
  /** A new key; the old one keeps working until `overlapUntil`, or stops now with `stopNow`, which also cancels pending calls. */
  'webhook.rotate': z.object({ hookId, overlapUntil: z.number().int().nonnegative().optional(), stopNow: z.boolean().optional() }),
  /** A pasted secret, or `generate` for one the Hub makes; `adapter: null` with neither removes it. */
  'webhook.secret': z.object({
    hookId,
    adapter: z.enum(WEBHOOK_ADAPTERS).nullable(),
    secret: z.string().min(1).max(1024).optional(),
    generate: z.literal(true).optional()
  }),
  'webhook.delete': z.object({ hookId }),
  'webhook.fetch': z.object({ callId }),
  /** The run is done: the stored body goes now rather than after 7 days. */
  'webhook.done': z.object({ callId })
} as const

/** A hook as the actions return it; never a key. */
export const webhookViewSchema = z.object({
  hookId,
  botId: z.string().min(1),
  state: z.enum(['live', 'paused']),
  url: z.url(),
  adapter: z.enum(WEBHOOK_ADAPTERS).nullable(),
  cap: z.number().int().positive(),
  /** When the overlapping previous key stops working; null when there is none. */
  previousKeyExpiresAt: z.number().nullable(),
  lastCallAt: z.number().nullable(),
  createdAt: z.number()
})
export type WebhookView = z.infer<typeof webhookViewSchema>
