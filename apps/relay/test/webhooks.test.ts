import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureBot } from '../src/contract/fixtures'
import type { Hub } from '../src/hub'
import { keptHeaders, parseBody } from '../src/webhooks/source'
import { BASE, hubStub } from './helpers'
import { cleanHub, hmacHex, pairWith, type Paired } from './sources-helpers'

// docs/specs/bots/sources/webhooks.md: hooks minted by the daemon's `webhook.mint` action, called
// as a monitoring system, a form or GitHub would.

const bot = { ...fixtureBot, places: [] }
let p: Paired

async function mint(filters: Record<string, unknown> = {}) {
  p = await pairWith([bot])
  const minted = await p.action('webhook.mint', undefined, { botId: bot.id })
  expect(minted.ok).toBe(true)
  const { hookId, key, url } = minted.result
  await p.rehello([bot], [{ id: 'rule-wh', botId: bot.id, source: 'webhook', kinds: ['call'], places: [], graceMs: 60_000, webhook: { hookId, ...filters } }])
  return { hookId: hookId as string, key: key as string, url: url as string }
}

function call(hookId: string, body: string, opts: { key?: string; inPath?: string; headers?: Record<string, string> } = {}) {
  return SELF.fetch(`${BASE}/hooks/${hookId}${opts.inPath ? `/${opts.inPath}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}), ...opts.headers },
    body
  })
}

afterEach(cleanHub)

describe('calls', () => {
  it('queues a call with the right key, refuses a wrong one, and takes the key in the path', async () => {
    const { hookId, key, url } = await mint()
    expect(url).toBe(`${BASE}/hooks/${hookId}`)
    expect(key).toMatch(/^zomfywh_[A-Za-z0-9_-]{43}$/)
    const res = await call(hookId, JSON.stringify({ level: 'error', title: 'Disk full' }), { key })
    expect(res.status).toBe(200)
    const answer = (await res.json()) as any
    expect(answer).toMatchObject({ status: 'queued', callId: expect.stringMatching(/^call_[A-Za-z0-9]{20}$/) })
    const notice = await p.next('webhook_notice')
    expect(notice).toMatchObject({ botId: bot.id, hookId, callId: answer.callId, ruleId: 'rule-wh', conversation: { source: 'webhook', externalId: hookId } })

    expect((await call(hookId, '{}', { key: `zomfywh_${'x'.repeat(43)}` })).status).toBe(401)
    expect((await call(hookId, '{}')).status).toBe(401)
    expect((await call('wh_AAAAAAAAAAAAAAAA', '{}', { key })).status).toBe(404)
    const inPath = await call(hookId, '{"level":"warning"}', { inPath: key })
    expect(((await inPath.json()) as any).status).toBe('queued')
  })

  it('stores the call without the Authorization header or the key, and hands it to the daemon', async () => {
    const { hookId, key } = await mint()
    const res = await call(hookId, JSON.stringify({ note: `the key is ${key}`, nested: { url: `${BASE}/hooks/${hookId}/${key}` } }), {
      key,
      headers: { 'X-Request-Id': 'r1', Cookie: 'session=1', 'X-Api-Key': 'nope' }
    })
    const { callId } = (await res.json()) as any
    const fetched = await p.action('webhook.fetch', undefined, { callId })
    expect(fetched.ok).toBe(true)
    expect(fetched.result.headers).toEqual({ 'content-type': 'application/json', 'x-request-id': 'r1' })
    expect(JSON.stringify(fetched.result)).not.toContain(key)
    expect(fetched.result.parsed.value.note).toBe('the key is [zomfy webhook key]')
    const dump = await hubStub().dumpStorage()
    expect(dump).not.toContain(key)
    expect(dump).not.toContain('Bearer')
    expect((await p.action('webhook.done', undefined, { callId })).ok).toBe(true)
    expect((await p.action('webhook.fetch', undefined, { callId })).ok).toBe(false)
  })

  it('answers 413 to a body over 1 MiB', async () => {
    const { hookId, key } = await mint()
    const res = await call(hookId, 'x'.repeat(1024 * 1024 + 1), { key, headers: { 'Content-Type': 'text/plain' } })
    expect(res.status).toBe(413)
  })

  it('makes the same sender delivery a duplicate, and a paused hook paused', async () => {
    const { hookId, key } = await mint()
    const first = (await (await call(hookId, '{"a":1}', { key, headers: { 'X-GitHub-Delivery': 'gd-1' } })).json()) as any
    const again = (await (await call(hookId, '{"a":1}', { key, headers: { 'X-GitHub-Delivery': 'gd-1' } })).json()) as any
    expect(first.status).toBe('queued')
    expect(again).toEqual({ callId: first.callId, status: 'duplicate' })
    expect((await p.action('webhook.state', undefined, { hookId, state: 'paused' })).ok).toBe(true)
    expect(((await (await call(hookId, '{"a":2}', { key })).json()) as any).status).toBe('paused')
  })

  it('runs the hook’s filters: a call that does not match is ignored, picks and subject come with it', async () => {
    const { hookId, key } = await mint({ where: [{ path: 'body.level', op: '=', values: ['error'] }], pick: ['body.title'], subjectFrom: 'body.issue_id' })
    expect(((await (await call(hookId, '{"level":"info"}', { key })).json()) as any).status).toBe('ignored')
    const queued = (await (await call(hookId, '{"level":"error","title":"Disk full","issue_id":4512}', { key })).json()) as any
    expect(queued.status).toBe('queued')
    expect(await p.next('webhook_notice')).toMatchObject({ subject: '4512' })
    const fetched = await p.action('webhook.fetch', undefined, { callId: queued.callId })
    expect(fetched.result).toMatchObject({ subject: '4512', picks: [{ path: 'body.title', value: 'Disk full' }] })
  })
})

