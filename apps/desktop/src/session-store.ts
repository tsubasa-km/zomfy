import { useSyncExternalStore } from 'react'
import type * as acp from '@agentclientprotocol/sdk'
import type { HarnessState, Workspace } from '@acp-harness/protocol'

export type ThreadItem =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'notice'; text: string }
  | {
      kind: 'tool'
      id: string
      title: string
      toolKind: acp.ToolKind
      status: string
      input: unknown
      output: string
    }
  | {
      kind: 'permission'
      requestId: string
      title: string
      options: acp.PermissionOption[]
      chosen: string | null
    }

export type SessionStatus = 'idle' | 'working' | 'needs-you' | 'error'

export interface Session {
  id: string
  workspaceId: string
  cwd: string
  title: string
  status: SessionStatus
  items: ThreadItem[]
  /** Set while a turn runs, for the live "Working for Ns" line. */
  turnStartedAt: number | null
}

export type ConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected'; url: string }
  | { kind: 'offline'; reason: string }

export interface StoreState {
  connection: ConnectionState
  harness: HarnessState | null
  sessions: Session[]
  activeWorkspaceId: string | null
  /** Each workspace remembers its own active tab, as Orca's tab groups do. */
  activeSessionByWorkspace: Record<string, string>
  floating: { open: boolean; maximized: boolean }
}

let state: StoreState = {
  connection: { kind: 'connecting' },
  harness: null,
  sessions: [],
  activeWorkspaceId: null,
  activeSessionByWorkspace: {},
  floating: { open: false, maximized: false }
}
const listeners = new Set<() => void>()

function set(next: StoreState): void {
  state = next
  for (const listener of listeners) listener()
}

export function useStore<T>(select: (s: StoreState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => select(state)
  )
}

export function getState(): StoreState {
  return state
}

export function setConnection(connection: ConnectionState): void {
  set({ ...state, connection })
}

export function setHarnessState(harness: HarnessState): void {
  const known = new Set(harness.workspaces.map((w) => w.id))
  const activeWorkspaceId =
    state.activeWorkspaceId && known.has(state.activeWorkspaceId) ? state.activeWorkspaceId : null
  // Tabs of a deleted workspace go with it; their daemon sessions are left idle.
  const sessions = state.sessions.filter((s) => known.has(s.workspaceId))
  set({ ...state, harness, activeWorkspaceId, sessions })
}

export function findWorkspace(workspaceId: string): Workspace | null {
  return state.harness?.workspaces.find((w) => w.id === workspaceId) ?? null
}

export function isFloating(workspaceId: string): boolean {
  return state.harness?.floatingWorkspaceId === workspaceId
}

export function selectWorkspace(workspaceId: string): void {
  set({ ...state, activeWorkspaceId: workspaceId })
}

export function addSession(session: Session): void {
  set({
    ...state,
    sessions: [...state.sessions, session],
    activeSessionByWorkspace: { ...state.activeSessionByWorkspace, [session.workspaceId]: session.id }
  })
}

export function removeSession(sessionId: string): void {
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session) return
  const sessions = state.sessions.filter((s) => s.id !== sessionId)
  const activeSessionByWorkspace = { ...state.activeSessionByWorkspace }
  if (activeSessionByWorkspace[session.workspaceId] === sessionId) {
    const next = sessions.findLast((s) => s.workspaceId === session.workspaceId)
    if (next) activeSessionByWorkspace[session.workspaceId] = next.id
    else delete activeSessionByWorkspace[session.workspaceId]
  }
  set({ ...state, sessions, activeSessionByWorkspace })
}

/** Focuses a session wherever it lives: its workspace in the main area, or the floating panel. */
export function selectSession(sessionId: string): void {
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session) return
  const activeSessionByWorkspace = { ...state.activeSessionByWorkspace, [session.workspaceId]: sessionId }
  if (isFloating(session.workspaceId)) {
    set({ ...state, activeSessionByWorkspace, floating: { ...state.floating, open: true } })
  } else {
    set({ ...state, activeSessionByWorkspace, activeWorkspaceId: session.workspaceId })
  }
}

export function setFloating(change: Partial<StoreState['floating']>): void {
  set({ ...state, floating: { ...state.floating, ...change } })
}

export function updateSession(id: string, change: (s: Session) => Session): void {
  set({ ...state, sessions: state.sessions.map((s) => (s.id === id ? change(s) : s)) })
}

/** Streams arrive as many small chunks; merge them into the trailing item of the same kind. */
export function appendText(id: string, kind: 'agent' | 'thought', text: string): void {
  updateSession(id, (s) => {
    const last = s.items.at(-1)
    if (last?.kind === kind) {
      return { ...s, items: [...s.items.slice(0, -1), { kind, text: last.text + text }] }
    }
    return { ...s, items: [...s.items, { kind, text }] }
  })
}

export function upsertTool(
  id: string,
  toolId: string,
  patch: Partial<Extract<ThreadItem, { kind: 'tool' }>>
): void {
  updateSession(id, (s) => {
    const index = s.items.findIndex((item) => item.kind === 'tool' && item.id === toolId)
    if (index === -1) {
      const item: ThreadItem = {
        kind: 'tool',
        id: toolId,
        title: 'Tool',
        toolKind: 'other',
        status: 'pending',
        input: null,
        output: '',
        ...patch
      }
      return { ...s, items: [...s.items, item] }
    }
    const items = s.items.slice()
    const current = items[index]
    if (current?.kind === 'tool') items[index] = { ...current, ...patch }
    return { ...s, items }
  })
}

/** Highest-priority status across a workspace's sessions, ordered like Orca's card overlay. */
export function workspaceStatus(sessions: Session[]): SessionStatus | 'none' {
  if (sessions.some((s) => s.status === 'needs-you')) return 'needs-you'
  if (sessions.some((s) => s.status === 'working')) return 'working'
  if (sessions.some((s) => s.status === 'error')) return 'error'
  return sessions.length > 0 ? 'idle' : 'none'
}
