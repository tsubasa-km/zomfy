import { afterEach, expect, mock, test } from 'bun:test'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, QUESTION_OPTION_IDS, type CodexConnection } from '@zomfy/protocol'
import * as launchSpecs from './chat-agent-launch-specs.ts'

// The agent is a scripted ACP server (acp-fake-agent.fixture.ts) run as a real child process.
let connection: CodexConnection = 'acp'
let resumeOnAcp = false
mock.module('./chat-agent-launch-specs.ts', () => ({
  ...launchSpecs,
  resolveChatAgent: async () => ({
    status: 'ready',
    argv: [process.execPath, join(import.meta.dir, connection === 'app-server' ? 'codex-app-server.fixture.ts' : 'acp-fake-agent.fixture.ts')],
    env: resumeOnAcp ? { TEST_RESUME_CODEX_THREAD: '1' } : {},
    display: 'fake',
    codexConnection: connection
  })
}))
const { AcpAgentSession, emptyAgentState } = await import('./acp-agent-session.ts')

const open: InstanceType<typeof AcpAgentSession>[] = []
afterEach(() => {
  for (const session of open.splice(0)) session.dispose()
  connection = 'acp'
  resumeOnAcp = false
}, 30_000)

function agentSession() {
  const said: string[] = []
  const session = new AcpAgentSession('codex', process.cwd(), null, emptyAgentState(), {
    emit: async (update: acp.SessionUpdate) => {
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') said.push(update.content.text)
    },
    onState: () => undefined,
    onAgentSessionId: () => undefined
  })
  open.push(session)
  return { session, said }
}

const text = (t: string): acp.ContentBlock[] => [{ type: 'text', text: t }]
const neverAnswered = () => new Promise<acp.RequestPermissionResponse>(() => undefined)

test('a Stop ends the turn through the agent', async () => {
  const { session, said } = agentSession()
  await session.ensureStarted()
  const abort = new AbortController()
  const turn = session.prompt(text('wait'), abort, neverAnswered)
  await Bun.sleep(100)
  abort.abort()
  expect(await turn).toBe('cancelled')
  expect(said).toEqual(['wound down'])
}, 15_000)

test('a Stop answers the agent’s open permission ask, so its turn can end', async () => {
  const { session, said } = agentSession()
  await session.ensureStarted()
  const abort = new AbortController()
  const turn = session.prompt(text('ask'), abort, neverAnswered)
  await Bun.sleep(100)
  abort.abort()
  expect(await turn).toBe('cancelled')
  expect(said).toEqual(['asked: cancelled'])
}, 15_000)

test('an agent that ignores the cancel loses its server, and the next turn starts a fresh one', async () => {
  const { session, said } = agentSession()
  session.cancelGraceMs = 200
  await session.ensureStarted()
  const abort = new AbortController()
  const turn = session.prompt(text('ignore'), abort, neverAnswered)
  await Bun.sleep(100)
  abort.abort()
  expect(await turn).toBe('cancelled')
  expect(await session.prompt(text('again'), new AbortController(), neverAnswered)).toBe('end_turn')
  expect(said).toEqual(['echo: again'])
}, 15_000)

test('send now: the interrupted turn ends before the new prompt reaches the agent', async () => {
  const { session, said } = agentSession()
  await session.ensureStarted()
  const first = new AbortController()
  const interrupted = session.prompt(text('wait'), first, neverAnswered)
  await Bun.sleep(100)
  first.abort()
  // The agent refuses a prompt while one runs; this one must wait for the first to end.
  const next = session.prompt(text('now'), new AbortController(), neverAnswered)
  expect(await interrupted).toBe('cancelled')
  expect(await next).toBe('end_turn')
  expect(said).toEqual(['wound down', 'echo: now'])
}, 15_000)

test('a turn stopped before its server is up never reaches the agent', async () => {
  const { session, said } = agentSession()
  const abort = new AbortController()
  abort.abort()
  expect(await session.prompt(text('hello'), abort, neverAnswered)).toBe('cancelled')
  expect(await session.prompt(text('hi'), new AbortController(), neverAnswered)).toBe('end_turn')
  expect(said).toEqual(['echo: hi'])
}, 15_000)

test('an agent that cannot reopen its conversation is handed the chat before its prompt is read', async () => {
  const said: string[] = []
  const notices: string[] = []
  let handoff = ''
  // The scripted agent has neither session/resume nor session/load, so the saved id cannot reopen.
  const session = new AcpAgentSession('codex', process.cwd(), 'gone', emptyAgentState(), {
    emit: async (update: acp.SessionUpdate) => {
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') said.push(update.content.text)
      if (update.sessionUpdate === 'notice') notices.push(update.title)
    },
    onState: () => undefined,
    onAgentSessionId: () => undefined,
    onConversationLost: async () => {
      await Bun.sleep(20)
      handoff = 'the chat so far. '
    }
  })
  open.push(session)
  const blocks = (): acp.ContentBlock[] => [{ type: 'text', text: `${handoff}hi` }]
  expect(await session.prompt(blocks, new AbortController(), neverAnswered)).toBe('end_turn')
  expect(said).toEqual(['echo: the chat so far. hi'])
  expect(notices).toHaveLength(1)
}, 15_000)

