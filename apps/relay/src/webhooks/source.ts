// The webhook source inside the Hub (docs/specs/bots/sources/webhooks.md): a URL per hook that any
// system can call to start a bot run. The key is checked against its hash, an optional sender
// signature natively, the body scrubbed of the key and parsed, the hook's rule filters it, the run
// caps hold, and the call is stored for at most 7 days and announced to the bot's host as a
// `webhook_notice`; the daemon fetches it with `webhook.fetch`. The body is information, never
// instructions.

import {
  limits,
  matchesWebhookCall,
  redactWebhookKeys,
  REDACTED_WEBHOOK_KEY,
  WEBHOOK_KEY_PATTERN,
  WEBHOOK_KEY_PREFIX,
  WEBHOOK_REFUSAL_BURST,
  WEBHOOK_RUN_CAPS,
  webhookActionArgs,
  webhookBodyFits,
  webhookCallSubject,
  webhookPath,
  webhookPicks,
  type Action,
  type BotEvent,
  type Delivery,
  type Rule,
  type WebhookAdapterId,
  type WebhookCall,
  type WebhookEnvelopeBody,
  type WebhookNoticeCondition,
  type WebhookView
} from '../contract'
import { randomToken, sha256Hex } from '../crypto'
import { fail, ok, type ActionContext, type ActionOutcome, type HubSource, type SourceHub } from '../sources/common'
import { generateSecret, SIGNATURE_HEADERS, verifySender } from './signatures'

