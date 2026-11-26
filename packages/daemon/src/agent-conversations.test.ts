import { afterAll, expect, mock, setDefaultTimeout, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import { HARNESS_METHODS, type ChatAgentId, type PastConversation, type SessionInfo } from '@zomfy/protocol'
import * as launchSettings from './chat-agent-launch-settings.ts'
import * as launchSpecs from './chat-agent-launch-specs.ts'
import { DEFAULT_SESSION_OPTIONS, type SessionRecord } from './session-registry.ts'
import type { HandlerContext } from './handlers/handler-context.ts'

// Imports start real processes and git; a loaded Windows runner needs more than bun's 5 s, and
// bun 1.4 resets the preload's default for each file.
setDefaultTimeout(30_000)

// Listing and importing agents' own conversations (`_harness/sessions/history` and `/resume`)
// against synthetic records in a temp folder: Claude's projects, Codex's rollouts, and a scripted
// ACP agent standing in for one that lists and replays its sessions (OpenCode).

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'zomfy-import-')))
const project = join(root, 'work', 'project')
const other = join(root, 'work', 'other')
const gone = join(root, 'work', 'gone')
for (const dir of [project, other]) mkdirSync(dir, { recursive: true })

const day = (n: number) => new Date(Date.UTC(2026, 0, n))

// --- Claude: `$CLAUDE_CONFIG_DIR/projects/<folder>/<session id>.jsonl`.
const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'
process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
{
  const dir = join(root, 'claude', 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const base = { sessionId: CLAUDE_ID, cwd: project, isSidechain: false, userType: 'external', version: '2.0.0', gitBranch: 'main' }
  const lines = [
    { ...base, type: 'user', uuid: 'aaaaaaaa-0000-4000-8000-000000000001', parentUuid: null, message: { role: 'user', content: 'Rename the settings page' } },
    {
      ...base,
      type: 'assistant',
      uuid: 'aaaaaaaa-0000-4000-8000-000000000002',
      parentUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'Renamed it to Preferences.' }] }
    }
  ]
  const file = join(dir, `${CLAUDE_ID}.jsonl`)
  writeFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(''))
  utimesSync(file, day(5), day(5))
}

// --- Codex: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`.
const codexHome = join(root, 'codex')
const CODEX = {
  modern: '22222222-2222-4222-8222-222222222201',
  legacy: '22222222-2222-4222-8222-222222222202',
  subagent: '22222222-2222-4222-8222-222222222203',
  compressed: '22222222-2222-4222-8222-222222222204',
  orphan: '22222222-2222-4222-8222-222222222205',
  noMeta: '22222222-2222-4222-8222-222222222206',
  garbage: '22222222-2222-4222-8222-222222222207'
}
const meta = (id: string, cwd: string, extra: object = {}) => ({
  type: 'session_meta',
  payload: { id, session_id: id, cwd, source: 'cli', base_instructions: { text: 'You are Codex.' }, git: { branch: 'main', commit_hash: 'abc' }, ...extra }
})
const event = (payload: object) => ({ type: 'event_msg', payload })
const item = (payload: object) => event({ type: 'item_completed', item: payload })
const response = (payload: object) => ({ type: 'response_item', payload })
const modelUser = (...texts: string[]) => response({ type: 'message', role: 'user', content: texts.map((text) => ({ type: 'input_text', text })) })
const modelAgent = (text: string) => response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })

async function rollout(id: string, at: Date, records: (object | string)[], compressed = false): Promise<void> {
  const dir = join(codexHome, 'sessions', '2026', '01', String(at.getUTCDate()).padStart(2, '0'))
  mkdirSync(dir, { recursive: true })
  const text = records.map((r) => `${typeof r === 'string' ? r : JSON.stringify(r)}\n`).join('')
  const file = join(dir, `rollout-2026-01-0${at.getUTCDate()}T10-00-00-${id}.jsonl${compressed ? '.zst' : ''}`)
  writeFileSync(file, compressed ? await Bun.zstdCompress(text) : text)
  utimesSync(file, at, at)
}

