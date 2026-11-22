import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RETIRED_MARKER, legacyPathPattern, retireLegacyHome, rewriteLegacyPaths } from './legacy-home-retire.ts'

// Every test works in a throwaway folder standing in for the user's home; never the real one.
const windows = process.platform === 'win32'
let user: string
let legacy: string
let home: string
let claude: string

beforeEach(() => {
  user = mkdtempSync(join(tmpdir(), 'zomfy-retire-test-'))
  legacy = join(user, '.acp-harness') // legacy
  home = join(user, '.zomfy')
  claude = join(user, '.claude')
  mkdirSync(join(home, 'sessions'), { recursive: true })
})
afterEach(() => rmSync(user, { recursive: true, force: true }))

const run = () => retireLegacyHome(legacy, home, { claudeConfigDir: async () => claude, now: () => new Date('2026-11-22T01:02:03Z') })
const read = (file: string) => readFileSync(join(home, file), 'utf8')
const json = (file: string) => JSON.parse(read(file))
const link = () => symlinkSync(home, legacy, windows ? 'junction' : 'dir')

describe('legacyPathPattern', () => {
  test('matches the whole legacy path in either slash style and keeps that style', () => {
    const old = 'C:\\Users\\me\\.acp-harness' // legacy
    const pattern = legacyPathPattern(old, true)
    const rewrite = (s: string) => rewriteLegacyPaths(s, pattern, 'C:\\Users\\me\\.zomfy', true)
    expect(rewrite('C:\\Users\\me\\.acp-harness\\scratch\\a')).toBe('C:\\Users\\me\\.zomfy\\scratch\\a') // legacy
    expect(rewrite('c:/users/ME/.ACP-HARNESS/x')).toBe('C:/Users/me/.zomfy/x') // legacy
    expect(rewrite('cd "C:\\Users\\me\\.acp-harness" && ls')).toBe('cd "C:\\Users\\me\\.zomfy" && ls') // legacy
    expect(rewrite('@C:\\Users\\me\\.acp-harness\\attachments\\f.txt and more')).toBe('@C:\\Users\\me\\.zomfy\\attachments\\f.txt and more') // legacy
  })

  test('leaves lookalikes alone', () => {
    const pattern = legacyPathPattern('/home/me/.acp-harness', false) // legacy
    const rewrite = (s: string) => rewriteLegacyPaths(s, pattern, '/home/me/.zomfy', false)
    for (const keep of [
      '/home/me/.acp-harness-old/x', // legacy lookalike
      '/home/me/acp-harness/workspaces/repo/wt', // the legacy worktree root, not the home
      '/mnt/home/me/.acp-harness/x', // legacy, a longer path
      '/home/me/.acp-harness.bak' // legacy lookalike
    ])
      expect(rewrite(keep)).toBe(keep)
    expect(rewrite('/home/me/.acp-harness')).toBe('/home/me/.zomfy') // legacy
  })
})

