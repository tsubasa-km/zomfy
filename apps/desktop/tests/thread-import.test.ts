import { expect, test } from 'bun:test'
import type { PastConversation } from '@zomfy/protocol'
import { folderName, listedThreads, matchesSearch, recentConversations, threadGroups, threadPlace } from '../src/lib/thread-import.ts'

const conversation = (fields: Partial<PastConversation>): PastConversation => ({
  claudeSessionId: fields.conversationId ?? 'c1',
  title: 'Fix the login bug',
  lastModified: 0,
  gitBranch: null,
  openSessionId: null,
  ...fields
})

test('a daemon’s answer becomes the asked agent’s threads, keyed apart from other agents’', () => {
  const listed = listedThreads('codex', [conversation({ agent: 'codex', conversationId: 'c1' })])
  expect(listed).toMatchObject([{ agent: 'codex', conversationId: 'c1', key: 'codex:c1' }])
})

test('a daemon that predates thread import lists Claude’s whoever is asked: its answer counts for Claude alone', () => {
  const old = [{ claudeSessionId: 'c1', title: 'Fix the login bug', lastModified: 1, gitBranch: null, openSessionId: null }]
  expect(listedThreads('codex', old)).toEqual([])
  expect(listedThreads('claude', old)).toMatchObject([{ agent: 'claude', conversationId: 'c1', key: 'claude:c1' }])
})

test('search matches every word against the title, folder and branch', () => {
  const [thread] = listedThreads('claude', [conversation({ agent: 'claude', cwd: 'C:\\work\\Storefront', gitBranch: 'fix/login' })])
  if (!thread) throw new Error('not listed')
  expect(matchesSearch(thread, '')).toBe(true)
  expect(matchesSearch(thread, 'LOGIN storefront')).toBe(true)
  expect(matchesSearch(thread, 'fix/login bug')).toBe(true)
  expect(matchesSearch(thread, 'login checkout')).toBe(false)
})

test('threads group by agent in the app’s order, each agent’s newest first, and an agent with no match is left out', () => {
  const threads = [
    ...listedThreads('codex', [
      conversation({ agent: 'codex', conversationId: 'old', title: 'Old fix', lastModified: 1 }),
      conversation({ agent: 'codex', conversationId: 'new', title: 'New fix', lastModified: 5 })
    ]),
    ...listedThreads('claude', [conversation({ agent: 'claude', conversationId: 'c', title: 'Write docs', lastModified: 3 })])
  ]
  expect(threadGroups(threads, '').map((g) => [g.agent, g.threads.map((t) => t.conversationId)])).toEqual([
    ['claude', ['c']],
    ['codex', ['new', 'old']]
  ])
  expect(threadGroups(threads, 'fix').map((g) => g.agent)).toEqual(['codex'])
  expect(threadGroups(threads, 'nothing like it')).toEqual([])
})

test('a folder is named by the last part of its path', () => {
  expect(folderName('C:\\work\\storefront\\')).toBe('storefront')
  expect(folderName('/home/me/api')).toBe('api')
  expect(folderName('/')).toBe('/')
})

test('seen from a workspace, a row says where its import runs when that is not the workspace’s own folder', () => {
  const here = { id: 'w-repo', path: String.raw`C:\work\Repo` }
  expect(threadPlace({ cwd: String.raw`C:\work\Repo`, workspaceId: 'w-repo' }, here)).toEqual({ kind: 'here' })
  expect(threadPlace({ cwd: 'c:/work/repo/packages/App', workspaceId: 'w-repo' }, here)).toEqual({ kind: 'below', path: 'packages/App' })
  expect(threadPlace({ cwd: String.raw`C:\work\Repo-wt`, workspaceId: 'w-wt' }, here)).toEqual({ kind: 'elsewhere', workspaceId: 'w-wt' })
  expect(threadPlace({ cwd: String.raw`D:\loose`, workspaceId: null }, here)).toEqual({ kind: 'elsewhere', workspaceId: null })
  expect(threadPlace({ cwd: String.raw`C:\work\Repo\old`, workspaceId: null, folderMissing: true }, here)).toEqual({ kind: 'gone' })
})

test('Recent conversations: what the workspace owns and no thread shows yet', () => {
  const list = [
    conversation({ conversationId: 'own', workspaceId: 'w-repo' }),
    conversation({ conversationId: 'open', workspaceId: 'w-repo', openSessionId: 's1' }),
    conversation({ conversationId: 'sibling', workspaceId: 'w-wt' }),
    conversation({ conversationId: 'gone', workspaceId: null, folderMissing: true })
  ]
  expect(recentConversations(list, 'w-repo').map((c) => c.conversationId)).toEqual(['own'])
})
