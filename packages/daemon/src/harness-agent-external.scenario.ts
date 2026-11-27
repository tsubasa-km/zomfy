import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { HARNESS_METHODS, WRAP_UP_HINT, type ChatAgentId, type ChatPermissionMode, type CodexConnection, type SessionInfo } from '@zomfy/protocol'
import * as launchSpecs from './chat-agent-launch-specs.ts'
import { git } from './git-cli.ts'

// harness-agent's prompt() with Codex over ACP and Direct, and another ACP agent, run as fake
// agents (acp-fake-agent.fixture.ts, codex-app-server.fixture.ts) in real child processes
// (codex-and-acp-parity.md). harness-agent-external.test.ts runs this file in its own process,
// with ZOMFY_HOME in a temporary folder: nothing here reads or writes the person's ~/.zomfy.

const home = process.env.ZOMFY_HOME
if (!home || !process.env.ZOMFY_SCENARIO) throw new Error('Run through harness-agent-external.test.ts, which gives it its own ZOMFY_HOME')

let connection: CodexConnection = 'acp'
mock.module('./chat-agent-launch-specs.ts', () => ({
  ...launchSpecs,
  codexConnection: async () => connection,
  resolveChatAgent: async (agent: ChatAgentId) => ({
    status: 'ready',
    argv: [process.execPath, join(import.meta.dir, agent === 'codex' && connection === 'app-server' ? 'codex-app-server.fixture.ts' : 'acp-fake-agent.fixture.ts')],
    // Codex offers codex-acp's modes; the other agent (Goose here) offers none.
    env: agent === 'codex' ? { FAKE_ACP_CODEX_MODES: '1' } : {},
    display: 'fake',
    ...(agent === 'codex' ? { codexConnection: connection } : {})
  })
}))

const { createHarnessAgent } = await import('./harness-agent.ts')
const { WorkspaceManager } = await import('./workspace-manager.ts')
const { SessionRegistry } = await import('./session-registry.ts')
const { TerminalManager } = await import('./terminal-manager.ts')

const workspaces = new WorkspaceManager(join(home, 'state.json'))
const sessions = new SessionRegistry()
const terminals = new TerminalManager()
/** The asks that reached the window, and how the window answers them. */
const asked: acp.RequestPermissionRequest[] = []
let client: acp.ClientConnection
let first = ''
let second = ''

async function repo(name: string): Promise<string> {
  const path = join(home!, name)
  await mkdir(path, { recursive: true })
  await git(path, ['init', '-b', 'main'])
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@example.com'], ['commit.gpgsign', 'false']] as const) await git(path, ['config', k, v])
  await writeFile(join(path, 'a.txt'), 'one\n')
  await git(path, ['add', 'a.txt'])
  await git(path, ['commit', '-m', 'one'])
  return path
}

async function primaryOf(path: string): Promise<string> {
  const project = await workspaces.addProject(path)
  const found = (await workspaces.snapshot()).workspaces.find((w) => w.projectId === project.id && w.isPrimary)
  if (!found) throw new Error('No primary workspace')
  return found.id
}

beforeAll(async () => {
  await workspaces.load()
  await sessions.load()
  first = await primaryOf(await repo('first'))
  second = await primaryOf(await repo('second'))
  const app = createHarnessAgent(workspaces, sessions, terminals)
  const toAgent = new TransformStream<Uint8Array, Uint8Array>()
  const toClient = new TransformStream<Uint8Array, Uint8Array>()
  app.connect(acp.ndJsonStream(toClient.writable, toAgent.readable))
  client = acp
    .client({ name: 'scenario' })
    .onRequest('session/request_permission', (ctx) => {
      asked.push(ctx.params)
      const allow = ctx.params.options.find((o) => o.kind === 'allow_once')
      return allow ? { outcome: { outcome: 'selected', optionId: allow.optionId } } : { outcome: { outcome: 'cancelled' } }
    })
    .onNotification('session/update', () => undefined)
    .connect(acp.ndJsonStream(toAgent.writable, toClient.readable))
  await client.agent.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
})

