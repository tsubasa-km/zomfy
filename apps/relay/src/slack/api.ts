// Slack's Web API as the Hub uses it (docs/specs/bots/sources/slack.md). Every call is a form POST to
// https://slack.com/api/<method> with the bot token (objects such as `blocks` are sent as JSON
// strings, which every method accepts); tests put a fake Slack behind SOURCES_TRANSPORT.

import type { Env } from '../env'
import { retryAfterMs, sourceFetch } from '../sources/common'

export const SLACK_API = 'https://slack.com/api'

export interface SlackResult<T = any> {
  ok: boolean
  status: number
  body: T | null
  /** Slack's `error` (`channel_not_found`, `not_in_channel`, `ratelimited`, …). */
  error: string | null
  /** Set on 429: how long to wait before the next call. */
  retryAfterMs: number | null
}

export async function slackCall<T = any>(env: Env, method: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<SlackResult<T>> {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue
    form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  let response: Response
  try {
    response = await sourceFetch(env)(
      new Request(`${SLACK_API}/${method}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN ?? ''}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal
      })
    )
  } catch {
    return { ok: false, status: 0, body: null, error: 'network', retryAfterMs: null }
  }
  const text = await response.text()
  let parsed: any = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  const ok = response.ok && parsed?.ok === true
  return {
    ok,
    status: response.status,
    body: ok ? (parsed as T) : null,
    error: ok ? null : String(parsed?.error ?? `http_${response.status}`),
    retryAfterMs: response.status === 429 || parsed?.error === 'ratelimited' ? retryAfterMs(response) : null
  }
}

/** Posts to an interaction's `response_url` (ephemeral notes, replacing the pressed message). */
export async function slackRespond(env: Env, url: string, body: unknown): Promise<SlackResult> {
  if (!/^https:\/\/hooks\.slack\.com\//.test(url)) return { ok: false, status: 0, body: null, error: 'bad_response_url', retryAfterMs: null }
  try {
    const response = await sourceFetch(env)(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
    await response.text()
    return { ok: response.ok, status: response.status, body: null, error: response.ok ? null : `http_${response.status}`, retryAfterMs: response.status === 429 ? retryAfterMs(response) : null }
  } catch {
    return { ok: false, status: 0, body: null, error: 'network', retryAfterMs: null }
  }
}

/** Uploads a file into a channel or thread (Slack's external upload: get a URL, send the bytes, complete). */
export async function slackUpload(
  env: Env,
  file: { name: string; bytes: Uint8Array; title?: string },
  where: { channel: string; threadTs?: string; comment?: string }
): Promise<SlackResult<{ files?: { id: string }[] }>> {
  const url = await slackCall<{ upload_url: string; file_id: string }>(env, 'files.getUploadURLExternal', { filename: file.name, length: file.bytes.length })
  if (!url.ok || !url.body) return url as SlackResult
  try {
    const sent = await sourceFetch(env)(new Request(url.body.upload_url, { method: 'POST', body: file.bytes }))
    await sent.text()
    if (!sent.ok) return { ok: false, status: sent.status, body: null, error: `upload_${sent.status}`, retryAfterMs: sent.status === 429 ? retryAfterMs(sent) : null }
  } catch {
    return { ok: false, status: 0, body: null, error: 'network', retryAfterMs: null }
  }
  return slackCall(env, 'files.completeUploadExternal', {
    files: [{ id: url.body.file_id, title: file.title ?? file.name }],
    channel_id: where.channel,
    thread_ts: where.threadTs,
    initial_comment: where.comment
  })
}

/** Errors that will not get better by retrying. */
const PERMANENT = new Set([
  'channel_not_found',
  'not_in_channel',
  'is_archived',
  'msg_too_long',
  'no_text',
  'invalid_blocks',
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'missing_scope',
  'message_not_found',
  'cant_update_message',
  'thread_not_found',
  'restricted_action',
  'invalid_arguments',
  'bad_response_url'
])

export function isPermanent(error: string | null): boolean {
  return error !== null && (PERMANENT.has(error) || error.startsWith('http_4'))
}
