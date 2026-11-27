import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TerminalInfo } from '@zomfy/protocol'
import type { Keyring } from './hosting-token-store.ts'
import { SecretRedactor, secretRedactor } from './secret-redaction.ts'
import { SecretService } from './secret-service.ts'
import { createTerminalTools } from './terminal-agent-tools.ts'
import { TerminalScreens } from './terminal-screen.ts'

// Fake credential stores only: nothing here touches the OS credential store or ~/.zomfy.

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

let dir: string
let services: SecretService[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zomfy-secrets-'))
})
afterEach(() => {
  services = []
  rmSync(dir, { recursive: true, force: true })
})

function service(keyring: Keyring = new FakeKeyring(), redactor = new SecretRedactor()) {
  const s = new SecretService({ path: join(dir, 'secrets.json'), keyring, redactor })
  services.push(s)
  return { s, keyring, redactor }
}

describe('SecretService', () => {
  test('keeps the value in the credential store and lists no values', async () => {
    const { s, keyring } = service()
    const list = await s.save({ name: 'XAI_API_KEY', value: KEY, agents: [], projectIds: [] })
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain(KEY)
    expect(list[0]).toMatchObject({ name: 'XAI_API_KEY', storage: 'keyring' })
    expect([...(keyring as FakeKeyring).entries.values()]).toEqual([KEY])
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain(KEY)
  })

  test('falls back to the owner-only file without a credential store, and says so', async () => {
    const { s } = service(new FakeKeyring(true))
    const [info] = await s.save({ name: 'TOKEN', value: KEY, agents: [], projectIds: [] })
    expect(info!.storage).toBe('file')
    expect(JSON.stringify(await s.list())).not.toContain(KEY)
    // A fresh daemon reads it back from the file.
    const again = new SecretService({ path: join(dir, 'secrets.json'), keyring: new FakeKeyring(true), redactor: new SecretRedactor() })
    expect(await again.envFor('claude', null)).toEqual({ TOKEN: KEY })
  })

  test('refuses bad names, duplicates and a missing value', async () => {
    const { s } = service()
    const base = { agents: [], projectIds: [] }
    await expect(s.save({ ...base, name: '1BAD', value: KEY })).rejects.toThrow('not a variable name')
    await expect(s.save({ ...base, name: 'KEY' })).rejects.toThrow('Enter the value')
    await s.save({ ...base, name: 'KEY', value: KEY })
    await expect(s.save({ ...base, name: 'key', value: KEY })).rejects.toThrow('exists')
  })

  test('an agent gets the value itself in the variable', async () => {
    const { s } = service()
    await s.save({ name: 'XAI_API_KEY', value: KEY, agents: [], projectIds: [] })
    expect(await s.envFor('grok', 'project-1')).toEqual({ XAI_API_KEY: KEY })
  })

  test('a secret saved with the removed tunnel loads as an environment secret, and the file loses its tunnel fields', async () => {
    const keyring = new FakeKeyring()
    keyring.entries.set('secret:old', KEY)
    const path = join(dir, 'secrets.json')
    const old = { id: 'old', name: 'XAI_API_KEY', exposure: 'tunnel', upstream: 'https://api.x.ai/v1', baseUrlVariable: 'XAI_BASE_URL', agents: [], projectIds: [], storage: 'keyring', updatedAt: '2026-11-01T00:00:00.000Z' }
    writeFileSync(path, JSON.stringify({ secrets: [old] }))
    const { s } = service(keyring)
    expect(await s.envFor('claude', null)).toEqual({ XAI_API_KEY: KEY })
    const [info] = await s.list()
    expect(info).toEqual({ id: 'old', name: 'XAI_API_KEY', agents: [], projectIds: [], storage: 'keyring', updatedAt: '2026-11-01T00:00:00.000Z' })
    const saved = readFileSync(path, 'utf8')
    expect(saved).not.toContain('upstream')
    expect(saved).not.toContain('exposure')
  })

  test('ignores the tunnel fields an older client still sends', async () => {
    const { s } = service()
    const legacy = { name: 'XAI_API_KEY', value: KEY, agents: [], projectIds: [], exposure: 'tunnel', upstream: 'https://api.x.ai/v1' }
    const [info] = await s.save(legacy as Parameters<SecretService['save']>[0])
    expect(Object.keys(info!).sort()).toEqual(['agents', 'id', 'name', 'projectIds', 'storage', 'updatedAt'])
    expect(await s.envFor('claude', null)).toEqual({ XAI_API_KEY: KEY })
  })

  test('limits a secret to its agents and projects', async () => {
    const { s } = service()
    await s.save({ name: 'ONLY_CODEX', value: KEY, agents: ['codex'], projectIds: [] })
    await s.save({ name: 'ONLY_P1', value: `${KEY}-p1`, agents: [], projectIds: ['p1'] })
    expect(Object.keys(await s.envFor('codex', null))).toEqual(['ONLY_CODEX'])
    expect(Object.keys(await s.envFor('claude', 'p1'))).toEqual(['ONLY_P1'])
    expect(await s.envFor('claude', null)).toEqual({})
  })

  test('replacing keeps the settings and swaps the value; deleting forgets it', async () => {
    const { s, keyring } = service()
    const [info] = await s.save({ name: 'TOKEN', value: KEY, agents: [], projectIds: [] })
    await s.save({ id: info!.id, name: 'TOKEN', agents: ['claude'], projectIds: [] })
    expect(await s.envFor('claude', null)).toEqual({ TOKEN: KEY })
    await s.save({ id: info!.id, name: 'TOKEN', value: 'replaced-value', agents: ['claude'], projectIds: [] })
    expect(await s.envFor('claude', null)).toEqual({ TOKEN: 'replaced-value' })
    expect(await s.delete(info!.id)).toEqual([])
    expect((keyring as FakeKeyring).entries.size).toBe(0)
    expect(await s.envFor('claude', null)).toEqual({})
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