// Today's Codex: what its UI shows is recorded as items; the model's copy of a prompt carries context too.
await rollout(CODEX.modern, day(4), [
  meta(CODEX.modern, project),
  modelUser('<environment_context>\n  <cwd>/work/project</cwd>\n</environment_context>', 'Fix the login bug'),
  item({ type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'Fix the login bug', text_elements: [] }] }),
  item({ type: 'Reasoning', id: 'r1', summary_text: ['Looking at auth.ts'], raw_content: [] }),
  item({ type: 'CommandExecution', id: 'cmd1', command: ['bash', '-lc', 'bun test'], cwd: project, aggregated_output: '3 pass', exit_code: 0, status: 'completed' }),
  response({ type: 'custom_tool_call', name: 'exec', call_id: 'x1', input: 'tools.exec()' }),
  modelAgent('Fixed it in auth.ts.'),
  item({ type: 'AgentMessage', id: 'a1', phase: 'final_answer', content: [{ type: 'Text', text: 'Fixed it in auth.ts.' }] }),
  // A prompt this app sent after handing the chat to Codex: the handoff block is not the person's words.
  item({ type: 'UserMessage', id: 'u2', content: [{ type: 'text', text: '<agent-handoff>\nYou are taking over.\n</agent-handoff>' }, { type: 'text', text: 'Add a test for it' }] }),
  item({ type: 'McpToolCall', id: 'mcp1', server: 'docs', tool: 'search', arguments: { query: 'login' }, status: 'failed', error: { message: 'offline' } }),
  item({ type: 'AgentMessage', id: 'a2', phase: 'commentary', content: [{ type: 'Text', text: 'Writing the test.' }] }),
  item({ type: 'AgentMessage', id: 'a3', phase: 'final_answer', content: [{ type: 'Text', text: 'Added auth.test.ts.' }] }),
  // A write cut short: the rest of the thread still imports.
  '{"type":"event_msg","payload":{"type":"item_comp'
])
// Before items: prompts as events, tool calls as the model's own.
await rollout(CODEX.legacy, day(3), [
  meta(CODEX.legacy, other, { git: { branch: 'release' } }),
  event({ type: 'user_message', message: 'Write the changelog' }),
  modelUser('Write the changelog'),
  response({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Reading the log' }] }),
  response({ type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'git log --oneline'] }) }),
  response({ type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: 'abc Fix login', metadata: { exit_code: 0 } }) }),
  response({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: '*** Begin Patch\n*** Add File: CHANGELOG.md\n+# Changes\n*** End Patch' }),
  response({ type: 'custom_tool_call_output', call_id: 'c2', output: 'Done' }),
  event({ type: 'agent_message', message: 'The changelog is written.' }),
  modelAgent('The changelog is written.')
])
await rollout(CODEX.subagent, day(6), [
  meta(CODEX.subagent, project, { source: { subagent: { thread_spawn: {} } } }),
  item({ type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'Review this diff' }] })
])
await rollout(
  CODEX.compressed,
  day(2),
  [meta(CODEX.compressed, other), event({ type: 'user_message', message: 'An older thread' }), modelAgent('Still here.')],
  true
)
await rollout(CODEX.orphan, day(1), [meta(CODEX.orphan, gone), event({ type: 'user_message', message: 'Work in a folder since removed' }), modelAgent('Done there.')])
await rollout(CODEX.noMeta, day(7), [event({ type: 'user_message', message: 'No session_meta here' })])
await rollout(CODEX.garbage, day(7), ['not json at all', '{"half":'])
writeFileSync(
  join(codexHome, 'session_index.jsonl'),
  [
    { id: CODEX.legacy, thread_name: 'Changelog' },
    { id: CODEX.legacy, thread_name: 'Release notes' }
  ]
    .map((l) => `${JSON.stringify(l)}\n`)
    .join('') + 'not json\n'
)

