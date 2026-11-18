import { homedir } from 'node:os'
import * as acp from '@agentclientprotocol/sdk'
import { chatAgentLabel, type ChatAgentId } from '@acp-harness/protocol'
import { stdinWriter, withOutputText } from './acp-agent-session.ts'
import { HANDOFF_OPEN } from './agent-handoff.ts'
import { resolveChatAgent } from './chat-agent-launch-specs.ts'
import { killTree, trackChild } from './process-tree.ts'
import { hostPath } from './tui-agent-detection.ts'
import { log } from './log.ts'
import type { AgentConversation } from './agent-conversations.ts'

// An external agent's own conversations, asked of its ACP server: `session/list` names them and
// `session/load` replays one as the updates a live turn sends, which is what a thread's transcript
// holds. Only an agent that offers both is read this way (OpenCode does); the daemon knows nothing
// of where such an agent keeps its files.

type ExternalAgent = Exclude<ChatAgentId, 'claude'>

/** A server started to read conversations stays this long for the next listing or import. */
const IDLE_EXIT_MS = 30_000
const START_TIMEOUT_MS = 20_000
const LIST_TIMEOUT_MS = 20_000
const LOAD_TIMEOUT_MS = 90_000
/** Pages of `session/list` followed before the listing is cut. */
const MAX_PAGES = 20

/** The updates that make up a conversation; a replay also reports the session's modes, commands and usage. */
const TRANSCRIPT_UPDATES = new Set<acp.SessionUpdate['sessionUpdate']>([
  'user_message_chunk',
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan'
])

interface Reader {
  proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  conn: acp.ClientConnection
  capabilities: acp.AgentCapabilities
  /** Replays under way, by the agent's session id. */
  replays: Map<string, acp.SessionUpdate[]>
  idle: ReturnType<typeof setTimeout> | null
  uses: number
}

const readers = new Map<ExternalAgent, Promise<Reader | null>>()

/** The agent's conversations, newest first: none when it is not installed or cannot list and replay them. */
export async function listAcpConversations(
  agent: ExternalAgent,
  cwd: string | null,
  /** Told whether a conversation's folder is `cwd`: an agent may answer with other folders' too. */
  inFolder: ((cwd: string) => boolean) | null,
  limit: number
): Promise<AgentConversation[]> {
  return withReader(agent, async (reader) => {
    if (!reader || !canImport(reader.capabilities)) return []
    const listed: AgentConversation[] = []
    let cursor: string | null | undefined
    for (let page = 0; page < MAX_PAGES && listed.length < limit; page++) {
      const response = await timed(
        reader.conn.agent.request(acp.methods.agent.session.list, { ...(cwd ? { cwd } : {}), ...(cursor ? { cursor } : {}) }),
        LIST_TIMEOUT_MS,
        `${chatAgentLabel(agent)} did not list its conversations`
      )
      for (const session of response.sessions) {
        if (inFolder && !(session.cwd && inFolder(session.cwd))) continue
        listed.push({
          conversationId: session.sessionId,
          title: session.title?.replace(/\s+/g, ' ').trim() || 'Untitled',
          lastModified: (session.updatedAt && Date.parse(session.updatedAt)) || 0,
          cwd: session.cwd || null,
          gitBranch: null
        })
      }
      cursor = response.nextCursor
      if (!cursor) break
    }
    return listed.sort((a, b) => b.lastModified - a.lastModified).slice(0, limit)
  })
}

/** One of the agent's conversations as the updates its server replays for it. */
export async function acpConversationUpdates(agent: ExternalAgent, conversationId: string, cwd: string): Promise<acp.SessionUpdate[]> {
  return withReader(agent, async (reader) => {
    const label = chatAgentLabel(agent)
    if (!reader) throw new Error(`${label} is not installed on this host`)
    if (!canImport(reader.capabilities)) throw new Error(`${label} cannot replay its conversations`)
    const replayed: acp.SessionUpdate[] = []
    reader.replays.set(conversationId, replayed)
    try {
      await timed(
        reader.conn.agent.request(acp.methods.agent.session.load, { sessionId: conversationId, cwd, mcpServers: [] }),
        LOAD_TIMEOUT_MS,
        `${label} did not replay the conversation`
      )
    } finally {
      reader.replays.delete(conversationId)
    }
    return transcriptOf(replayed)
  })
}