afterAll(async () => {
  for (const session of sessions.all()) await sessions.remove(session.id)
  // The fake agents' processes go with their chats.
  await Bun.sleep(300)
})

const request = <T>(method: string, params: unknown) => client.agent.request(method, params) as Promise<T>

async function chat(agent: ChatAgentId, permissionMode: ChatPermissionMode, workspaceId = first): Promise<string> {
  const info = await request<SessionInfo>(HARNESS_METHODS.sessionCreate, { workspaceId, agent, permissionMode })
  return info.id
}

/** Sends a prompt as the window does, and returns what the agent said in that turn. */
async function say(sessionId: string, text: string): Promise<{ stopReason: string; said: string }> {
  const before = (await sessions.transcript(sessionId)).length
  const { stopReason } = await client.agent.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] })
  const said = (await sessions.transcript(sessionId))
    .slice(before)
    .flatMap((u) => (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text' ? [u.content.text] : []))
    .join('')
  return { stopReason, said }
}

const setMode = (sessionId: string, permissionMode: ChatPermissionMode) =>
  request(HARNESS_METHODS.sessionSetOptions, { sessionId, options: { permissionMode } })

test('Codex over ACP starts in the chat’s mode and follows a change to plan', async () => {
  connection = 'acp'
  const id = await chat('codex', 'bypassPermissions')
  expect((await say(id, 'state')).said).toBe('mode=agent-full-access collaboration=default')
  await setMode(id, 'plan')
  expect((await say(id, 'state')).said).toBe('mode=read-only collaboration=plan')
  await setMode(id, 'acceptEdits')
  expect((await say(id, 'state')).said).toBe('mode=workspace-write collaboration=default')
})

test('a scheduled Codex bot run starts read-only', async () => {
  connection = 'acp'
  // As bot-runs.ts opens a scheduled run's chat: origin bot, held to plan.
  const record = sessions.create({
    workspaceId: first,
    cwd: workspaces.workspacePath(first)!,
    origin: 'bot',
    agent: 'codex',
    options: { model: null, effort: null, permissionMode: 'plan' }
  })
  expect((await say(record.id, 'state')).said).toBe('mode=read-only collaboration=plan')
})

test('a bot chat held read-only does not run on an agent with no such mode', async () => {
  const record = sessions.create({
    workspaceId: first,
    cwd: workspaces.workspacePath(first)!,
    origin: 'bot',
    agent: 'goose',
    options: { model: null, effort: null, permissionMode: 'plan' }
  })
  await expect(say(record.id, 'hello')).rejects.toThrow()
  const notices = (await sessions.transcript(record.id)).flatMap((u) => (u.sessionUpdate === 'notice' ? [u.title] : []))
  expect(notices.at(-1)).toContain('has no mode Zomfy can hold to plan')
  expect(sessions.get(record.id)?.status).toBe('error')
})

test('Zomfy’s instructions go ahead of an ACP conversation’s first prompt, once', async () => {
  connection = 'acp'
  const id = await chat('codex', 'auto')
  const opening = (await say(id, 'hello')).said
  expect(opening).toContain('<zomfy-instructions>')
  expect(opening).toContain(WRAP_UP_HINT)
  expect(opening.endsWith('hello')).toBe(true)
  expect((await say(id, 'again')).said).toBe('echo: again')
  // The transcript keeps only what was typed.
  const typed = (await sessions.transcript(id)).flatMap((u) => (u.sessionUpdate === 'user_message_chunk' && u.content.type === 'text' ? [u.content.text] : []))
  expect(typed).toEqual(['hello', 'again'])
})

test('a thread takes its first prompt’s name, then the agent’s title, and keeps a name the person gives', async () => {
  connection = 'acp'
  const id = await chat('codex', 'auto')
  await say(id, 'fix the login form')
  expect(sessions.get(id)?.title).toBe('fix the login form')
  await say(id, 'title:Login form fix')
  expect(sessions.get(id)?.title).toBe('Login form fix')
  await request(HARNESS_METHODS.sessionRename, { sessionId: id, title: 'Mine' })
  await say(id, 'title:Another title')
  expect(sessions.get(id)?.title).toBe('Mine')
})

test('a thread named only by its agent’s settings still takes its first prompt’s name', async () => {
  connection = 'acp'
  const id = await chat('goose', 'default')
  // Something reached the transcript before the first prompt (an agent change, a handoff).
  await sessions.record(id, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'handed over' } })
  await say(id, 'rename the button')
  expect(sessions.get(id)?.title).toBe('rename the button')
})

