/** The execution host owns session status; clients only present it (Orca's agent-status rule). */
export type SessionStatus = 'idle' | 'working' | 'needs-you' | 'error'

export interface SessionInfo {
  id: string
  /** null for sessions an outside ACP client opened by cwd alone. */
  workspaceId: string | null
  cwd: string
  title: string
  status: SessionStatus
  createdAt: number
  /** Set while a turn runs. */
  turnStartedAt: number | null
}

export const SESSION_METHODS = {
  sessionsList: '_harness/sessions/list',
  sessionCreate: '_harness/sessions/create',
  sessionClose: '_harness/sessions/close'
} as const

export interface SessionRequests {
  [SESSION_METHODS.sessionsList]: { params: Record<string, never>; result: SessionInfo[] }
  [SESSION_METHODS.sessionCreate]: { params: { workspaceId: string }; result: SessionInfo }
  [SESSION_METHODS.sessionClose]: { params: { sessionId: string }; result: Record<string, never> }
}