/** What a replay holds of the conversation itself, each prompt given an id as the daemon gives its own. */
export function transcriptOf(replayed: acp.SessionUpdate[]): acp.SessionUpdate[] {
  const updates: acp.SessionUpdate[] = []
  let prompts = 0
  let inPrompt = false
  for (const update of replayed) {
    if (!TRANSCRIPT_UPDATES.has(update.sessionUpdate)) continue
    if (update.sessionUpdate === 'user_message_chunk') {
      // A chat this app handed to the agent opened with the conversation so far, which the person never typed.
      if (update.content.type === 'text' && update.content.text.trimStart().startsWith(HANDOFF_OPEN)) continue
      // Chunks of one prompt arrive together; an agent that does not id its messages gets ours.
      if (!inPrompt) prompts++
      updates.push(update.messageId ? update : { ...update, messageId: `imported-${prompts}` })
    } else updates.push(update.sessionUpdate === 'tool_call_update' ? withOutputText(update) : update)
    inPrompt = update.sessionUpdate === 'user_message_chunk'
  }
  return updates
}

function canImport(capabilities: acp.AgentCapabilities): boolean {
  return !!capabilities.sessionCapabilities?.list && !!capabilities.loadSession
}

/** Runs `use` with the agent's reading server, started on first use and stopped once left idle. */
async function withReader<T>(agent: ExternalAgent, use: (reader: Reader | null) => Promise<T>): Promise<T> {
  let starting = readers.get(agent)
  if (!starting) {
    starting = start(agent)
    readers.set(agent, starting)
    void starting.then(
      (reader) => {
        if (!reader && readers.get(agent) === starting) readers.delete(agent)
      },
      () => {
        if (readers.get(agent) === starting) readers.delete(agent)
      }
    )
  }
  const reader = await starting
  if (!reader) return use(null)
  if (reader.idle) clearTimeout(reader.idle)
  reader.idle = null
  reader.uses++
  try {
    return await use(reader)
  } finally {
    reader.uses--
    if (reader.uses === 0) {
      reader.idle = setTimeout(() => {
        if (readers.get(agent) === starting) readers.delete(agent)
        stop(reader)
      }, IDLE_EXIT_MS)
    }
  }
}

async function start(agent: ExternalAgent): Promise<Reader | null> {
  const resolved = await resolveChatAgent(agent)
  if (resolved.status !== 'ready') return null
  const proc = Bun.spawn(resolved.argv, {
    cwd: homedir(),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PATH: await hostPath(), ...resolved.env },
    windowsHide: true,
    detached: process.platform !== 'win32'
  })
  trackChild(proc)
  void new Response(proc.stderr).text().catch(() => undefined)
  const replays = new Map<string, acp.SessionUpdate[]>()
  const conn = acp
    .client({ name: 'acp-harness' })
    // Reading a conversation asks for nothing; an agent that asks anyway is told no.
    .onRequest('session/request_permission', (): acp.RequestPermissionResponse => ({ outcome: { outcome: 'cancelled' } }))
    .onNotification('session/update', (ctx) => {
      replays.get(ctx.params.sessionId)?.push(ctx.params.update)
    })
    .connect(acp.ndJsonStream(stdinWriter(proc.stdin), proc.stdout))
  void proc.exited.then(() => {
    conn.close()
    void readers.get(agent)?.then((reader) => {
      if (reader?.proc === proc) readers.delete(agent)
    })
  })
  try {
    const init = await timed(
      conn.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'acp-harness', title: 'Zomfy', version: '0.0.1' }
      }),
      START_TIMEOUT_MS,
      `${chatAgentLabel(agent)} did not start`
    )
    return { proc, conn, capabilities: init.agentCapabilities ?? {}, replays, idle: null, uses: 0 }
  } catch (error) {
    log(`reading ${agent}'s conversations failed to start: ${String(error)}`)
    conn.close()
    killTree(proc)
    throw error
  }
}

function stop(reader: Reader): void {
  reader.conn.close()
  void Promise.resolve(reader.proc.stdin.end()).catch(() => undefined)
  const timer = setTimeout(() => killTree(reader.proc), 3_000)
  void reader.proc.exited.finally(() => clearTimeout(timer))
}

/** Stops every reading server now (tests, and a daemon that is shutting down has them tracked anyway). */
export function stopConversationReaders(): void {
  for (const [agent, starting] of readers) {
    readers.delete(agent)
    void starting.then((reader) => {
      if (!reader) return
      if (reader.idle) clearTimeout(reader.idle)
      stop(reader)
    })
  }
}

async function timed<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} within ${Math.round(ms / 1000)}s`)), ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