// --- An ACP agent that lists and replays its sessions.
const ACP_ID = { inProject: 'ses_project', inOther: 'ses_other', third: 'ses_third' }
const acpSessions = join(root, 'acp-sessions.json')
const said = (sessionUpdate: 'user_message_chunk' | 'agent_message_chunk', text: string) => ({ sessionUpdate, content: { type: 'text', text } })
writeFileSync(
  acpSessions,
  JSON.stringify([
    {
      sessionId: ACP_ID.inProject,
      cwd: project,
      title: 'Speed up the build',
      updatedAt: day(8).toISOString(),
      replay: [
        { sessionUpdate: 'available_commands_update', availableCommands: [] },
        said('user_message_chunk', 'Speed up'),
        said('user_message_chunk', ' the build'),
        { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'bun run build', kind: 'execute', status: 'pending' },
        { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: { output: 'built in 2s' } },
        said('agent_message_chunk', 'It builds in 2s now.'),
        said('user_message_chunk', '<agent-handoff>\nYou are this chat’s agent again.\n</agent-handoff>'),
        said('user_message_chunk', 'Thanks')
      ]
    },
    { sessionId: ACP_ID.inOther, cwd: other, title: 'Tidy the docs', updatedAt: day(9).toISOString(), replay: [said('user_message_chunk', 'Tidy the docs')] },
    { sessionId: ACP_ID.third, cwd: project, title: '', updatedAt: null, replay: [] }
  ])
)

mock.module('./chat-agent-launch-settings.ts', () => ({
  ...launchSettings,
  chatAgentLaunch: async (agent: ChatAgentId) => ({ command: null, env: agent === 'codex' ? { CODEX_HOME: codexHome } : {} })
}))
const fixture = join(import.meta.dir, 'acp-fake-agent.fixture.ts')
mock.module('./chat-agent-launch-specs.ts', () => ({
  ...launchSpecs,
  resolveChatAgent: async (agent: ChatAgentId) =>
    agent === 'opencode'
      ? { status: 'ready', argv: [process.execPath, fixture], env: { FAKE_ACP_SESSIONS: acpSessions }, display: 'fake' }
      : agent === 'gemini'
        ? // Installed, but its server neither lists nor replays sessions.
          { status: 'ready', argv: [process.execPath, fixture], env: {}, display: 'fake' }
        : { status: 'missing', detail: 'not on this host' }
}))
const { registerSessionHandlers } = await import('./handlers/session-handlers.ts')
const { stopConversationReaders } = await import('./acp-agent-history.ts')

afterAll(() => {
  stopConversationReaders()
  rmSync(root, { recursive: true, force: true })
})

/** A daemon's sessions and workspaces, stood in for: nothing of the person's own state is read or written. */
function host() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>()
  const records: SessionRecord[] = []
  const transcripts = new Map<string, acp.SessionUpdate[]>()
  const workspaces = [
    { id: 'floating', path: root },
    { id: 'w-project', path: project },
    { id: 'w-other', path: other }
  ]
  const ctx = {
    handle: (method: string, run: (params: unknown) => Promise<unknown>) => handlers.set(method, run),
    sessions: {
      all: () => records,
      get: (id: string) => records.find((r) => r.id === id),
      create: (fields: Partial<SessionRecord>) => {
        const record = {
          id: `s${records.length + 1}`,
          title: 'New chat',
          status: 'idle',
          createdAt: 0,
          turnStartedAt: null,
          claudeSessionId: null,
          options: { ...DEFAULT_SESSION_OPTIONS },
          ...fields
        } as SessionRecord
        records.push(record)
        return record
      },
      replaceTranscript: async (id: string, updates: acp.SessionUpdate[]) => void transcripts.set(id, updates)
    },
    workspaces: {
      snapshot: async () => ({ workspaces }),
      workspaceForFolder: async (path: string) => {
        const existing = workspaces.find((w) => w.id !== 'floating' && w.path.toLowerCase() === path.toLowerCase())
        if (existing) return existing
        if (!existsSync(path)) throw new Error(`No folder at ${path}`)
        const added = { id: `w-added-${workspaces.length}`, path }
        workspaces.push(added)
        return added
      }
    },
    workspaceRoot: (id: string) => {
      const found = workspaces.find((w) => w.id === id)
      if (!found) throw new Error(`Unknown workspace ${id}`)
      return found.path
    }
  } as unknown as HandlerContext
  registerSessionHandlers(ctx)
  const call = <T>(method: string, params: unknown) => handlers.get(method)?.(params) as Promise<T>
  return {
    records,
    transcripts,
    workspaces,
    history: (params: object = {}) => call<PastConversation[]>(HARNESS_METHODS.sessionHistory, params),
    resume: (params: object) => call<SessionInfo>(HARNESS_METHODS.sessionResume, params)
  }
}

