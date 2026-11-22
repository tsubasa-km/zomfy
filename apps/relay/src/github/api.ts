// The person's own GitHub App as the Hub uses it (docs/specs/bots/sources/github.md): an RS256 JWT
// (≤ 10 minutes) signed with the app's private key, installation tokens fetched with it and cached
// in memory for under an hour (never stored), and REST calls with GitHub's rate limits read into a
// wait. Tests put a fake GitHub behind SOURCES_TRANSPORT.

import type { Env } from '../env'
import { hmacHex, sameDigest, sourceFetch } from '../sources/common'

export const GITHUB_API = 'https://api.github.com'
const USER_AGENT = 'zomfy-relay (https://github.com/tsubasa-km/zomfy)'

/** `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 of the raw body with the webhook secret. */
export async function verifyGitHubRequest(secret: string, signature: string, body: string): Promise<boolean> {
  if (!secret || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false
  return sameDigest(`sha256=${await hmacHex(secret, body)}`, signature)
}

// --- The app's key and JWT ---

function derLength(length: number): number[] {
  if (length < 0x80) return [length]
  const bytes: number[] = []
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff)
  return [0x80 | bytes.length, ...bytes]
}

/** GitHub hands out PKCS#1 keys (`BEGIN RSA PRIVATE KEY`); WebCrypto takes PKCS#8, so it is wrapped. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00]
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const octets = [0x04, ...derLength(pkcs1.length)]
  const inner = version.length + algorithm.length + octets.length + pkcs1.length
  const out = new Uint8Array([0x30, ...derLength(inner), ...version, ...algorithm, ...octets, ...pkcs1])
  return out
}

let keyCache: { pem: string; key: CryptoKey } | null = null

async function appKey(pem: string): Promise<CryptoKey> {
  if (keyCache?.pem === pem) return keyCache.key
  // A key pasted on one line keeps its line breaks as `\n`.
  const text = pem.includes('\\n') ? pem.replaceAll('\\n', '\n') : pem
  const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(text)
  const body = text.replace(/-----(BEGIN|END)[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', pkcs1 ? pkcs1ToPkcs8(der) : der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  keyCache = { pem, key }
  return key
}

const base64url = (bytes: Uint8Array) => {
  let raw = ''
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** The app's JWT: issued a minute back for clock drift, valid 9 minutes (GitHub allows 10). */
export async function appJwt(env: Env, now = Date.now()): Promise<string> {
  const enc = new TextEncoder()
  const header = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const iat = Math.floor(now / 1000) - 60
  const payload = base64url(enc.encode(JSON.stringify({ iat, exp: iat + 9 * 60, iss: env.GITHUB_APP_ID })))
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await appKey(env.GITHUB_APP_PRIVATE_KEY ?? ''), enc.encode(`${header}.${payload}`)))
  return `${header}.${payload}.${base64url(signature)}`
}

// --- Installation tokens, in memory only ---

const tokens = new Map<string, { token: string; expiresAt: number }>()
/** A token is used until 10 minutes before GitHub's expiry (an hour), so it is never stale mid-call. */
const TOKEN_MARGIN_MS = 10 * 60 * 1000

/** Fetches of installation tokens so far, for tests. */
export const tokenFetches = { count: 0 }

export function forgetInstallationTokens() {
  tokens.clear()
}

async function installationToken(env: Env, installation: string): Promise<string | GitHubResult> {
  const cached = tokens.get(installation)
  if (cached && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) return cached.token
  tokenFetches.count++
  const res = await rawCall<{ token: string; expires_at: string }>(env, `Bearer ${await appJwt(env)}`, 'POST', `/app/installations/${encodeURIComponent(installation)}/access_tokens`)
  if (!res.ok || !res.body?.token) return res
  // Tokens are not assumed to have any particular length or form.
  tokens.set(installation, { token: res.body.token, expiresAt: Date.parse(res.body.expires_at) || Date.now() + 50 * 60 * 1000 })
  return res.body.token
}

// --- Calls ---

export interface GitHubResult<T = any> {
  ok: boolean
  status: number
  body: T | null
  /** On 429, a secondary rate limit, or a spent primary one: how long to wait. */
  retryAfterMs: number | null
  message: string | null
}

async function rawCall<T>(env: Env, auth: string, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<GitHubResult<T>> {
  const headers = new Headers({
    Authorization: auth,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT
  })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await sourceFetch(env)(new Request(`${GITHUB_API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal }))
  } catch {
    return { ok: false, status: 0, body: null, retryAfterMs: null, message: 'network' }
  }
  const text = await response.text()
  let parsed: any = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  let retryAfterMs: number | null = null
  const after = Number(response.headers.get('Retry-After'))
  if ((response.status === 429 || response.status === 403) && Number.isFinite(after) && after > 0) retryAfterMs = after * 1000
  else if ((response.status === 429 || response.status === 403) && response.headers.get('X-RateLimit-Remaining') === '0') {
    const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000
    retryAfterMs = Number.isFinite(reset) && reset > Date.now() ? reset - Date.now() : 60_000
  } else if (response.status === 429) retryAfterMs = 60_000
  return { ok: response.ok, status: response.status, body: response.ok ? (parsed as T) : null, retryAfterMs, message: response.ok ? null : String(parsed?.message ?? `http ${response.status}`) }
}

/** A REST call as the app's installation. */
export async function githubCall<T = any>(env: Env, installation: string, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<GitHubResult<T>> {
  const token = await installationToken(env, installation)
  if (typeof token !== 'string') return token as GitHubResult<T>
  const res = await rawCall<T>(env, `Bearer ${token}`, method, path, body, signal)
  if (res.status === 401) tokens.delete(installation)
  return res
}

/** Reactions GitHub knows. */
export const REACTIONS = new Set(['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'])

