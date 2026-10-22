import type * as acp from '@agentclientprotocol/sdk'
import { AcpAgentSession, emptyAgentState } from './acp-agent-session.ts'
import type { SessionRecord, SessionRegistry } from './session-registry.ts'

/** The ACP servers running for this daemon's external-agent sessions, one per session. */
export class AcpAgentSessions {
  private readonly live = new Map<string, AcpAgentSession>()

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
      }
    })
  }

  /** The session's agent connection, made on first use; null for Claude sessions. */
  for(record: SessionRecord): AcpAgentSession | null {
    if (!record.agent || record.agent === 'claude') return null
    let agent = this.live.get(record.id)
    if (!agent) {
      agent = new AcpAgentSession(record.agent, record.cwd, record.agentSessionId ?? null, record.agentState ?? emptyAgentState(), {
        emit: (update) => this.emit(record.id, update),
        onState: (agentState) => this.sessions.update(record.id, { agentState }),
        onAgentSessionId: (agentSessionId) => this.sessions.update(record.id, { agentSessionId })
      })
      this.live.set(record.id, agent)
    }
    return agent
  }
}