function directSession(previous: string | null = null) {
  const updates: acp.SessionUpdate[] = []
  const ids: string[] = []
  const session = new AcpAgentSession('codex', process.cwd(), previous, emptyAgentState(), {
    emit: async (update) => { updates.push(update) },
    onState: () => undefined,
    onAgentSessionId: (id) => { ids.push(id) }
  })
  open.push(session)
  const reply = () => updates.flatMap((update) =>
    update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : []
  ).join('')
  return { session, updates, ids, reply }
}

test('Direct uses the saved thread and applies a reasoning option to the next turn', async () => {
  connection = 'app-server'
  const { session, ids, reply } = directSession('saved-id')
  await session.setOption('reasoning_effort', 'high')
  expect(await session.prompt(text('hi'), new AbortController(), neverAnswered)).toBe('end_turn')
  expect(ids).toEqual([])
  expect(reply()).toBe('resume saved-id: hi (high)')
}, 15_000)

test('Direct streams tool events, scopes approval decisions and routes a Codex question by ID', async () => {
  connection = 'app-server'
  const { session, updates, ids, reply } = directSession()
  const calls: string[] = []
  const ask = async (request: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> => {
    calls.push(request.toolCall.toolCallId)
    if (request.toolCall.toolCallId === 'cmd') {
      expect(request.options.map((option) => option.optionId)).toEqual(['accept', 'decline'])
      return { outcome: { outcome: 'selected', optionId: 'accept' } }
    }
    expect(request.toolCall._meta?.[CHAT_META.toolName]).toBe('AskUserQuestion')
    return { outcome: { outcome: 'selected', optionId: QUESTION_OPTION_IDS.answer }, _meta: {
      [CHAT_META.answers]: { answers: { 'Which color?': 'Blue' } }
    } }
  }
  expect(await session.prompt(text('ask'), new AbortController(), ask)).toBe('end_turn')
  expect(calls).toEqual(['cmd', 'choice'])
  expect(ids).toEqual(['direct-thread'])
  expect(reply()).toBe('choice Blue')
  expect(updates.filter((update) => update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update').map((update) => update.status))
    .toEqual(['in_progress', 'completed'])
}, 15_000)

test('a connection change leaves the current turn running and resumes its thread on the next send', async () => {
  const { session, ids, reply } = directSession()
  await session.ensureStarted()
  const abort = new AbortController()
  const turn = session.prompt(text('ask'), abort, async () => {
    connection = 'app-server'
    return { outcome: { outcome: 'selected', optionId: 'ok' } }
  })
  expect(await turn).toBe('end_turn')
  expect(reply()).toBe('asked: selected')
  expect(await session.prompt(text('next'), new AbortController(), neverAnswered)).toBe('end_turn')
  expect(ids).toHaveLength(1)
  expect(reply()).toBe(`asked: selectedresume ${ids[0]}: next`)
}, 15_000)

test('switching from Direct to ACP reuses the stored thread', async () => {
  connection = 'app-server'
  const { session, ids, reply } = directSession()
  expect(await session.prompt(text('one'), new AbortController(), neverAnswered)).toBe('end_turn')
  connection = 'acp'
  resumeOnAcp = true
  expect(await session.prompt(text('two'), new AbortController(), neverAnswered)).toBe('end_turn')
  expect(ids).toEqual(['direct-thread'])
  expect(reply()).toBe('new direct-thread: oneecho: two')
}, 15_000)

test('Direct declines a secret question without sending it to the chat clients', async () => {
  connection = 'app-server'
  const { session, updates, reply } = directSession()
  const asked: string[] = []
  expect(await session.prompt(text('secret'), new AbortController(), async (request) => {
    asked.push(request.toolCall.toolCallId)
    return { outcome: { outcome: 'cancelled' } }
  })).toBe('end_turn')
  expect(asked).toEqual([])
  expect(reply()).toBe('choice skipped')
  expect(updates.some((update) => update.sessionUpdate === 'notice' && update.title.includes('secret answer'))).toBe(true)
}, 15_000)

test('Direct interrupts a turn before the start response arrives, then accepts another turn', async () => {
  connection = 'app-server'
  const { session } = directSession()
  await session.ensureStarted()
  const abort = new AbortController()
  const turn = session.prompt(text('wait'), abort, neverAnswered)
  await Bun.sleep(150)
  abort.abort()
  expect(await turn).toBe('cancelled')
  expect(await session.prompt(text('next'), new AbortController(), neverAnswered)).toBe('end_turn')
}, 15_000)

test('Direct resume failure preserves the ID and process exit does not replay the prompt', async () => {
  connection = 'app-server'
  const missing = directSession('missing')
  await expect(missing.session.prompt(text('hi'), new AbortController(), neverAnswered)).rejects.toThrow('Thread does not exist')
  expect(missing.ids).toEqual([])
  const exited = directSession()
  await expect(exited.session.prompt(text('exit'), new AbortController(), neverAnswered)).rejects.toThrow('closed the connection')
  expect(exited.reply()).toBe('')
  expect(await exited.session.prompt(text('next'), new AbortController(), neverAnswered)).toBe('end_turn')
  expect(exited.ids).toEqual(['direct-thread'])
  expect(exited.reply()).toBe('resume direct-thread: next')
}, 15_000)
