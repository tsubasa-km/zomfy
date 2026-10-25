import type * as acp from '@agentclientprotocol/sdk'
import { AcpAgentSession, emptyAgentState } from './acp-agent-session.ts'
import type { SessionRecord, SessionRegistry } from './session-registry.ts'
import { managerMcp } from './manager-mcp-server.ts'
import { mcpServersReady } from './mcp-ready.ts'

/** The ACP servers running for this daemon's external-agent sessions, one per session. */
export class AcpAgentSessions {
  private readonly live = new Map<string, AcpAgentSession>()
  /** MCP servers a workflow step gives its session, on top of the harness's own. */
  private readonly stepServers = new Map<string, acp.McpServer[]>()

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly emit: (sessionId: string, update: acp.SessionUpdate) => Promise<void>
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

  /** The session's agent connection, made on first use; null for Claude sessions. */
  for(record: SessionRecord): AcpAgentSession | null {
    if (!record.agent || record.agent === 'claude') return null
    let agent = this.live.get(record.id)
    if (!agent) {
      agent = new AcpAgentSession(record.agent, record.cwd, record.agentSessionId ?? null, record.agentState ?? emptyAgentState(), {
        emit: (update) => this.emit(record.id, update),
        onState: (agentState) => this.sessions.update(record.id, { agentState }),
        onAgentSessionId: (agentSessionId) => this.sessions.update(record.id, { agentSessionId }),
        mcpServers: (capabilities) => [...managerMcp.acpServers(record.id, capabilities), ...(this.stepServers.get(record.id) ?? [])],
        ready: () => mcpServersReady(this.stepServers.get(record.id) ?? [])
      })
      this.live.set(record.id, agent)
    }
    return agent
  }
}
