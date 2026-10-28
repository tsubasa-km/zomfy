import { afterEach, expect, mock, test } from 'bun:test'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import * as launchSpecs from './chat-agent-launch-specs.ts'

// The agent is a scripted ACP server (acp-fake-agent.fixture.ts) run as a real child process.
const fixture = join(import.meta.dir, 'acp-fake-agent.fixture.ts')
mock.module('./chat-agent-launch-specs.ts', () => ({
  ...launchSpecs,
  resolveChatAgent: async () => ({ status: 'ready', argv: [process.execPath, fixture], env: {}, display: 'fake' })
}))
const { AcpAgentSession, emptyAgentState } = await import('./acp-agent-session.ts')

const open: InstanceType<typeof AcpAgentSession>[] = []
afterEach(() => {
  for (const session of open.splice(0)) session.dispose()
})

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
