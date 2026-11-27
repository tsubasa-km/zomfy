import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { secretPlaceholder, type TerminalInfo } from '@zomfy/protocol'
import type { Keyring } from './hosting-token-store.ts'
import { SecretRedactor, secretRedactor } from './secret-redaction.ts'
import { SecretService } from './secret-service.ts'
import { createTerminalTools } from './terminal-agent-tools.ts'
import { TerminalScreens } from './terminal-screen.ts'

// Fake credential stores and a fake upstream only: nothing here touches the OS credential store,
// ~/.zomfy, or a real API.

const KEY = 'xai-test-0123456789abcdef'

class FakeKeyring implements Keyring {
  readonly entries = new Map<string, string>()
  constructor(private readonly broken = false) {}
  async get(name: string) {
    return this.entries.get(name) ?? null
  }
  async set(name: string, value: string) {
    if (this.broken) throw new Error('no credential store')
    this.entries.set(name, value)
  }
  async delete(name: string) {
    this.entries.delete(name)
  }
}

interface Seen {
  url: string
  headers: Record<string, string>
  body: string
}

/** Echoes what it got, the key included, as an API that reflects headers would. */
const seen: Seen[] = []
const upstream = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const headers = Object.fromEntries(request.headers)
    const body = await request.text()
    seen.push({ url: request.url, headers, body })
    return Response.json({ echoed: headers.authorization ?? null, apiKey: headers['x-api-key'] ?? null }, { headers: { 'x-echo': headers.authorization ?? '' } })
  }
})
afterAll(() => upstream.stop(true))

let dir: string
let services: SecretService[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zomfy-secrets-'))
  seen.length = 0
})
afterEach(() => {
  for (const s of services) s.tunnel.stop()
  services = []
  rmSync(dir, { recursive: true, force: true })
})

function service(keyring: Keyring = new FakeKeyring(), redactor = new SecretRedactor()) {
  const s = new SecretService({ path: join(dir, 'secrets.json'), keyring, redactor })
  services.push(s)
  return { s, keyring, redactor }
}

const upstreamUrl = () => `http://127.0.0.1:${upstream.port}/v1`