describe('sender signatures', () => {
  it('rejects a GitHub-signed hook’s bad X-Hub-Signature-256 and accepts a good one', async () => {
    const { hookId, key } = await mint()
    const set = await p.action('webhook.secret', undefined, { hookId, adapter: 'github', secret: 'gh-hook-secret' })
    expect(set.ok).toBe(true)
    const body = '{"action":"opened"}'
    const bad = await call(hookId, body, { inPath: key, headers: { 'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}` } })
    expect(bad.status).toBe(401)
    expect(((await bad.json()) as any).error).toBe('bad_signature')
    const good = await call(hookId, body, { inPath: key, headers: { 'X-Hub-Signature-256': `sha256=${await hmacHex('gh-hook-secret', body)}` } })
    expect(good.status).toBe(200)
    const { callId } = (await good.json()) as any
    const fetched = await p.action('webhook.fetch', undefined, { callId })
    expect(fetched.result.signatureValid).toBe(true)
    expect(fetched.result.headers['x-hub-signature-256']).toBeUndefined()
  })

  it('checks Standard Webhooks with a secret the Hub generates', async () => {
    const { hookId, key } = await mint()
    const made = await p.action('webhook.secret', undefined, { hookId, adapter: 'standard', generate: true })
    const secret = made.result.secret as string
    expect(secret).toMatch(/^whsec_/)
    const body = '{"type":"invoice.paid"}'
    const id = 'msg_1'
    const ts = String(Math.floor(Date.now() / 1000))
    const keyBytes = Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0))
    const mac = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(`${id}.${ts}.${body}`))
    const sig = btoa(String.fromCharCode(...new Uint8Array(mac)))
    const ok = await call(hookId, body, { key, headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` } })
    expect(ok.status).toBe(200)
    const stale = await call(hookId, body, { key, headers: { 'webhook-id': 'msg_2', 'webhook-timestamp': String(Number(ts) - 3600), 'webhook-signature': `v1,${sig}` } })
    expect(stale.status).toBe(401)
  })
})

describe('caps, bursts, retention and rotation', () => {
  it('refuses the 201st run within an hour with 429 and tells the owner once', async () => {
    const { hookId, key } = await mint()
    await runInDurableObject(hubStub(), (_h: Hub, state) => {
      for (let i = 0; i < 200; i++) {
        state.storage.sql.exec("INSERT INTO webhook_calls (call_id, hook_id, received_at, state) VALUES (?, ?, ?, 'queued')", `call_${String(i).padStart(20, 'x')}`, hookId, Date.now() - 1000)
      }
    })
    expect((await call(hookId, '{}', { key })).status).toBe(429)
    expect((await call(hookId, '{}', { key })).status).toBe(429)
    expect(await p.next('webhook_alert')).toMatchObject({ hookId, condition: 'cap_reached', count: 200 })
    await p.link.settle(200)
    expect(p.deliveries('webhook_alert')).toHaveLength(0)
  })

  it('tells the owner once of a burst of refused calls', async () => {
    const { hookId } = await mint()
    for (let i = 0; i < 22; i++) await call(hookId, '{}', { key: `zomfywh_${'y'.repeat(43)}` })
    expect(await p.next('webhook_alert')).toMatchObject({ condition: 'refusal_burst' })
    await p.link.settle(200)
    expect(p.deliveries('webhook_alert')).toHaveLength(0)
  })

  it('deletes a body 7 days after the call', async () => {
    const { hookId, key } = await mint()
    const { callId } = (await (await call(hookId, '{"x":1}', { key })).json()) as any
    await runInDurableObject(hubStub(), (_h: Hub, state) => {
      const old = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000
      state.storage.sql.exec('UPDATE webhook_calls SET received_at = ? WHERE call_id = ?', old, callId)
      state.storage.sql.exec("UPDATE due SET at = ? WHERE key = 'purge'", Date.now() - 1)
    })
    await runDurableObjectAlarm(hubStub())
    expect((await p.action('webhook.fetch', undefined, { callId })).error.code).toBe('not_found')
  })

  it('overlaps a rotated key until its time, and stop-now cancels pending calls', async () => {
    const { hookId, key } = await mint()
    const rotated = await p.action('webhook.rotate', undefined, { hookId, overlapUntil: Date.now() + 60_000 })
    const next = rotated.result.key as string
    expect(next).not.toBe(key)
    expect((await call(hookId, '{"old":1}', { key })).status).toBe(200)
    expect((await call(hookId, '{"new":1}', { key: next })).status).toBe(200)
    const stopped = await p.action('webhook.rotate', undefined, { hookId, stopNow: true })
    expect(stopped.result.cancelledCalls).toBe(2)
    expect((await call(hookId, '{}', { key: next })).status).toBe(401)
    expect((await call(hookId, '{}', { key: stopped.result.key })).status).toBe(200)
    const list = await p.action('webhook.list', undefined, {})
    expect(list.result.hooks).toEqual([expect.objectContaining({ hookId, state: 'live', adapter: null })])
    expect(JSON.stringify(list.result)).not.toContain('zomfywh_')
  })

  it('lets only the hook’s own computer manage it', async () => {
    const { hookId } = await mint()
    // A second computer (the setup code is single use; a test may reuse it).
    await runInDurableObject(hubStub(), (_h: Hub, state) => state.storage.sql.exec('DELETE FROM setup_codes'))
    const other = await pairWith([{ ...bot, id: 'bot-other', handle: 'other' }])
    expect((await other.action('webhook.state', undefined, { hookId, state: 'paused' })).error.code).toBe('not_found')
    expect((await other.action('webhook.mint', undefined, { botId: bot.id })).error.code).toBe('unknown_bot')
  })
})

describe('bodies and headers', () => {
  it('parses JSON, forms with repeated keys, and text; refuses a body nested past the cap', () => {
    expect(parseBody('{"a":1}', 'application/json')).toEqual({ kind: 'json', value: { a: 1 } })
    expect(parseBody('a=1&a=2&b=3', 'application/x-www-form-urlencoded')).toEqual({ kind: 'form', value: { a: ['1', '2'], b: '3' } })
    expect(parseBody('plain words', 'text/plain')).toEqual({ kind: 'text', value: 'plain words' })
    expect(parseBody(`${'['.repeat(200)}${']'.repeat(200)}`, 'application/json')).toBeNull()
  })

  it('keeps only allowlisted headers', () => {
    expect(keptHeaders({ authorization: 'Bearer x', 'x-github-event': 'push', 'stripe-signature': 't=1', cookie: 'c', 'content-type': 'text/plain' })).toEqual({ 'x-github-event': 'push', 'content-type': 'text/plain' })
  })
})
