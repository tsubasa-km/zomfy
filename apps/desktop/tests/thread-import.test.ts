import { expect, test } from 'bun:test'
import type { PastConversation } from '@acp-harness/protocol'
import { folderName, listedThreads, matchesSearch, threadGroups } from '../src/lib/thread-import.ts'

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
