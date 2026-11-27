import { expect, test } from 'bun:test'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionRegistry, type SessionRecord } from './session-registry.ts'
import { refreshClaudeThreadTitle, summarizeThreadTitle, type ThreadTitleModel } from './thread-title.ts'

function thread(agent: 'claude' | 'codex' = 'codex') {
  const record: SessionRecord = {
    id: 'thread', workspaceId: 'workspace', cwd: '/work', title: 'First message',
    status: 'idle', createdAt: 0, turnStartedAt: null, claudeSessionId: null,
    options: { model: null, permissionMode: 'default', effort: null },
    agent, automaticTitle: { agent, source: 'first-message' }
  }
  const sessions = new SessionRegistry()
  const listeners = new Set<Parameters<SessionRegistry['onChange']>[0]>()
  sessions.get = (id) => id === record.id ? record : undefined
  sessions.update = (id, patch) => {
    if (id !== record.id) return
    Object.assign(record, patch)
    for (const callback of listeners) callback([])
  }
  sessions.onChange = (callback) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }
  return { sessions, record }
}

const model = (readTitle: ThreadTitleModel['readTitle']): ThreadTitleModel => ({
  model: 'turn-model', env: {}, cwd: '/work', readTitle
})
const enabled = async () => true

test('a native name matching the prompt still prevents the supplemental request', async () => {
  const { sessions, record } = thread()
  let calls = 0
  await summarizeThreadTitle(sessions, record.id, record.title, model(async () => record.title), true, async () => {
    calls++
    return 'Summary'
  }, enabled)
  expect(calls).toBe(0)
  expect(record.title).toBe('First message')
  expect(record.automaticTitle?.source).toBe('agent')
})

test('a native name is applied with the supplemental setting off', async () => {
  const { sessions, record } = thread()
  let calls = 0
  await summarizeThreadTitle(sessions, record.id, record.title, model(async () => 'Backend title'), false, async () => {
    calls++
    return 'Summary'
  }, enabled)
  expect(calls).toBe(0)
  expect(record.title).toBe('Backend title')
})

test('a native notification during generation cancels the request and keeps the native title', async () => {
  const { sessions, record } = thread()
  let aborted = false
  const calledModels: string[] = []
  await summarizeThreadTitle(sessions, record.id, record.title, model(async () => undefined), true, async (turnModel, _, signal) => {
    calledModels.push(turnModel.model)
    sessions.setAgentTitle(record.id, 'codex', 'First message')
    aborted = signal.aborted
    return 'Late summary'
  }, enabled)
  expect(calledModels).toEqual(['turn-model'])
  expect(aborted).toBe(true)
  expect(record.title).toBe('First message')
  expect(record.automaticTitle?.source).toBe('agent')
})

test('a native name replaces a completed summary and a manual rename takes precedence', async () => {
  const { sessions, record } = thread()
  await summarizeThreadTitle(sessions, record.id, record.title, model(async () => undefined), true, async () => 'Summary', enabled)
  expect(record.title).toBe('Summary')
  sessions.setAgentTitle(record.id, 'codex', 'Native title')
  expect(record.title).toBe('Native title')
  sessions.update(record.id, { title: 'My title', manuallyNamed: true })
  sessions.setAgentTitle(record.id, 'codex', 'Later native title')
  expect(record.title).toBe('My title')
})

test('a manual rename during generation keeps the user title', async () => {
  const { sessions, record } = thread()
  await summarizeThreadTitle(sessions, record.id, record.title, model(async () => undefined), true, async () => {
    sessions.update(record.id, { title: 'My title', manuallyNamed: true })
    return 'Summary'
  }, enabled)
  expect(record.title).toBe('My title')
})

test('Claude reads a native title from its active transcript and ignores the prompt preview', async () => {
  const { sessions, record } = thread('claude')
  const cwd = await mkdtemp(join(tmpdir(), 'zomfy-claude-title-'))
  const id = crypto.randomUUID()
  const transcriptPath = join(cwd, id + '.jsonl')
  sessions.update(record.id, { claudeSessionId: id, cwd })
  try {
    const backend = { id, cwd, transcriptPath, firstTurn: false }
    const preview = JSON.stringify({ type: 'last-prompt', sessionId: id, lastPrompt: 'First message' })
    await writeFile(transcriptPath, preview + '\n')
    await refreshClaudeThreadTitle(sessions, record.id, backend)
    expect(record.automaticTitle?.source).toBe('first-message')
    const name = JSON.stringify({ type: 'ai-title', sessionId: id, aiTitle: 'Claude title' })
    await writeFile(transcriptPath, preview + '\n' + name + '\n')
    await refreshClaudeThreadTitle(sessions, record.id, backend)
    expect(record.title).toBe('Claude title')
    expect(record.automaticTitle?.source).toBe('agent')
  } finally {
    await rm(transcriptPath, { force: true })
    await rmdir(cwd)
  }
})