const shape = (updates: acp.SessionUpdate[] | undefined) =>
  (updates ?? []).map((u) => {
    if (u.sessionUpdate === 'user_message_chunk' || u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk') {
      return `${u.sessionUpdate.split('_')[0]}: ${u.content.type === 'text' ? u.content.text : u.content.type}`
    }
    if (u.sessionUpdate === 'tool_call') return `call ${u.toolCallId} [${u.kind}] ${u.title}`
    if (u.sessionUpdate === 'tool_call_update') {
      const text = u.content?.flatMap((c) => (c.type === 'content' && c.content.type === 'text' ? [c.content.text] : [])).join('')
      return `result ${u.toolCallId} ${u.status}${text ? `: ${text}` : ''}`
    }
    return u.sessionUpdate === 'notice' ? `notice: ${u.title}` : u.sessionUpdate
  })

test('a folder’s conversations are listed per agent, newest first, without what is no thread of the person’s', async () => {
  const h = host()
  const listed = await h.history({ workspaceId: 'w-project', agents: ['claude', 'codex', 'opencode', 'gemini', 'goose'] })
  expect(listed.map((c) => [c.agent, c.conversationId, c.title])).toEqual([
    ['opencode', ACP_ID.inProject, 'Speed up the build'],
    ['claude', CLAUDE_ID, 'Rename the settings page'],
    // The subagent's thread, the file without a session_meta and the unreadable one are left out.
    ['codex', CODEX.modern, 'Fix the login bug'],
    ['opencode', ACP_ID.third, 'Untitled']
  ])
  const codex = listed.find((c) => c.agent === 'codex')
  expect(codex).toMatchObject({ cwd: project, gitBranch: 'main', workspaceId: 'w-project', openSessionId: null, lastModified: day(4).getTime() })
  // Windows that predate other agents' conversations read the id under this name.
  expect(codex?.claudeSessionId).toBe(CODEX.modern)
}, 30_000)

test('without a workspace every folder’s are listed, each with the workspace its folder belongs to', async () => {
  const h = host()
  const listed = await h.history({ agents: ['codex'] })
  expect(listed.map((c) => [c.conversationId, c.title, c.workspaceId, c.gitBranch])).toEqual([
    [CODEX.modern, 'Fix the login bug', 'w-project', 'main'],
    // Named by the newest entry of Codex's own thread names.
    [CODEX.legacy, 'Release notes', 'w-other', 'release'],
    [CODEX.compressed, 'An older thread', 'w-other', 'main'],
    [CODEX.orphan, 'Work in a folder since removed', null, 'main']
  ])
  expect((await h.history({ agents: ['opencode'] })).map((c) => [c.conversationId, c.workspaceId])).toEqual([
    [ACP_ID.inOther, 'w-other'],
    [ACP_ID.inProject, 'w-project'],
    [ACP_ID.third, 'w-project']
  ])
}, 30_000)

test('a window that names no agents gets Claude’s conversations and resumes one by its old parameter', async () => {
  const h = host()
  const listed = await h.history({ workspaceId: 'w-project' })
  expect(listed.map((c) => [c.agent, c.claudeSessionId])).toEqual([['claude', CLAUDE_ID]])
  const info = await h.resume({ workspaceId: 'w-project', claudeSessionId: CLAUDE_ID })
  expect(info).toMatchObject({ workspaceId: 'w-project', cwd: project, title: 'Rename the settings page' })
  expect(info.agent).toBeUndefined()
  // None of the daemon's own fields reach the window.
  expect(info).not.toHaveProperty('claudeSessionId')
  expect(info).not.toHaveProperty('importedFrom')
  expect(h.records[0]).toMatchObject({ claudeSessionId: CLAUDE_ID, importedFrom: { agent: 'claude', conversationId: CLAUDE_ID } })
  expect(h.records[0]?.handoffContext ?? null).toBeNull()
  expect(shape(h.transcripts.get(info.id))).toEqual([
    'user: Rename the settings page',
    'agent: Renamed it to Preferences.',
    "notice: Imported from Claude. The next message continues Claude's own conversation."
  ])
})

