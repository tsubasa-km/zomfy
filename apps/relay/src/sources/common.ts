// What every source in the Hub shares: the interface the Hub drives them through, which bot a
// message names, Who can ask, the "asked by" line, and the phrases for reply outcomes and failures,
// written once and styled per source.

import { askerRole, limits, type Action, type AskerRole, type BotEvent, type Delivery, type Failure, type HelloBot, type ReplyOutcome, type Rule, type Source as SourceName } from '../contract'
import type { Env } from '../env'
import type { DeliveryInput } from '../hub'
import type { Outbound } from '../outbound'

/** What the Hub gives a source. */
export interface SourceHub {
  readonly sql: SqlStorage
  readonly env: Env
  readonly outbound: Outbound
  transaction(fn: () => void): void
  /** Queues a delivery (deduped by id) and sends it if the bot's host is online. */
  enqueue(delivery: DeliveryInput): Promise<{ id: string; created: boolean }>
  bots(): HelloBot[]
  rules(): Rule[]
  /** Once per key for 7 days; false when seen before. */
  markSeen(key: string): boolean
  scheduleDue(key: string, at: number): Promise<void>
  /** The Worker's own origin (`https://…workers.dev`), as the last request named it. */
  origin(): string | null
  /** Settles a delivery that is not done yet (a webhook call cancelled before it ran). */
  settle(deliveryId: string, outcome: string): void
}

/** Who an action comes from: the host whose link sent it. */
export interface ActionContext {
  hostId: string
}

export type ActionOutcome = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }

/** A source as the Hub drives it. */
export interface HubSource {
  readonly name: SourceName
  /** The daemon's events, inside the Hub's events transaction: SQL only, posts go to the queue. */
  onEvent(event: BotEvent): void
  /** A `start` or `send` that expired or was refused: tell the asker where they asked. */
  onSettled(delivery: Delivery, outcome: 'expired' | 'refused' | 'unsupported', failure?: Failure): void
  purge(before: number): void
  /** Verbs it acts on, for `capabilities`. */
  readonly verbs: readonly string[]
  action?(action: Action, ctx: ActionContext): Promise<ActionOutcome>
  /** A timer it keeps in the Hub's `due` table as `<what>:<id>`; true when it was its own. */
  onTimer?(what: string, id: string, now: number): Promise<boolean> | boolean
}

export const fail = (code: string, message: string): ActionOutcome => ({ ok: false, error: { code, message: message.slice(0, 1000) } })
export const ok = (result: unknown): ActionOutcome => ({ ok: true, result })

/**
 * The bot a message names by handle (its first word, after the mention), else the deployment's
 * default bot, else the only bot.
 */
export function pickBot(bots: HelloBot[], text: string): { bot: HelloBot | null; text: string; named: boolean } {
  const match = /^\s*@?([a-z0-9][a-z0-9_-]*)\b[,:]?\s*/i.exec(text)
  const named = match ? bots.find((b) => b.handle === match[1]!.toLowerCase()) : undefined
  if (named && match) return { bot: named, text: text.slice(match[0].length), named: true }
  const fallback = bots.find((b) => b.isDefault) ?? (bots.length === 1 ? bots[0] : undefined)
  return { bot: fallback ?? null, text, named: false }
}

/** Who can ask, with ids compared in any case where the source's are (GitHub logins). */
export function roleOf(bot: HelloBot, source: SourceName, id: string, anyCase = false): AskerRole {
  const exact = askerRole(bot, source, id)
  if (exact !== 'other' || !anyCase) return exact
  const lower = id.toLowerCase()
  if (bot.owner[source]?.toLowerCase() === lower) return 'owner'
  return bot.askers[source]?.find((m) => m.id.toLowerCase() === lower)?.role ?? 'other'
}

/** The longest "asked by" line, as Orca's. */
export const ASKED_BY_MAX_CHARS = 140