describe('SecretService', () => {
  test('keeps the value in the credential store and lists no values', async () => {
    const { s, keyring } = service()
    const list = await s.save({ name: 'XAI_API_KEY', value: KEY, exposure: 'tunnel', upstream: upstreamUrl(), baseUrlVariable: 'XAI_BASE_URL', agents: [], projectIds: [] })
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain(KEY)
    expect(list[0]).toMatchObject({ name: 'XAI_API_KEY', exposure: 'tunnel', storage: 'keyring', upstream: upstreamUrl() })
    expect([...(keyring as FakeKeyring).entries.values()]).toEqual([KEY])
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain(KEY)
  })

  test('falls back to the owner-only file without a credential store, and says so', async () => {
    const { s } = service(new FakeKeyring(true))
    const [info] = await s.save({ name: 'TOKEN', value: KEY, exposure: 'env', agents: [], projectIds: [] })
    expect(info!.storage).toBe('file')
    expect(JSON.stringify(await s.list())).not.toContain(KEY)
    // A fresh daemon reads it back from the file.
    const again = new SecretService({ path: join(dir, 'secrets.json'), keyring: new FakeKeyring(true), redactor: new SecretRedactor() })
    expect(await again.envFor('claude', null)).toEqual({ TOKEN: KEY })
  })

  test('refuses bad names, duplicates, a missing value and a plain-http upstream', async () => {
    const { s } = service()
    const base = { exposure: 'tunnel' as const, upstream: upstreamUrl(), agents: [], projectIds: [] }
    await expect(s.save({ ...base, name: '1BAD', value: KEY })).rejects.toThrow('not a variable name')
    await expect(s.save({ ...base, name: 'KEY' })).rejects.toThrow('Enter the value')
    await expect(s.save({ ...base, name: 'KEY', value: KEY, upstream: 'http://api.example.com' })).rejects.toThrow('https')
    await s.save({ ...base, name: 'KEY', value: KEY })
    await expect(s.save({ ...base, name: 'key', value: KEY })).rejects.toThrow('exists')
  })

  test('an agent-visible environment holds only the placeholder and the tunnel address', async () => {
    const { s } = service()
    await s.save({ name: 'XAI_API_KEY', value: KEY, exposure: 'tunnel', upstream: upstreamUrl(), baseUrlVariable: 'XAI_BASE_URL', agents: [], projectIds: [] })
    const env = await s.envFor('grok', 'project-1')
    expect(env.XAI_API_KEY).toBe(secretPlaceholder('XAI_API_KEY'))
    expect(env.XAI_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/t\/[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(env)).not.toContain(KEY)
  })

  test('limits a secret to its agents and projects', async () => {
    const { s } = service()
    await s.save({ name: 'ONLY_CODEX', value: KEY, exposure: 'env', agents: ['codex'], projectIds: [] })
    await s.save({ name: 'ONLY_P1', value: `${KEY}-p1`, exposure: 'env', agents: [], projectIds: ['p1'] })
    expect(Object.keys(await s.envFor('codex', null))).toEqual(['ONLY_CODEX'])
    expect(Object.keys(await s.envFor('claude', 'p1'))).toEqual(['ONLY_P1'])
    expect(await s.envFor('claude', null)).toEqual({})
  })

  test('replacing keeps the settings and swaps the value; deleting forgets it', async () => {
    const { s, keyring } = service()
    const [info] = await s.save({ name: 'TOKEN', value: KEY, exposure: 'env', agents: [], projectIds: [] })
    await s.save({ id: info!.id, name: 'TOKEN', exposure: 'env', agents: ['claude'], projectIds: [] })
    expect(await s.envFor('claude', null)).toEqual({ TOKEN: KEY })
    await s.save({ id: info!.id, name: 'TOKEN', value: 'replaced-value', exposure: 'env', agents: ['claude'], projectIds: [] })
    expect(await s.envFor('claude', null)).toEqual({ TOKEN: 'replaced-value' })
    expect(await s.delete(info!.id)).toEqual([])
    expect((keyring as FakeKeyring).entries.size).toBe(0)
    expect(await s.envFor('claude', null)).toEqual({})
  })
})

describe('the tunnel', () => {
  async function tunnelled() {
    const { s, redactor } = service()
    const [info] = await s.save({ name: 'XAI_API_KEY', value: KEY, exposure: 'tunnel', upstream: upstreamUrl(), baseUrlVariable: 'XAI_BASE_URL', agents: [], projectIds: [] })
    const env = await s.envFor('grok', null)
    return { s, redactor, info: info!, base: env.XAI_BASE_URL!, placeholder: env.XAI_API_KEY! }
  }

  test('reaches the upstream with the real header, and redacts its echo', async () => {
    const { base, placeholder } = await tunnelled()
    const response = await fetch(`${base}/chat/completions?stream=false`, {
      method: 'POST',
      headers: { authorization: `Bearer ${placeholder}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'grok' })
    })
    expect(response.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(new URL(seen[0]!.url).pathname).toBe('/v1/chat/completions')
    expect(new URL(seen[0]!.url).search).toBe('?stream=false')
    expect(seen[0]!.body).toBe('{"model":"grok"}')
    const text = await response.text()
    expect(text).not.toContain(KEY)
    expect(JSON.parse(text).echoed).toBe('Bearer [secret XAI_API_KEY]')
    expect(response.headers.get('x-echo')).toBe('Bearer [secret XAI_API_KEY]')
  })

  test('swaps a placeholder in the query, and leaves other secrets\' placeholders alone', async () => {
    const { s, base } = await tunnelled()
    await s.save({ name: 'OTHER_KEY', value: 'other-secret-value', exposure: 'tunnel', upstream: upstreamUrl(), agents: [], projectIds: [] })
    await fetch(`${base}/models?key=${encodeURIComponent(secretPlaceholder('XAI_API_KEY'))}`, {
      headers: { 'x-api-key': secretPlaceholder('OTHER_KEY'), 'x-near-miss': `${secretPlaceholder('XAI_API_KEY')}2` }
    })
    expect(new URL(seen[0]!.url).searchParams.get('key')).toBe(KEY)
    expect(seen[0]!.headers['x-api-key']).toBe(secretPlaceholder('OTHER_KEY'))
    expect(seen[0]!.headers['x-near-miss']).toBe(`${secretPlaceholder('XAI_API_KEY')}2`)
  })

  test('an unknown route and a deleted secret\'s route answer 404', async () => {
    const { s, base, info } = await tunnelled()
    expect((await fetch(`${base.replace(/\/t\/.*/, '/t/nope')}/x`)).status).toBe(404)
    await s.delete(info.id)
    expect((await fetch(`${base}/x`)).status).toBe(404)
    expect(seen).toHaveLength(0)
  })
})

describe('redaction', () => {
  test('replaces values in text and nested updates, leaving untouched objects as they were', () => {
    const r = new SecretRedactor()
    r.set([{ name: 'TOKEN', value: KEY }, { name: 'TINY', value: 'abc' }])
    expect(r.text(`export TOKEN=${KEY}; abc`)).toBe('export TOKEN=[secret TOKEN]; abc')
    const update = { sessionUpdate: 'tool_call_update', content: [{ type: 'text', text: `${KEY}\n` }], other: { a: 1 } }
    const out = r.deep(update)
    expect(JSON.stringify(out)).not.toContain(KEY)
    expect(out.other).toBe(update.other)
    const clean = { a: ['x'] }
    expect(r.deep(clean)).toBe(clean)
  })

  test('streams, catching a value split across chunks', async () => {
    const r = new SecretRedactor()
    r.set([{ name: 'TOKEN', value: KEY }])
    const text = `before ${KEY} middle ${KEY} after`
    const bytes = new TextEncoder().encode(text)
    const chunks = [bytes.slice(0, 10), bytes.slice(10, 11), bytes.slice(11, 30), bytes.slice(30)]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c)
        controller.close()
      }
    }).pipeThrough(r.stream())
    expect(await new Response(stream).text()).toBe('before [secret TOKEN] middle [secret TOKEN] after')
  })

  test("terminal_read gives the agent the secret's name, not its value", async () => {
    secretRedactor.set([{ name: 'TOKEN', value: KEY }])
    try {
      const info: TerminalInfo = { id: 't1', workspaceId: 'w1', title: 'pwsh', shell: 'pwsh', cwd: '/', createdAt: 0, exitCode: null }
      const screens = new TerminalScreens({ replay: () => `PS> echo $env:TOKEN\r\n${KEY}\r\nPS> `, size: () => ({ cols: 80, rows: 10 }) })
      const terminals = { list: () => [info], get: () => info, agentWrite: () => undefined, onPersonInput: () => () => true }
      const tools = createTerminalTools({ terminals, screens, chat: () => ({ workspaceId: 'w1', title: 'Chat' }) })
      const { result } = await tools.read('chat', { terminalId: 't1' })
      expect(result).not.toContain(KEY)
      expect(result).toContain('[secret TOKEN]')
    } finally {
      secretRedactor.set([])
    }
  })
})