export const WEBHOOK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS webhooks (
     hook_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, key_hash TEXT NOT NULL, prev_key_hash TEXT, prev_expires_at INTEGER,
     adapter TEXT, secret TEXT, state TEXT NOT NULL, cap INTEGER NOT NULL, created_at INTEGER NOT NULL, last_call_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS webhook_calls (
     call_id TEXT PRIMARY KEY, hook_id TEXT NOT NULL, received_at INTEGER NOT NULL, state TEXT NOT NULL, envelope TEXT)`,
  `CREATE INDEX IF NOT EXISTS webhook_calls_by_hook ON webhook_calls (hook_id, received_at)`,
  `CREATE TABLE IF NOT EXISTS webhook_refusals (n INTEGER PRIMARY KEY AUTOINCREMENT, hook_id TEXT NOT NULL, at INTEGER NOT NULL)`
]

const HOUR_MS = 60 * 60 * 1000
/** How long a rotated key keeps working when the owner names no time. */
const DEFAULT_OVERLAP_MS = 24 * HOUR_MS

/** Headers kept in the stored call; every other header is dropped. */
const KEPT_HEADERS = new Set([
  'content-type',
  'user-agent',
  'x-github-event',
  'x-github-delivery',
  'x-github-hook-id',
  'sentry-hook-resource',
  'sentry-hook-timestamp',
  'linear-event',
  'linear-delivery',
  'x-pagerduty-webhook-id',
  'webhook-id',
  'webhook-timestamp',
  'x-request-id',
  'x-event-type',
  'x-event-key',
  'x-gitlab-event'
])

/** Headers a sender names its delivery by: the same id twice is one call. */
const DELIVERY_HEADERS = ['webhook-id', 'x-github-delivery', 'linear-delivery', 'x-pagerduty-webhook-id', 'idempotency-key', 'x-idempotency-key']

type HookRow = {
  hook_id: string
  bot_id: string
  key_hash: string
  prev_key_hash: string | null
  prev_expires_at: number | null
  adapter: WebhookAdapterId | null
  secret: string | null
  state: 'live' | 'paused'
  cap: number
  created_at: number
  last_call_at: number | null
}

export interface IncomingCall {
  hookId: string
  pathKey?: string
  /** Lower-cased names; values as sent. */
  headers: Record<string, string>
  body: string
}

export interface CallAnswer {
  status: number
  body: Record<string, string>
}

const now = () => Date.now()
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function alnum(length: number, seed?: Uint8Array): string {
  const bytes = seed ?? crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (let i = 0; i < length; i++) out += ALNUM[bytes[i % bytes.length]! % ALNUM.length]
  return out
}

async function seeded(text: string, length: number): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return alnum(length, digest)
}

export class WebhookSource implements HubSource {
  readonly name = 'webhook' as const
  readonly verbs = ['webhook.mint', 'webhook.list', 'webhook.state', 'webhook.rotate', 'webhook.secret', 'webhook.delete', 'webhook.fetch', 'webhook.done'] as const

  constructor(private readonly hub: SourceHub) {
    for (const statement of WEBHOOK_SCHEMA) hub.sql.exec(statement)
  }

  private get sql() {
    return this.hub.sql
  }

  private hook(hookId: string): HookRow | undefined {
    return this.sql.exec<HookRow>('SELECT * FROM webhooks WHERE hook_id = ?', hookId).toArray()[0]
  }

  private ruleOf(hook: HookRow): Rule | undefined {
    return this.hub.rules().find((r) => r.source === 'webhook' && r.webhook?.hookId === hook.hook_id && r.botId === hook.bot_id)
  }

  // --- Calls ---

  async onCall(call: IncomingCall): Promise<CallAnswer> {
    const hook = this.hook(call.hookId)
    if (!hook) return { status: 404, body: { error: 'not_found' } }
    const t = now()

    // The key, as a Bearer token or in the path; stored only as a hash.
    const auth = call.headers['authorization'] ?? ''
    const key = call.pathKey ?? (/^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? '')
    const hash = WEBHOOK_KEY_PATTERN.test(key) ? await sha256Hex(`webhook|${key}`) : ''
    const keyOk = hash !== '' && (hash === hook.key_hash || (hash === hook.prev_key_hash && (hook.prev_expires_at ?? 0) > t))
    if (!keyOk) return this.refuse(hook, 'bad_key')
    let signatureValid: boolean | undefined
    if (hook.adapter && hook.secret) {
      signatureValid = await verifySender(hook.adapter, hook.secret, call.headers, call.body)
      if (!signatureValid) return this.refuse(hook, 'bad_signature')
    }

    // The same sender delivery twice is one call.
    const senderId = DELIVERY_HEADERS.map((h) => call.headers[h]).find((v) => v)
    const callId = `call_${senderId ? await seeded(`${hook.hook_id}|${senderId}`, 20) : alnum(20)}`
    if (this.sql.exec('SELECT 1 FROM webhook_calls WHERE call_id = ?', callId).toArray().length) return { status: 200, body: { callId, status: 'duplicate' } }
    this.sql.exec('UPDATE webhooks SET last_call_at = ? WHERE hook_id = ?', t, hook.hook_id)
    if (hook.state === 'paused') return { status: 200, body: { callId, status: 'paused' } }

    // The body, with the key scrubbed out before anything reads it.
    const text = redactWebhookKeys(call.body.split(key).join(REDACTED_WEBHOOK_KEY))
    const contentType = (call.headers['content-type'] ?? '').slice(0, 256)
    const parsed = parseBody(text, contentType)
    if (!parsed) return { status: 413, body: { error: 'too_large', message: 'the body is nested too deep or has too many parts' } }
    const headers = keptHeaders(call.headers)
    const view = { headers, body: parsed.value }

    const rule = this.ruleOf(hook)
    const filters = rule?.webhook ?? {}
    if (!rule || !matchesWebhookCall(filters, view)) {
      this.sql.exec("INSERT INTO webhook_calls (call_id, hook_id, received_at, state) VALUES (?, ?, ?, 'ignored')", callId, hook.hook_id, t)
      void this.hub.scheduleDue('purge', t + limits.retentionMs)
      return { status: 200, body: { callId, status: 'ignored' } }
    }

    // The run caps: the hook's own (the owner may lower it), and the deployment's.
    const since = t - HOUR_MS
    const hookRuns = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM webhook_calls WHERE hook_id = ? AND state != 'ignored' AND received_at > ?", hook.hook_id, since).one().n
    const allRuns = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM webhook_calls WHERE state != 'ignored' AND received_at > ?", since).one().n
    if (hookRuns >= Math.min(hook.cap, WEBHOOK_RUN_CAPS.hookDefault) || allRuns >= WEBHOOK_RUN_CAPS.deployment) {
      await this.alert(hook, 'cap_reached', hookRuns)
      return { status: 429, body: { error: 'rate_limited', message: 'this hook reached its runs for the hour' } }
    }

    const subject = webhookCallSubject(filters, view)
    const picks = webhookPicks(filters, view)
    const envelope: WebhookCall = {
      hookId: hook.hook_id,
      callId,
      receivedAt: t,
      ...(contentType ? { contentType: contentType.slice(0, 256) } : {}),
      headers,
      body: text,
      parsed,
      ...(subject ? { subject } : {}),
      ...(picks.length ? { picks } : {}),
      ...(signatureValid !== undefined ? { signatureValid } : {})
    }
    this.sql.exec("INSERT INTO webhook_calls (call_id, hook_id, received_at, state, envelope) VALUES (?, ?, ?, 'queued', ?)", callId, hook.hook_id, t, JSON.stringify(envelope))
    await this.hub.scheduleDue('purge', t + limits.retentionMs)
    await this.hub.enqueue({
      id: `wh-${callId}`,
      kind: 'webhook_notice',
      botId: hook.bot_id,
      conversation: { source: 'webhook', externalId: hook.hook_id },
      askedAt: t,
      hookId: hook.hook_id,
      callId,
      ruleId: rule.id,
      ...(subject ? { subject } : {})
    })
    return { status: 200, body: { callId, status: 'queued' } }
  }

  /** A refused call: counted, and a burst of them tells the owner once an hour. */
  private async refuse(hook: HookRow, why: 'bad_key' | 'bad_signature'): Promise<CallAnswer> {
    const t = now()
    this.sql.exec('INSERT INTO webhook_refusals (hook_id, at) VALUES (?, ?)', hook.hook_id, t)
    this.sql.exec('DELETE FROM webhook_refusals WHERE at < ?', t - WEBHOOK_REFUSAL_BURST.windowMs)
    const recent = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM webhook_refusals WHERE hook_id = ?', hook.hook_id).one().n
    if (recent >= WEBHOOK_REFUSAL_BURST.count) await this.alert(hook, 'refusal_burst', recent)
    return { status: 401, body: { error: why } }
  }

  private async alert(hook: HookRow, condition: WebhookNoticeCondition, count: number) {
    const t = now()
    await this.hub.enqueue({
      id: `wh-alert-${hook.hook_id}-${condition}-${Math.floor(t / HOUR_MS)}`,
      kind: 'webhook_alert',
      botId: hook.bot_id,
      conversation: { source: 'webhook', externalId: hook.hook_id },
      askedAt: t,
      hookId: hook.hook_id,
      condition,
      count
    })
  }

  // --- The source interface: webhooks post nothing back ---

  onEvent(_event: BotEvent): void {}

  onSettled(_delivery: Delivery): void {}

  /** Bodies go after 7 days, whatever their state. */
  purge(before: number) {
    this.sql.exec('DELETE FROM webhook_calls WHERE received_at < ?', before)
    this.sql.exec('DELETE FROM webhook_refusals WHERE at < ?', now() - WEBHOOK_REFUSAL_BURST.windowMs)
  }

  // --- Actions: the daemon manages its bots' hooks ---

  private ownHook(hookId: string, ctx: ActionContext): HookRow | null {
    const hook = this.hook(hookId)
    if (!hook) return null
    const host = this.sql.exec<{ host_id: string }>('SELECT host_id FROM bots WHERE id = ?', hook.bot_id).toArray()[0]?.host_id
    return host === ctx.hostId ? hook : null
  }

  private url(hookId: string) {
    return `${this.hub.origin() ?? ''}${webhookPath(hookId)}`
  }

  private view(hook: HookRow): WebhookView {
    return {
      hookId: hook.hook_id,
      botId: hook.bot_id,
      state: hook.state,
      url: this.url(hook.hook_id),
      adapter: hook.adapter,
      cap: hook.cap,
      previousKeyExpiresAt: hook.prev_key_hash && (hook.prev_expires_at ?? 0) > now() ? hook.prev_expires_at : null,
      lastCallAt: hook.last_call_at,
      createdAt: hook.created_at
    }
  }

  private newKey() {
    return `${WEBHOOK_KEY_PREFIX}${randomToken(32)}`
  }

  async action(action: Action, ctx: ActionContext): Promise<ActionOutcome> {
    const schema = webhookActionArgs[action.verb as keyof typeof webhookActionArgs]
    if (!schema) return fail('unsupported', `${action.verb} is not a webhook verb`)
    const parsed = schema.safeParse(action.args)
    if (!parsed.success) return fail('invalid_args', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const args = parsed.data as Record<string, any>
    const t = now()

    if (action.verb === 'webhook.mint') {
      const host = this.sql.exec<{ host_id: string }>('SELECT host_id FROM bots WHERE id = ?', args.botId).toArray()[0]?.host_id
      if (host !== ctx.hostId) return fail('unknown_bot', 'that bot is not on this computer')
      if (!this.hub.origin()) return fail('not_ready', 'the relay does not know its own URL yet')
      const hookId = `wh_${alnum(16)}`
      const key = this.newKey()
      this.sql.exec(
        "INSERT INTO webhooks (hook_id, bot_id, key_hash, state, cap, created_at) VALUES (?, ?, ?, 'live', ?, ?)",
        hookId,
        args.botId,
        await sha256Hex(`webhook|${key}`),
        args.cap ?? WEBHOOK_RUN_CAPS.hookDefault,
        t
      )
      // The key is shown once; the Hub keeps only its hash.
      return ok({ ...this.view(this.hook(hookId)!), key, urlWithKey: `${this.url(hookId)}/${key}` })
    }
    if (action.verb === 'webhook.list') {
      const rows = this.sql
        .exec<HookRow>('SELECT w.* FROM webhooks w JOIN bots b ON b.id = w.bot_id WHERE b.host_id = ? ORDER BY w.created_at', ctx.hostId)
        .toArray()
        .filter((h) => !args.botId || h.bot_id === args.botId)
      return ok({ hooks: rows.map((h) => this.view(h)) })
    }

    if (action.verb === 'webhook.fetch' || action.verb === 'webhook.done') {
      const row = this.sql.exec<{ hook_id: string; envelope: string | null }>('SELECT hook_id, envelope FROM webhook_calls WHERE call_id = ?', args.callId).toArray()[0]
      if (!row || !this.ownHook(row.hook_id, ctx)) return fail('not_found', 'no such call, or it was deleted after 7 days')
      if (action.verb === 'webhook.done') {
        this.sql.exec("UPDATE webhook_calls SET envelope = NULL, state = 'done' WHERE call_id = ?", args.callId)
        return ok({})
      }
      if (!row.envelope) return fail('gone', 'the call’s body is deleted')
      return ok(JSON.parse(row.envelope))
    }

    const hook = this.ownHook(args.hookId, ctx)
    if (!hook) return fail('not_found', 'no such hook on this computer')
    switch (action.verb) {
      case 'webhook.state':
        this.sql.exec('UPDATE webhooks SET state = ?, cap = ? WHERE hook_id = ?', args.state, args.cap ?? hook.cap, hook.hook_id)
        return ok(this.view(this.hook(hook.hook_id)!))
      case 'webhook.rotate': {
        const key = this.newKey()
        const until = args.stopNow ? 0 : (args.overlapUntil ?? t + DEFAULT_OVERLAP_MS)
        this.sql.exec('UPDATE webhooks SET key_hash = ?, prev_key_hash = ?, prev_expires_at = ? WHERE hook_id = ?', await sha256Hex(`webhook|${key}`), hook.key_hash, until, hook.hook_id)
        let cancelled = 0
        if (args.stopNow) cancelled = this.cancelPending(hook.hook_id)
        return ok({ ...this.view(this.hook(hook.hook_id)!), key, urlWithKey: `${this.url(hook.hook_id)}/${key}`, cancelledCalls: cancelled })
      }
      case 'webhook.secret': {
        if (args.adapter === null) {
          this.sql.exec('UPDATE webhooks SET adapter = NULL, secret = NULL WHERE hook_id = ?', hook.hook_id)
          return ok({})
        }
        const secret = args.generate ? generateSecret(args.adapter) : args.secret
        if (!secret) return fail('invalid_args', 'a secret, or generate: true, is needed')
        this.sql.exec('UPDATE webhooks SET adapter = ?, secret = ? WHERE hook_id = ?', args.adapter, secret, hook.hook_id)
        // Only a secret the Hub made comes back, for the owner to paste into the sender.
        return ok(args.generate ? { secret } : {})
      }
      case 'webhook.delete':
        this.cancelPending(hook.hook_id)
        this.sql.exec('DELETE FROM webhook_calls WHERE hook_id = ?', hook.hook_id)
        this.sql.exec('DELETE FROM webhook_refusals WHERE hook_id = ?', hook.hook_id)
        this.sql.exec('DELETE FROM webhooks WHERE hook_id = ?', hook.hook_id)
        return ok({})
      default:
        return fail('unsupported', action.verb)
    }
  }

  /** Calls not yet run are cancelled: their notices settle and their bodies go. */
  private cancelPending(hookId: string): number {
    const calls = this.sql.exec<{ call_id: string }>("SELECT call_id FROM webhook_calls WHERE hook_id = ? AND state = 'queued'", hookId).toArray()
    for (const { call_id } of calls) {
      this.hub.settle(`wh-${call_id}`, 'cancelled')
      this.sql.exec("UPDATE webhook_calls SET state = 'cancelled', envelope = NULL WHERE call_id = ?", call_id)
    }
    return calls.length
  }
}

/** The body as filters read it: JSON, a form (repeated keys → arrays) or text; null past the depth and node caps. */
export function parseBody(text: string, contentType: string): WebhookEnvelopeBody | null {
  const type = contentType.toLowerCase()
  if (type.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      const value = JSON.parse(text)
      return webhookBodyFits(value) ? { kind: 'json', value } : null
    } catch {
      // not JSON after all: text
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    const value: Record<string, string | string[]> = {}
    for (const [k, v] of new URLSearchParams(text)) {
      const had = value[k]
      value[k] = had === undefined ? v : Array.isArray(had) ? [...had, v] : [had, v]
    }
    return webhookBodyFits(value) ? { kind: 'form', value } : null
  }
  return { kind: 'text', value: text }
}

/** Only allowlisted headers, never credentials or signatures, each ≤ 1024 characters. */
export function keptHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!KEPT_HEADERS.has(name) || SIGNATURE_HEADERS.includes(name)) continue
    out[name] = redactWebhookKeys(value).slice(0, 1024)
  }
  return out
}