test('a Codex thread imported into its own folder reopens natively, with its transcript', async () => {
  const h = host()
  const info = await h.resume({ agent: 'codex', conversationId: CODEX.modern })
  expect(info).toMatchObject({ workspaceId: 'w-project', cwd: project, title: 'Fix the login bug', agent: 'codex', lastActivityAt: day(4).getTime() })
  expect(info.agentState).toEqual({ phase: 'ready', error: null, options: [], commands: [] })
  const record = h.records[0]
  // codex-acp takes the thread id as its session id: the next turn resumes it.
  expect(record?.agentSessionIds).toEqual({ codex: CODEX.modern })
  expect(record?.claudeSessionId).toBeNull()
  expect(record?.handoffContext ?? null).toBeNull()
  expect(shape(h.transcripts.get(info.id))).toEqual([
    'user: Fix the login bug',
    'agent: Looking at auth.ts',
    'call cmd1 [execute] bun test',
    'result cmd1 completed: 3 pass',
    'agent: Fixed it in auth.ts.',
    'user: Add a test for it',
    'call mcp1 [other] docs: search',
    'result mcp1 failed',
    'agent: Writing the test.',
    'agent: \n\nAdded auth.test.ts.',
    "notice: Imported from Codex. The next message continues Codex's own conversation."
  ])
})

test('an older Codex rollout imports its prompts once, with the commands and edits of its tool calls', async () => {
  const h = host()
  const info = await h.resume({ agent: 'codex', conversationId: CODEX.legacy })
  expect(info).toMatchObject({ workspaceId: 'w-other', title: 'Release notes' })
  const transcript = h.transcripts.get(info.id) ?? []
  expect(shape(transcript).slice(0, -1)).toEqual([
    'user: Write the changelog',
    'agent: Reading the log',
    'call c1 [execute] git log --oneline',
    'result c1 completed: abc Fix login',
    'call c2 [edit] Edit CHANGELOG.md',
    'result c2 completed: Done',
    'agent: The changelog is written.'
  ])
  expect(transcript.find((u) => u.sessionUpdate === 'tool_call' && u.toolCallId === 'c2')).toMatchObject({ locations: [{ path: 'CHANGELOG.md' }] })
  // A compressed rollout reads the same.
  const older = await h.resume({ agent: 'codex', conversationId: CODEX.compressed })
  expect(shape(h.transcripts.get(older.id)).slice(0, -1)).toEqual(['user: An older thread', 'agent: Still here.'])
})

test('imported into another folder, the agent cannot reopen it: its first prompt carries the thread instead', async () => {
  const h = host()
  const info = await h.resume({ agent: 'codex', conversationId: CODEX.modern, workspaceId: 'w-other' })
  expect(info).toMatchObject({ workspaceId: 'w-other', cwd: other, agent: 'codex' })
  const record = h.records[0]
  expect(record?.agentSessionIds).toBeUndefined()
  expect(record?.handoffContext).toContain('<agent-handoff>')
  expect(record?.handoffContext).toContain(`imported an earlier conversation they had with you (Codex), in ${project},`)
  expect(record?.handoffContext).toContain(`Your working directory now: ${other}`)
  expect(record?.handoffContext).toContain('User:\nFix the login bug\n\nAssistant (Codex):\nFixed it in auth.ts.\n[Codex ran: bun test]')
  expect(shape(h.transcripts.get(info.id)).at(-1)).toBe(
    `notice: Imported from Codex (${project}). Codex starts a new conversation here and gets a selection of this thread, not its full context.`
  )
  // Claude files a conversation under its folder, so elsewhere it is handed over the same way.
  const claude = await h.resume({ conversationId: CLAUDE_ID, workspaceId: 'w-other' })
  expect(h.records[1]).toMatchObject({ claudeSessionId: null, workspaceId: 'w-other' })
  expect(h.records[1]?.handoffContext).toContain('User:\nRename the settings page\n\nAssistant (Claude):\nRenamed it to Preferences.')
  expect(claude.agent).toBeUndefined()
})

