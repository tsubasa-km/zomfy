import type * as acp from '@agentclientprotocol/sdk'
import { isUntitledChat } from '@zomfy/protocol'
import { AcpAgentSession, emptyAgentState } from './acp-agent-session.ts'
import type { SessionRecord, SessionRegistry } from './session-registry.ts'
import { managerMcp } from './manager-mcp-server.ts'
import { mcpServersReady } from './mcp-ready.ts'
import { restartHandoff } from './agent-handoff.ts'

/**
 * A title the agent gave its conversation names the thread while the thread still has the name
 * Zomfy gave it (New thread, or its first prompt); a name the person gave stays.
 */
export function adoptAgentTitle(sessions: SessionRegistry, sessionId: string, raw: string): void {
  const session = sessions.get(sessionId)
  const title = raw.replace(/\s+/g, ' ').trim().slice(0, 100)
  if (!session || !title || title === session.title) return
  if (!isUntitledChat(session.title) && session.title !== session.autoTitle) return
  sessions.update(sessionId, { title, autoTitle: title })
}

/** The external agent processes running for this daemon, one per session. */
export class AcpAgentSessions {
  private readonly live = new Map<string, AcpAgentSession>()
  /** MCP servers a workflow step gives its session, on top of the harness's own. */
  private readonly stepServers = new Map<string, acp.McpServer[]>()

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly emit: (sessionId: string, update: acp.SessionUpdate) => Promise<void>,
    /** Variables the session's project adds when its agent starts (its GitHub/GitLab account). */
    private readonly envFor: (record: SessionRecord) => Promise<Record<string, string>> = async () => ({}),
    /** Zomfy's instructions for the chat, as Claude's system prompt has them (codex-and-acp-parity.md). */
    private readonly instructionsFor: (record: SessionRecord) => string | null = () => null
  ) {
    // However a session goes (closed, its workspace removed), its server goes with it.
    sessions.onChange((list) => {
      const ids = new Set(list.map((s) => s.id))
      for (const [id, agent] of this.live) {
        if (ids.has(id)) continue
        agent.dispose()
        this.live.delete(id)
        this.stepServers.delete(id)
      }
    })
  }

  /** Read when the agent's session opens, so a step sets them before its first turn. */
  setStepServers(sessionId: string, servers: acp.McpServer[]): void {
    if (servers.length > 0) this.stepServers.set(sessionId, servers)
    else this.stepServers.delete(sessionId)
  }

  /** Stops the session's server, as when its chat changes agent; the agent's own conversation stays reopenable. */
  release(sessionId: string): void {
    this.live.get(sessionId)?.dispose()
    this.live.delete(sessionId)
  }

  /** The session's agent connection, made on first use; null for Claude sessions. */
  for(record: SessionRecord): AcpAgentSession | null {
    // The chat changed agent since: the server running is the previous agent's.
    const running = this.live.get(record.id)
    if (running && running.agent !== record.agent) this.release(record.id)
    if (!record.agent || record.agent === 'claude') return null
    const existing = this.live.get(record.id)
    if (existing) return existing
    const agentId = record.agent
    // A server let go while it started still reports; by then the record is another agent's.
    const current = (): boolean => this.live.get(record.id) === agent
    const agent: AcpAgentSession = new AcpAgentSession(agentId, record.cwd, record.agentSessionIds?.[agentId] ?? null, record.agentState ?? emptyAgentState(), {
      emit: async (update) => {
        if (current()) await this.emit(record.id, update)
      },
      onState: (agentState) => {
        if (current()) this.sessions.update(record.id, { agentState })
      },
      onAgentSessionId: (agentSessionId) => {
        if (current()) this.sessions.update(record.id, { agentSessionIds: { ...record.agentSessionIds, [agentId]: agentSessionId } })
      },
      onCodexConnection: (codexThreadConnection) => {
        if (current()) this.sessions.update(record.id, { codexThreadConnection })
      },
      onConversationLost: async () => {
        const transcript = await this.sessions.transcript(record.id)
        // A turn waiting on this start has its prompt in the transcript already; it follows the handoff.
        let end = transcript.length
        if (record.turnStartedAt !== null) while (transcript[end - 1]?.sessionUpdate === 'user_message_chunk') end--
        const handoffContext = restartHandoff(transcript.slice(0, end), { agent: agentId, cwd: record.cwd })
        if (handoffContext && current()) this.sessions.update(record.id, { handoffContext })
      },
      mcpServers: (capabilities) => [...managerMcp.acpServers(record.id, capabilities), ...(this.stepServers.get(record.id) ?? [])],
      ready: () => mcpServersReady(this.stepServers.get(record.id) ?? []),
      env: () => this.envFor(record),
      permissionMode: () => {
        const mode = this.sessions.get(record.id)?.options.permissionMode ?? 'default'
        // A bot's chat is held to what it was given: a scheduled run read-only, or not at all.
        return { mode, strict: mode === 'plan' && this.sessions.get(record.id)?.origin === 'bot' }
      },
      onPermissionMode: (permissionMode) => {
        const now = this.sessions.get(record.id)
        if (current() && now) this.sessions.update(record.id, { options: { ...now.options, permissionMode } })
      },
      instructions: () => {
        const now = this.sessions.get(record.id)
        return now ? this.instructionsFor(now) : null
      },
      onTitle: (title) => {
        if (current()) adoptAgentTitle(this.sessions, record.id, title)
      }
    }, agentId === 'codex' ? record.codexThreadConnection ?? null : null)
    this.live.set(record.id, agent)
    return agent
  }
}
