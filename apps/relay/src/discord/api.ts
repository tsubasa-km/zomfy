// Discord's REST API as the Hub and the Gateway object use it (docs/specs/bots/sources/discord.md).
// Every call goes through `discordFetch`, so tests can put a fake Discord behind the
// DISCORD_TRANSPORT service binding; in a deployment the binding is absent and `fetch` is used.

import type { Env } from '../env'

export const DISCORD_API = 'https://discord.com/api/v10'
export const USER_AGENT = 'DiscordBot (https://github.com/tsubasa-km/zomfy, 1)'

/** The fetch the Discord calls use: the test transport when bound, else the global one. */
export function discordFetcher(env: Env): (request: Request) => Promise<Response> {
  const transport = env.DISCORD_TRANSPORT
  return transport ? (request) => transport.fetch(request) : (request) => fetch(request)
}

export interface DiscordResult<T = any> {
  ok: boolean
  status: number
  body: T | null
  /** Set on 429, or when the bucket is spent: how long to wait before the next call there. */
  retryAfterMs: number | null
  /** Discord's JSON error code (`50001` missing access, `160004` thread exists, …). */
  code: number | null
  /** A 429 that holds every route, not just this one. */
  global: boolean
}

/** Reads Discord's rate-limit headers and a 429's `retry_after` into one wait, in ms. */
export function rateLimitWait(response: Response, body: any): number | null {
  if (response.status === 429) {
    const seconds = Number(body?.retry_after ?? response.headers.get('Retry-After') ?? 1)
    return Math.ceil((Number.isFinite(seconds) ? seconds : 1) * 1000)
  }
  if (response.headers.get('X-RateLimit-Remaining') === '0') {
    const after = Number(response.headers.get('X-RateLimit-Reset-After') ?? '0')
    return Number.isFinite(after) && after > 0 ? Math.ceil(after * 1000) : null
  }
  return null
}

export interface CallOptions {
  body?: unknown
  /** A multipart body (attachments); sent as is. */
  form?: FormData
  /** Interaction webhooks are authorised by their token in the path, not the bot token. */
  noAuth?: boolean
  signal?: AbortSignal
}

export async function discordCall<T = any>(env: Env, method: string, path: string, options: CallOptions = {}): Promise<DiscordResult<T>> {
  const headers = new Headers({ 'User-Agent': USER_AGENT })
  if (!options.noAuth) headers.set('Authorization', `Bot ${env.DISCORD_BOT_TOKEN ?? ''}`)
  let body: BodyInit | undefined
  if (options.form) body = options.form
  else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }
  let response: Response
  try {
    response = await discordFetcher(env)(new Request(`${DISCORD_API}${path}`, { method, headers, body, signal: options.signal }))
  } catch {
    return { ok: false, status: 0, body: null, retryAfterMs: null, code: null, global: false }
  }
  const text = await response.text()
  let parsed: any = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  return {
    ok: response.ok,
    status: response.status,
    body: response.ok ? (parsed as T) : null,
    retryAfterMs: rateLimitWait(response, parsed),
    code: typeof parsed?.code === 'number' ? parsed.code : null,
    global: response.status === 429 && (parsed?.global === true || response.headers.get('X-RateLimit-Global') === 'true')
  }
}

/** Channel types that are threads. */
export const THREAD_TYPES = new Set([10, 11, 12])

/** Message flags. */
export const EPHEMERAL = 1 << 6
export const SUPPRESS_EMBEDS = 1 << 2

/** Interaction and response types. */
export const InteractionType = { Ping: 1, Command: 2, Component: 3, Autocomplete: 4, Modal: 5 } as const
export const ResponseType = { Pong: 1, Message: 4, DeferredMessage: 5, DeferredUpdate: 6, UpdateMessage: 7 } as const

/** Gateway intents the relay asks for: guilds, guild messages, DMs and message content. */
export const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15)

/** Permissions the app is added with (the setup's OAuth2 URL). */
export const BOT_PERMISSIONS =
  (1n << 10n) | // View Channels
  (1n << 11n) | // Send Messages
  (1n << 38n) | // Send Messages in Threads
  (1n << 35n) | // Create Public Threads
  (1n << 16n) | // Read Message History
  (1n << 6n) | // Add Reactions
  (1n << 14n) | // Embed Links
  (1n << 15n) // Attach Files

export function inviteUrl(applicationId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=bot%20applications.commands&permissions=${BOT_PERMISSIONS}`
}

/** The application commands the relay registers: `/ask` and the message command **Ask bot**. */
export const COMMANDS = [
  {
    name: 'ask',
    type: 1,
    description: 'Ask a Zomfy bot',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      { type: 3, name: 'prompt', description: 'What to ask', required: true, max_length: 4000 },
      { type: 3, name: 'bot', description: 'The bot’s handle (the default bot when left out)', required: false, max_length: 64 }
    ]
  },
  { name: 'Ask bot', type: 3, contexts: [0, 1], integration_types: [0] }
]