describe('retireLegacyHome', () => {
  test('rewrites records, workspaces, terminals and transcripts, backing up the originals', async () => {
    const scratch = join(legacy, 'scratch', 'quick')
    const index = [
      { id: 's1', cwd: scratch, title: `@${join(legacy, 'attachments', 'a.txt')} look`, claudeSessionId: null },
      { id: 's2', cwd: join(user, 'acp-harness', 'workspaces', 'repo', 'wt'), claudeSessionId: null } // legacy worktree root stays
    ]
    writeFileSync(join(home, 'sessions', 'index.json'), JSON.stringify(index, null, 2) + '\n')
    writeFileSync(join(home, 'state.json'), JSON.stringify({ workspaces: [{ id: 'w', path: scratch }], [scratch]: 1 }))
    mkdirSync(join(home, 'inline-terminals'))
    writeFileSync(join(home, 'inline-terminals', 't.json'), JSON.stringify({ cwd: legacy }))
    const untouched = JSON.stringify({ sessionUpdate: 'agent_message_chunk', content: { text: 'hello' } })
    const torn = '{"text":"' + legacy.replace(/\\/g, '\\\\')
    writeFileSync(
      join(home, 'sessions', 's1.jsonl'),
      [untouched, JSON.stringify({ rawInput: { command: `cd ${scratch} && ls` } }), torn, ''].join('\n')
    )
    // The person's own files are never rewritten.
    mkdirSync(join(home, 'scratch', 'quick'), { recursive: true })
    writeFileSync(join(home, 'scratch', 'quick', 'notes.json'), JSON.stringify({ p: scratch }))
    mkdirSync(join(home, 'attachments'))
    writeFileSync(join(home, 'attachments', 'a.json'), JSON.stringify({ p: scratch }))

    const result = await run()
    expect(result.failures).toEqual([])
    expect(result.rewritten.sort()).toEqual(
      [join('inline-terminals', 't.json'), join('sessions', 'index.json'), join('sessions', 's1.jsonl'), 'state.json'].sort()
    )

    const newScratch = join(home, 'scratch', 'quick')
    expect(json('sessions/index.json')[0].cwd).toBe(newScratch)
    expect(json('sessions/index.json')[0].title).toBe(`@${join(home, 'attachments', 'a.txt')} look`)
    expect(json('sessions/index.json')[1].cwd).toBe(index[1]!.cwd)
    expect(read('sessions/index.json')).toBe(JSON.stringify(json('sessions/index.json'), null, 2) + '\n')
    expect(json('state.json')).toEqual({ workspaces: [{ id: 'w', path: newScratch }], [newScratch]: 1 })
    expect(json('inline-terminals/t.json')).toEqual({ cwd: home })
    const lines = read('sessions/s1.jsonl').split('\n')
    expect(lines[0]).toBe(untouched)
    expect(JSON.parse(lines[1]!).rawInput.command).toBe(`cd ${newScratch} && ls`)
    expect(lines[2]).toBe(torn)
    expect(read('scratch/quick/notes.json')).toContain('acp-harness') // legacy
    expect(read('attachments/a.json')).toContain('acp-harness') // legacy

    const backup = join(home, 'backup-legacy-home-20261122010203')
    expect(JSON.parse(readFileSync(join(backup, 'sessions', 'index.json'), 'utf8'))).toEqual(index)
    expect(existsSync(join(home, RETIRED_MARKER))).toBe(true)
    expect(readdirSync(join(home, 'sessions')).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  test('a second run changes nothing', async () => {
    writeFileSync(join(home, 'state.json'), JSON.stringify({ workspaces: [{ path: join(legacy, 'scratch') }] }))
    await run()
    const after = read('state.json')
    rmSync(join(home, RETIRED_MARKER))
    const again = await run()
    expect(again.rewritten).toEqual([])
    expect(read('state.json')).toBe(after)
  })

  test("moves a chat's Claude conversation out of the old folder's name", async () => {
    const oldCwd = join(legacy, 'scratch', 'quick')
    writeFileSync(join(home, 'sessions', 'index.json'), JSON.stringify([{ id: 's1', cwd: oldCwd, claudeSessionId: 'c1' }]))
    const name = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')
    const oldDir = join(claude, 'projects', name(oldCwd))
    mkdirSync(join(oldDir, 'c1'), { recursive: true })
    writeFileSync(join(oldDir, 'c1.jsonl'), '{"type":"user"}\n')
    writeFileSync(join(oldDir, 'c1', 'tool.txt'), 'big')

    const result = await run()
    expect(result.movedConversations).toBe(1)
    const newDir = join(claude, 'projects', name(join(home, 'scratch', 'quick')))
    expect(readFileSync(join(newDir, 'c1.jsonl'), 'utf8')).toBe('{"type":"user"}\n')
    expect(readFileSync(join(newDir, 'c1', 'tool.txt'), 'utf8')).toBe('big')
    expect(existsSync(join(oldDir, 'c1.jsonl'))).toBe(false)
  })

  test('removes the link at the old path, never what it points to', async () => {
    writeFileSync(join(home, 'settings.json'), '{}')
    link()
    const result = await run()
    expect(result.linkRemoved).toBe(true)
    expect(existsSync(legacy)).toBe(false)
    expect(() => lstatSync(legacy)).toThrow()
    expect(read('settings.json')).toBe('{}')
  })

  test('never removes a real folder at the old path', async () => {
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'MOVED-TO-ZOMFY.txt'), 'copied') // legacy marker
    writeFileSync(join(legacy, 'state.json'), '{}')
    const result = await run()
    expect(result.linkRemoved).toBe(false)
    expect(readFileSync(join(legacy, 'state.json'), 'utf8')).toBe('{}')
  })

  test('leaves a link that points somewhere else', async () => {
    const other = join(user, 'other')
    mkdirSync(other)
    symlinkSync(other, legacy, windows ? 'junction' : 'dir')
    const result = await run()
    expect(result.linkRemoved).toBe(false)
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true)
  })

  test('keeps the link and leaves no marker when a rewrite fails, then finishes on a later start', async () => {
    writeFileSync(join(home, 'sessions', 'index.json'), JSON.stringify([{ id: 's1', cwd: join(legacy, 'x') }]))
    // A file where the backup folder goes: the original cannot be backed up, so the file is not rewritten.
    writeFileSync(join(home, 'backup-legacy-home-20261122010203'), '')
    link()
    let result = await run()
    expect(result.failures.length).toBe(1)
    expect(result.linkRemoved).toBe(false)
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true)
    expect(existsSync(join(home, RETIRED_MARKER))).toBe(false)
    expect(json('sessions/index.json')[0].cwd).toBe(join(legacy, 'x'))

    rmSync(join(home, 'backup-legacy-home-20261122010203'))
    result = await run()
    expect(result.failures).toEqual([])
    expect(result.linkRemoved).toBe(true)
    expect(json('sessions/index.json')[0].cwd).toBe(join(home, 'x'))
  })

  test('once done, a later start only retries the link', async () => {
    await run()
    writeFileSync(join(home, 'state.json'), JSON.stringify({ path: join(legacy, 'y') }))
    link()
    const result = await run()
    expect(result.rewritten).toEqual([])
    expect(result.linkRemoved).toBe(true)
    expect(json('state.json').path).toBe(join(legacy, 'y'))
  })
})
