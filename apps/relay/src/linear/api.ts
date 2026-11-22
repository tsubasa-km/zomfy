// Linear's GraphQL API as the Hub uses it (docs/specs/bots/sources/linear.md). Either the person's
// own OAuth app, whose app-actor token the Hub gets itself with the client-credentials grant (30
// days, no refresh token; kept in memory only and fetched again on expiry or 401), or a token they
// pasted (`LINEAR_ACCESS_TOKEN`: a personal API key, or any OAuth access token). Tests put a fake
// Linear behind SOURCES_TRANSPORT.

import type { Env } from '../env'
import { hmacHex, sameDigest, sourceFetch } from '../sources/common'

export const LINEAR_API = 'https://api.linear.app'
/** Scopes the app token asks for: read issues, write comments and labels, be assigned and mentioned. */
export const LINEAR_SCOPES = 'read,write,app:assignable,app:mentionable'
/** Linear refuses a webhook whose timestamp is more than a minute off. */
const LINEAR_SKEW_MS = 60 * 1000

/** `Linear-Signature`: hex HMAC-SHA256 of the raw body; `webhookTimestamp` (ms) within 60 s. */
export async function verifyLinearRequest(secret: string, signature: string, body: string, now = Date.now()): Promise<boolean> {
  if (!secret || !/^[0-9a-f]{64}$/.test(signature)) return false
  if (!sameDigest(await hmacHex(secret, body), signature)) return false
  try {
    const at = Number((JSON.parse(body) as { webhookTimestamp?: unknown }).webhookTimestamp)
    return Number.isFinite(at) && Math.abs(now - at) <= LINEAR_SKEW_MS
  } catch {
    return false
  }
}

let appToken: { token: string; expiresAt: number } | null = null
/** Client-credentials token fetches so far, for tests. */
export const linearTokenFetches = { count: 0 }

async function authorization(env: Env, fresh = false): Promise<string | null> {
  const pasted = env.LINEAR_ACCESS_TOKEN
  if (pasted) return pasted.startsWith('lin_api_') ? pasted : `Bearer ${pasted}`
  if (!env.LINEAR_CLIENT_ID || !env.LINEAR_CLIENT_SECRET) return null
  if (!fresh && appToken && appToken.expiresAt - 24 * 60 * 60 * 1000 > Date.now()) return `Bearer ${appToken.token}`
  linearTokenFetches.count++
  const form = new URLSearchParams({ grant_type: 'client_credentials', scope: LINEAR_SCOPES, client_id: env.LINEAR_CLIENT_ID, client_secret: env.LINEAR_CLIENT_SECRET })
  try {
    const res = await sourceFetch(env)(new Request(`${LINEAR_API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }))
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
    if (!res.ok || !body?.access_token) return null
    appToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 30 * 86400) * 1000 }
    return `Bearer ${appToken.token}`
  } catch {
    return null
  }
}

export interface LinearResult<T = any> {
  ok: boolean
  status: number
  data: T | null
  retryAfterMs: number | null
  message: string | null
}

export async function linearCall<T = any>(env: Env, query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal, retried = false): Promise<LinearResult<T>> {
  const auth = await authorization(env, retried)
  if (!auth) return { ok: false, status: 401, data: null, retryAfterMs: null, message: 'no Linear credentials' }
  let response: Response
  try {
    response = await sourceFetch(env)(
      new Request(`${LINEAR_API}/graphql`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), signal })
    )
  } catch {
    return { ok: false, status: 0, data: null, retryAfterMs: null, message: 'network' }
  }
  const body = (await response.json().catch(() => null)) as { data?: T; errors?: { message?: string; extensions?: { code?: string } }[] } | null
  if (response.status === 401 && !retried && !env.LINEAR_ACCESS_TOKEN) return linearCall(env, query, variables, signal, true)
  const limited = response.status === 429 || body?.errors?.some((e) => e.extensions?.code === 'RATELIMITED')
  let retryAfterMs: number | null = null
  if (limited) {
    const reset = Number(response.headers.get('X-RateLimit-Requests-Reset'))
    retryAfterMs = Number.isFinite(reset) && reset > Date.now() ? reset - Date.now() : 60_000
  }
  const ok = response.ok && !body?.errors?.length && body?.data !== undefined
  return { ok, status: response.status, data: ok ? (body!.data as T) : null, retryAfterMs, message: ok ? null : (body?.errors?.[0]?.message ?? `http ${response.status}`) }
}

/** Linear issue identifiers (`ENG-123`). */
export const ISSUE_ID = /^[A-Za-z0-9]{1,16}-\d{1,9}$/
/** Linear's comment limit. */
export const COMMENT_LIMIT = 64 * 1024
