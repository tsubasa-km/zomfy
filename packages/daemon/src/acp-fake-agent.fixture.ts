import * as acp from '@agentclientprotocol/sdk'
import { readFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'

// A scripted ACP agent for acp-agent-session.test.ts, run as its own process. The prompt's text
// picks the behaviour; like Codex, it refuses a prompt while another is running.
// With FAKE_ACP_SESSIONS (a JSON file of earlier conversations) it also lists them, a page of two
// at a time, and replays one on `session/load` (agent-conversations.test.ts).

interface Recorded extends acp.SessionInfo {
  replay: acp.SessionUpdate[]
}

const recorded: Recorded[] = process.env.FAKE_ACP_SESSIONS ? JSON.parse(readFileSync(process.env.FAKE_ACP_SESSIONS, 'utf8')) : []
const resumeTestThread = process.env.TEST_RESUME_CODEX_THREAD === '1'
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
    agentCapabilities: resumeTestThread
      ? { sessionCapabilities: { resume: {} } }
      : recorded.length > 0 ? { loadSession: true, sessionCapabilities: { list: {} } } : {}
  }))
  .onRequest('session/new', () => ({ sessionId: crypto.randomUUID() }))
  .onRequest('session/resume', (ctx) => {
    if (!resumeTestThread || ctx.params.sessionId !== 'direct-thread') throw new Error('No matching thread')
    return {}
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
    const text = ctx.params.prompt.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
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
      await say(ctx, sessionId, `echo: ${text}`)
      return { stopReason: 'end_turn' }
    } finally {
      running = false
      cancels.delete(sessionId)
    }
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>))