test('Codex over ACP runs the harness’s read-only tools without a card; other MCP tools ask', async () => {
  connection = 'acp'
  const id = await chat('codex', 'default')
  asked.length = 0
  expect((await say(id, 'mcp:harness.list_sessions')).said).toBe('mcp: approved')
  expect(asked).toEqual([])
  expect((await say(id, 'mcp:github.create_issue')).said).toBe('mcp: approved')
  expect(asked.map((a) => a.toolCall.toolCallId).length).toBe(1)
})

test('bypassPermissions answers every approval of a Codex chat itself', async () => {
  connection = 'acp'
  const id = await chat('codex', 'bypassPermissions')
  asked.length = 0
  expect((await say(id, 'mcp:github.create_issue')).said).toBe('mcp: approved')
  expect(asked).toEqual([])
})

test('Codex Direct opens its thread and starts each turn with the chat’s mode and instructions', async () => {
  connection = 'app-server'
  const id = await chat('codex', 'acceptEdits')
  const { opened, turn } = JSON.parse((await say(id, 'params')).said)
  expect(opened).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' })
  expect(opened.developerInstructions).toContain(WRAP_UP_HINT)
  expect(turn).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'workspaceWrite' } })
  expect(turn.collaborationMode.mode).toBe('default')
  await setMode(id, 'plan')
  const planned = JSON.parse((await say(id, 'params')).said).turn
  expect(planned).toMatchObject({ sandboxPolicy: { type: 'readOnly', networkAccess: false }, collaborationMode: { mode: 'plan' } })
  await setMode(id, 'auto')
  expect(JSON.parse((await say(id, 'params')).said).turn).toMatchObject({ approvalsReviewer: 'auto_review', sandboxPolicy: { type: 'workspaceWrite' } })
  await setMode(id, 'bypassPermissions')
  expect(JSON.parse((await say(id, 'params')).said).turn).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } })
})

test('Codex Direct accepts its harness tool approvals itself and shows the others as approval cards', async () => {
  connection = 'app-server'
  const id = await chat('codex', 'default')
  asked.length = 0
  expect((await say(id, 'mcp:harness.list_sessions')).said).toBe('elicitation accept')
  expect(asked).toEqual([])
  expect((await say(id, 'mcp:github.create_issue')).said).toBe('elicitation accept')
  expect(asked.map((a) => a.toolCall.title)).toEqual(['mcp.github.create_issue'])
})

test('Codex Direct names the thread with the title Codex gives it', async () => {
  connection = 'app-server'
  const id = await chat('codex', 'auto')
  await say(id, 'title:Direct title')
  expect(sessions.get(id)?.title).toBe('Direct title')
})

test('a Codex chat moves to another folder and goes on with the same conversation there', async () => {
  connection = 'acp'
  const id = await chat('codex', 'auto')
  const before = (await say(id, 'cwd')).said
  const conversation = /session=(\S+)/.exec(before)?.[1]
  expect(before).toContain(`cwd=${workspaces.workspacePath(first)}`)
  await request(HARNESS_METHODS.sessionMove, { sessionId: id, workspaceId: second })
  expect(sessions.get(id)?.workspaceId).toBe(second)
  expect((await say(id, 'cwd')).said).toBe(`session=${conversation} cwd=${workspaces.workspacePath(second)}`)
})
