import * as acp from '@agentclientprotocol/sdk'
import { readFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'

// A scripted ACP agent for acp-agent-session.test.ts, run as its own process. The prompt's text
// picks the behaviour; like Codex, it refuses a prompt while another is running.
// With FAKE_ACP_SESSIONS (a JSON file of earlier conversations) it also lists them, a page of two
// at a time, and replays one on `session/load` (agent-conversations.test.ts).
// With FAKE_ACP_CODEX_MODES it offers codex-acp's `mode` and `collaboration_mode` options, resumes
// any conversation, and answers the prompts `state`, `cwd`, `title:<name>` and `mcp:<server>.<tool>`
// (harness-agent-external.scenario.ts).

interface Recorded extends acp.SessionInfo {
  replay: acp.SessionUpdate[]
}

const recorded: Recorded[] = process.env.FAKE_ACP_SESSIONS ? JSON.parse(readFileSync(process.env.FAKE_ACP_SESSIONS, 'utf8')) : []
const resumeTestThread = process.env.TEST_RESUME_CODEX_THREAD === '1'
const codexModes = process.env.FAKE_ACP_CODEX_MODES === '1'
/** Each conversation's folder and codex-acp options, as this process knows them. */
const conversations = new Map<string, { cwd: string; mode: string; collaboration: string }>()

function configOptions(id: string): acp.SessionConfigOption[] {
  const state = conversations.get(id) ?? { cwd: '', mode: 'agent', collaboration: 'default' }
  return [
    {
      id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: state.mode,
      options: ['read-only', 'workspace-write', 'agent', 'agent-full-access'].map((value) => ({ value, name: value }))
    },
    {
      id: 'collaboration_mode', name: 'Collaboration mode', category: 'collaboration_mode', type: 'select', currentValue: state.collaboration,
      options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }]
    }
  ]
}

function open(id: string, cwd: string): acp.NewSessionResponse {
  // Like codex-acp, a conversation opened in a new process starts in Auto review.
  conversations.set(id, { cwd, mode: 'agent', collaboration: 'default' })
  return { sessionId: id, ...(codexModes ? { configOptions: configOptions(id) } : {}) }
}
const PAGE = 2
const cancels = new Map<string, () => void>()
let running = false

function say(ctx: { client: acp.AgentContext }, sessionId: string, text: string): Promise<void> {
  return ctx.client.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }
  })
}

acp
  .agent({ name: 'fake' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: resumeTestThread || codexModes
      ? { sessionCapabilities: { resume: {} } }
      : recorded.length > 0 ? { loadSession: true, sessionCapabilities: { list: {} } } : {}
  }))
  .onRequest('session/new', (ctx) => open(crypto.randomUUID(), ctx.params.cwd))
  .onRequest('session/resume', (ctx) => {
    if (codexModes) {
      const { sessionId: _id, ...rest } = open(ctx.params.sessionId, ctx.params.cwd)
      return rest
    }
    if (!resumeTestThread || ctx.params.sessionId !== 'direct-thread') throw new Error('No matching thread')
    return {}
  })
  .onRequest('session/set_config_option', (ctx) => {
    const state = conversations.get(ctx.params.sessionId)
    if (!state) throw new Error('Unknown session')
    if (ctx.params.configId === 'mode') state.mode = String(ctx.params.value)
    else if (ctx.params.configId === 'collaboration_mode') state.collaboration = String(ctx.params.value)
    else throw new Error(`Unknown option ${ctx.params.configId}`)
    return { configOptions: configOptions(ctx.params.sessionId) }
  })
  .onRequest('session/list', (ctx) => {
    // Like some agents, it answers with every folder's sessions whatever `cwd` asks for.
    const start = Number(ctx.params.cursor ?? 0)
    const sessions = recorded.slice(start, start + PAGE).map(({ replay: _replay, ...info }) => info)
    return { sessions, ...(start + PAGE < recorded.length ? { nextCursor: String(start + PAGE) } : {}) }
  })
  .onRequest('session/load', async (ctx) => {
    const session = recorded.find((s) => s.sessionId === ctx.params.sessionId)
    if (!session) throw new Error(`no session ${ctx.params.sessionId}`)
    for (const update of session.replay) {
      await ctx.client.notify(acp.methods.client.session.update, { sessionId: session.sessionId, update })
    }
    return {}
  })
  .onNotification('session/cancel', (ctx) => cancels.get(ctx.params.sessionId)?.())
  .onRequest('session/prompt', async (ctx) => {
    if (running) throw new Error('busy: a prompt is already running')
    running = true
    const { sessionId } = ctx.params
    const texts = ctx.params.prompt.flatMap((b) => (b.type === 'text' ? [b.text] : []))
    // The command is the typed text, after any instructions Zomfy put ahead of it; `echo` says it all.
    const all = texts.join('')
    const text = texts.at(-1) ?? ''
    const cancelled = new Promise<void>((resolve) => cancels.set(sessionId, resolve))
    try {
      if (text === 'wait') {
        await cancelled
        await say(ctx, sessionId, 'wound down')
        return { stopReason: 'cancelled' }
      }
      if (text === 'ignore') {
        await new Promise(() => undefined)
      }
      if (text === 'ask') {
        const answer = await ctx.client.request(acp.methods.client.session.requestPermission, {
          sessionId,
          toolCall: { toolCallId: 't1', title: 'rm -rf' },
          options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }]
        })
        await say(ctx, sessionId, `asked: ${answer.outcome.outcome}`)
        return { stopReason: answer.outcome.outcome === 'cancelled' ? 'cancelled' : 'end_turn' }
      }
      const state = conversations.get(sessionId)
      if (codexModes && state && text === 'state') {
        await say(ctx, sessionId, `mode=${state.mode} collaboration=${state.collaboration}`)
        return { stopReason: 'end_turn' }
      }
      if (codexModes && state && text === 'cwd') {
        await say(ctx, sessionId, `session=${sessionId} cwd=${state.cwd}`)
        return { stopReason: 'end_turn' }
      }
      if (text.startsWith('title:')) {
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId,
          update: { sessionUpdate: 'session_info_update', title: text.slice('title:'.length) }
        })
        await say(ctx, sessionId, 'titled')
        return { stopReason: 'end_turn' }
      }
      if (text.startsWith('mcp:')) {
        // codex-acp: the MCP call shows first, then its approval names it by id alone.
        const toolCallId = crypto.randomUUID()
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId,
          update: { sessionUpdate: 'tool_call', toolCallId, title: `mcp.${text.slice(4)}`, kind: 'other', status: 'pending' }
        })
        const answer = await ctx.client.request(acp.methods.client.session.requestPermission, {
          sessionId,
          toolCall: { toolCallId, kind: 'execute', status: 'pending' },
          _meta: { is_mcp_tool_approval: true },
          options: [
            { optionId: 'approved', name: 'Allow', kind: 'allow_once' },
            { optionId: 'cancel', name: 'Cancel', kind: 'reject_once' }
          ]
        })
        await say(ctx, sessionId, `mcp: ${answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'}`)
        return { stopReason: 'end_turn' }
      }
      await say(ctx, sessionId, `echo: ${all}`)
      return { stopReason: 'end_turn' }
    } finally {
      running = false
      cancels.delete(sessionId)
    }
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>))