/** "asked by Carol via Scout" for the names of askers who were not the owner; null for none. Orca's `askedByLine`. */
export function askedByLine(names: string[], botName: string): string | null {
  const unique = [...new Set(names.filter(Boolean))]
  if (!unique.length) return null
  const line = (shown: string[], others: number) =>
    `asked by ${shown.join(', ')}${others > 0 ? ` and ${others} other${others === 1 ? '' : 's'}` : ''} via ${botName}`
  for (let shown = unique.length; shown >= 1; shown--) {
    const candidate = line(unique.slice(0, shown), unique.length - shown)
    if (candidate.length <= ASKED_BY_MAX_CHARS) return candidate
  }
  const room = ASKED_BY_MAX_CHARS - line([''], unique.length - 1).length - 1
  return line([`${(unique[0] ?? '').slice(0, Math.max(0, room))}…`], unique.length - 1).slice(0, ASKED_BY_MAX_CHARS)
}

/** The body ending with who asked, never twice. */
export function withAskedBy(body: string, line: string | null): string {
  return line && !body.toLowerCase().includes(line.toLowerCase()) ? `${body.trimEnd()}\n\n${line}` : body
}

/** How a source writes a small note and a time. */
export interface Style {
  small(text: string): string
  time(ms: number): string
}

export const plainStyle: Style = {
  small: (text) => `_${text}_`,
  time: (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export function phraseFailure(failure: Failure | undefined, style: Style): string {
  switch (failure?.category) {
    case 'signed_out':
      return 'The agent on the computer is signed out; sign in again in Zomfy.'
    case 'usage_limit':
      return failure.resetsAt ? `The agent hit its usage limit; it resumes ${style.time(failure.resetsAt)}.` : 'The agent hit its usage limit.'
    case 'not_set_up':
      return 'This bot is not set up on the computer yet.'
    case 'folder_missing':
      return 'The bot’s home folder is missing on the computer.'
    case 'unconfirmed':
      return 'The computer could not confirm the request ran.'
    default:
      return failure?.category === 'agent_error' && failure.message ? `The agent failed: ${failure.message}` : 'The agent failed.'
  }
}

/** What a reply posts for its outcome; `null` posts nothing. */
export function replyText(outcome: ReplyOutcome, text: string, failure: Failure | undefined, style: Style): string | null {
  const t = text.trim()
  switch (outcome) {
    case 'answered':
      return t || 'Done.'
    case 'quiet':
      return t || null
    case 'failed':
      return t ? `${t}\n\n${style.small(phraseFailure(failure, style))}` : phraseFailure(failure, style)
    case 'cancelled':
      return t ? `${t}\n\n${style.small('Stopped.')}` : 'Stopped.'
    case 'interrupted':
      return t ? `${t}\n\n${style.small('Interrupted.')}` : 'Interrupted.'
    case 'no_answer':
      return t || 'No answer.'
    default:
      return t || null
  }
}

export function endedText(outcome: ReplyOutcome): string {
  switch (outcome) {
    case 'cancelled':
      return 'Stopped.'
    case 'interrupted':
      return 'Interrupted.'
    case 'failed':
      return 'Failed.'
    default:
      return 'Done.'
  }
}

export const NOTES = {
  expired: 'Your computer was offline; this expired.',
  refused: (bot: string) => `${bot} could not take this request.`,
  unsupported: (bot: string) => `${bot}’s computer cannot handle this yet; update Zomfy.`,
  noBots: 'No bots are set up on this relay yet. Create one in Zomfy and pair it with this relay.',
  unknownBot: (handles: string[], how: string) => `Which bot? Ask with \`${how} <handle> …\`${handles.length ? `; bots here: ${handles.map((h) => `\`${h}\``).join(', ')}` : ''}.`,
  accessRequested: 'Access requested; the owner will see it in Zomfy.',
  accessAnswered: (bot: string, allowed: boolean) =>
    allowed ? `The owner let you ask **${bot}**; ask again whenever you like.` : `The owner declined your request to ask **${bot}**.`,
  stopping: 'Stopping…',
  working: 'Working…'
}

export function settledText(outcome: 'expired' | 'refused' | 'unsupported', botName: string, failure: Failure | undefined, style: Style): string {
  if (outcome === 'expired') return NOTES.expired
  if (outcome === 'unsupported') return NOTES.unsupported(botName)
  return failure ? `${NOTES.refused(botName)} ${phraseFailure(failure, style)}` : NOTES.refused(botName)
}

/** A status line: the activity, else the running step. */
export function activityLine(text?: string, steps?: { text: string; status: string }[]): string {
  const running = steps?.find((s) => s.status === 'running')?.text
  const detail = text || running
  return detail ? `${NOTES.working} ${detail}` : NOTES.working
}

/** A plan as a Markdown checklist. */
export function checklist(steps: { text: string; status: string }[]): string {
  return steps.map((s) => `- [${s.status === 'done' ? 'x' : ' '}] ${s.text}${s.status === 'running' ? ' …' : s.status === 'failed' ? ' (failed)' : ''}`).join('\n')
}

/** Questions as text, for sources without buttons: numbered options, answered by reply. */
export function numberedQuestion(prompt: { text: string; header?: string; options: { label: string }[]; byReply: boolean }, botName: string): string {
  const head = prompt.header ? `**${prompt.header}**\n\n` : ''
  const options = prompt.options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
  const how = prompt.options.length
    ? 'Reply with the number or your own answer, or answer in Zomfy.'
    : 'Reply with your answer, or answer in Zomfy.'
  return `${head}${botName} asks: ${prompt.text}${options ? `\n\n${options}` : ''}\n\n${how}`
}

/** The option a reply names: its number, or its label in any case. */
export function optionFromReply(options: { id: string; label: string }[], text: string): { optionId?: string; text?: string } {
  const t = text.trim()
  const number = /^\s*(\d{1,2})[.)]?\s*$/.exec(t)
  if (number) {
    const option = options[Number(number[1]) - 1]
    if (option) return { optionId: option.id }
  }
  const byLabel = options.find((o) => o.label.trim().toLowerCase() === t.toLowerCase())
  if (byLabel) return { optionId: byLabel.id }
  return { text: t.slice(0, limits.maxAnswerTextChars) }
}

/** Waits for `work` at most `ms`, so a source's deadline is met while the work goes on. */
export async function within(work: Promise<unknown>, ms: number): Promise<void> {
  const settled = work.then(
    () => undefined,
    (error) => console.log(`background work failed: ${error instanceof Error ? error.message : String(error)}`)
  )
  await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, ms))])
}

export async function hmacHex(secret: string | Uint8Array, text: string | Uint8Array): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', typeof secret === 'string' ? enc.encode(secret) : secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof text === 'string' ? enc.encode(text) : text))
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hmacBase64(secret: Uint8Array, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
  let raw = ''
  for (const b of mac) raw += String.fromCharCode(b)
  return btoa(raw)
}

/** Constant-time comparison of two hex or base64 strings. */
export function sameDigest(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y)
}

export async function sha256Short(text: string, chars = 32): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, chars)
}

/** The fetch source API calls use: the test transport when bound, else the global one. */
export function sourceFetch(env: Env): (request: Request) => Promise<Response> {
  const transport = env.SOURCES_TRANSPORT
  return transport ? (request) => transport.fetch(request) : (request) => fetch(request)
}

/** Seconds of a `Retry-After` header (or a reset time) as a wait in ms. */
export function retryAfterMs(response: Response, fallback = 1000): number {
  const after = Number(response.headers.get('Retry-After'))
  if (Number.isFinite(after) && after > 0) return Math.ceil(after * 1000)
  return fallback
}

export const nowMs = () => Date.now()