test('a conversation a thread already shows is marked, and importing it again returns that thread', async () => {
  const h = host()
  const native = await h.resume({ agent: 'codex', conversationId: CODEX.modern })
  const handedOver = await h.resume({ agent: 'codex', conversationId: CODEX.legacy, workspaceId: 'w-project' })
  // Two asks at once make one thread.
  const [once, twice] = await Promise.all([
    h.resume({ agent: 'codex', conversationId: CODEX.compressed }),
    h.resume({ agent: 'codex', conversationId: CODEX.compressed })
  ])
  expect(once.id).toBe(twice.id)
  expect((await h.resume({ agent: 'codex', conversationId: CODEX.modern })).id).toBe(native.id)
  expect((await h.resume({ agent: 'codex', conversationId: CODEX.legacy })).id).toBe(handedOver.id)
  expect(h.records).toHaveLength(3)
  const listed = await h.history({ agents: ['codex', 'claude'] })
  expect(listed.map((c) => [c.conversationId, c.openSessionId])).toEqual([
    [CLAUDE_ID, null],
    [CODEX.modern, native.id],
    // Known by what it was imported from: the agent's new conversation has another id.
    [CODEX.legacy, handedOver.id],
    [CODEX.compressed, once.id],
    [CODEX.orphan, null]
  ])
  // A Claude thread that runs on a conversation shows it, imported or not.
  h.records.push({ ...h.records[0], id: 'own', agent: undefined, agentSessionIds: undefined, importedFrom: undefined, claudeSessionId: CLAUDE_ID } as SessionRecord)
  expect((await h.history({ workspaceId: 'w-project' }))[0]?.openSessionId).toBe('own')
})

test('a folder no workspace has is added for the import; one that is gone needs a workspace named', async () => {
  const h = host()
  h.workspaces.splice(2, 1)
  const info = await h.resume({ agent: 'codex', conversationId: CODEX.legacy })
  expect(info.workspaceId).toBe('w-added-2')
  expect(h.records[0]?.agentSessionIds).toEqual({ codex: CODEX.legacy })
  await expect(h.resume({ agent: 'codex', conversationId: CODEX.orphan })).rejects.toThrow(`This conversation's folder is gone (${gone}): choose the workspace to import it into`)
  expect(h.records).toHaveLength(1)
  const placed = await h.resume({ agent: 'codex', conversationId: CODEX.orphan, workspaceId: 'w-project' })
  expect(placed.workspaceId).toBe('w-project')
  expect(h.records[1]?.handoffContext).toContain('Work in a folder since removed')
  await expect(h.resume({ agent: 'codex', conversationId: CODEX.subagent })).rejects.toThrow('Codex has no conversation')
  await expect(h.resume({ agent: 'codex', conversationId: CODEX.garbage })).rejects.toThrow('Codex has no conversation')
  await expect(h.resume({ agent: 'nobody', conversationId: 'x' })).rejects.toThrow('Unknown agent nobody')
})

test('an agent that lists and replays its sessions over ACP imports through its own server', async () => {
  const h = host()
  const info = await h.resume({ agent: 'opencode', conversationId: ACP_ID.inProject })
  expect(info).toMatchObject({ workspaceId: 'w-project', agent: 'opencode', title: 'Speed up the build', lastActivityAt: day(8).getTime() })
  expect(h.records[0]?.agentSessionIds).toEqual({ opencode: ACP_ID.inProject })
  const transcript = h.transcripts.get(info.id) ?? []
  expect(shape(transcript)).toEqual([
    'user: Speed up',
    'user:  the build',
    'call t1 [execute] bun run build',
    'result t1 completed: built in 2s',
    'agent: It builds in 2s now.',
    'user: Thanks',
    "notice: Imported from OpenCode. The next message continues OpenCode's own conversation."
  ])
  // The chunks of one prompt share an id; the next prompt gets its own.
  expect(transcript.flatMap((u) => (u.sessionUpdate === 'user_message_chunk' ? [u.messageId] : []))).toEqual(['imported-1', 'imported-1', 'imported-2'])
  expect((await h.history({ workspaceId: 'w-project', agents: ['opencode'] }))[0]?.openSessionId).toBe(info.id)
  // An agent whose server offers neither is not read, and one that is not installed is not started.
  expect(await h.history({ agents: ['gemini'] })).toEqual([])
  expect(await h.history({ agents: ['goose'] })).toEqual([])
  await expect(h.resume({ agent: 'gemini', conversationId: 'x' })).rejects.toThrow('Gemini has no conversation x')
}, 30_000)
