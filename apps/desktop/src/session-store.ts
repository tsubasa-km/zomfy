import { useSyncExternalStore } from 'react'
import type * as acp from '@agentclientprotocol/sdk'
import type {
  HarnessState,
  Project,
  SessionInfo,
  SessionStatus,
  ShellOption,
  TerminalInfo,
  Workspace
} from '@acp-harness/protocol'

export type { SessionStatus }

export type ChatImage = { mimeType: string; data: string }

export type ThreadItem =
  | { kind: 'user'; text: string; messageId?: string; images?: ChatImage[] }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'notice'; text: string; severity?: string }
  | { kind: 'compaction'; id: string; status: string }
  | {
      kind: 'tool'
      id: string
      title: string
      toolKind: acp.ToolKind
      status: string
      input: unknown
      output: string
      /** Claude's tool name (TodoWrite, Task, Edit…), when the daemon reports it. */
      toolName?: string
      /** The Task call whose subagent made this call. */
      parentId?: string | null
    }
  | {
      kind: 'permission'
      requestId: string
      title: string
      /** The tool call's input (an ExitPlanMode plan, a command). */
      input?: unknown
      options: acp.PermissionOption[]
      chosen: string | null
    }

/** 'local' is the desktop's own OS; 'wsl:<distro>' a daemon inside WSL; 'ssh:<alias or user@host[:port]>' one on an SSH host. */
export type HostId = string

/** The daemon owns status, title and timing; the window adds the transcript it has loaded. */
export interface Session extends Omit<SessionInfo, 'workspaceId'> {
  hostId: HostId
  workspaceId: string
  items: ThreadItem[]
  /** Whether this window has the transcript (created here, or replayed with session/load). */
  loaded: boolean
}

export type HostedTerminal = TerminalInfo & { hostId: HostId }
export type HostedProject = Project & { hostId: HostId }
export type HostedWorkspace = Workspace & { hostId: HostId }

/**
 * What is known about a remote host's daemon while this window cannot use it. Loss of contact is
 * never evidence the daemon died, so an unreachable host is `unverifiable`, not `exited`.
 */
export type DaemonVerdict = 'live' | 'unverifiable' | 'exited'

export type ConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected'; url: string }
  | { kind: 'offline'; reason: string; daemon?: DaemonVerdict }

export interface HostEntry {
  id: HostId
  label: string
  connection: ConnectionState
  harness: HarnessState | null
  /** Shells this host offers for new terminal tabs. */
  shells: ShellOption[]
  /** Something the last connect found that the user should know (a daemon that had exited). */
  notice?: string
}

/** File previews and diffs opened from the right sidebar; they live only in this window. */
export interface EditorTab {
  id: string
  workspaceId: string
  kind: 'file' | 'diff'
  path: string
  staged: boolean
  createdAt: number
  /** Line to reveal when the editor opens (search results). */
  line?: number
  /** Unsaved edits; the tab shows a dot and closing asks first. */
  dirty?: boolean
  /** Diff between two commits (history, compare with base) instead of the index or working tree. */
  compare?: { base: string; head: string; label: string }
}

/** Orca's "Workspace options": group by and sort by. */
export interface SidebarView {
  groupBy: 'project' | 'status'
  sortBy: 'created' | 'name' | 'recent' | 'manual'
}

export type RightSidebarTab = 'explorer' | 'search' | 'source-control' | 'ports'

export interface StoreState {
  hosts: Record<HostId, HostEntry>
  sessions: Session[]
  terminals: HostedTerminal[]
  activeWorkspaceId: string | null
  /** Each workspace remembers its own active tab, as Orca's tab groups do. */
  activeSessionByWorkspace: Record<string, string>
  floating: { open: boolean; maximized: boolean }
  editorTabs: EditorTab[]
  rightSidebar: { open: boolean; tab: RightSidebarTab }
  sidebarView: SidebarView
  /** WSL distros and SSH hosts to reconnect on startup. */
  rememberedHosts: HostId[]
  /** Sessions whose latest turn ended (or asked for approval) since the user last looked. */
  unread: Record<string, true>
  dashboardOpen: boolean
}

export type SessionTransition = { session: Session; from: SessionStatus; to: SessionStatus }
const transitionListeners = new Set<(t: SessionTransition) => void>()

/** Status changes the host reports, for notifications; fired after the store updates. */
export function onSessionTransition(listener: (t: SessionTransition) => void): () => void {
  transitionListeners.add(listener)
  return () => transitionListeners.delete(listener)
}

export const LOCAL_HOST: HostId = 'local'

const LAYOUT_KEY = 'acp-harness.layout.v1'
type SavedLayout = Pick<
  StoreState,
  | 'activeWorkspaceId'
  | 'activeSessionByWorkspace'
  | 'floating'
  | 'editorTabs'
  | 'rightSidebar'
  | 'rememberedHosts'
  | 'sidebarView'
>

function readLayout(): Partial<SavedLayout> {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}')
  } catch {
    return {}
  }
}

const saved = readLayout()
let state: StoreState = {
  hosts: {},
  sessions: [],
  terminals: [],
  activeWorkspaceId: saved.activeWorkspaceId ?? null,
  activeSessionByWorkspace: saved.activeSessionByWorkspace ?? {},
  floating: saved.floating ?? { open: false, maximized: false },
  editorTabs: saved.editorTabs ?? [],
  rightSidebar: saved.rightSidebar ?? { open: true, tab: 'explorer' },
  sidebarView: saved.sidebarView ?? { groupBy: 'project', sortBy: 'created' },
  rememberedHosts: saved.rememberedHosts ?? [],
  unread: {},
  dashboardOpen: false
}
const listeners = new Set<() => void>()

function set(next: StoreState): void {
  state = next
  for (const listener of listeners) listener()
  try {
    // Which workspace and tab were open is a per-window convenience, as in Orca's session restore.
    const layout: SavedLayout = {
      activeWorkspaceId: next.activeWorkspaceId,
      activeSessionByWorkspace: next.activeSessionByWorkspace,
      floating: next.floating,
      editorTabs: next.editorTabs,
      rightSidebar: next.rightSidebar,
      rememberedHosts: next.rememberedHosts,
      sidebarView: next.sidebarView
    }
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // Storage can be unavailable; the layout then starts fresh next time.
  }
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

// ── Hosts ────────────────────────────────────────────────────────────────

export function upsertHost(id: HostId, change: Partial<HostEntry>): void {
  const current: HostEntry = state.hosts[id] ?? {
    id,
    label: hostLabel(id),
    connection: { kind: 'connecting' },
    harness: null,
    shells: []
  }
  set({ ...state, hosts: { ...state.hosts, [id]: { ...current, ...change } } })
}

export function hostLabel(id: HostId): string {
  if (id === LOCAL_HOST) return 'This computer'
  return id.replace(/^wsl:/, 'WSL: ').replace(/^ssh:/, 'SSH: ')
}

/** Drops a disconnected host and everything of its from this window; reconnecting brings it back. */
export function forgetHost(id: HostId): void {
  if (id === LOCAL_HOST) return
  const { [id]: gone, ...hosts } = state.hosts
  if (!gone) return
  const workspaceIds = new Set(gone.harness?.workspaces.map((w) => w.id) ?? [])
  set({
    ...state,
    hosts,
    sessions: state.sessions.filter((s) => s.hostId !== id),
    terminals: state.terminals.filter((t) => t.hostId !== id),
    activeWorkspaceId: state.activeWorkspaceId && workspaceIds.has(state.activeWorkspaceId) ? null : state.activeWorkspaceId
  })
}

export function rememberHost(id: HostId, remember: boolean): void {
  const others = state.rememberedHosts.filter((h) => h !== id)
  set({ ...state, rememberedHosts: remember ? [...others, id] : others })
}

export function setHarnessState(hostId: HostId, harness: HarnessState): void {
  const hosts = { ...state.hosts, [hostId]: { ...state.hosts[hostId]!, label: harness.host.label, harness } }
  const known = new Set(Object.values(hosts).flatMap((h) => h.harness?.workspaces.map((w) => w.id) ?? []))
  const activeWorkspaceId =
    state.activeWorkspaceId && known.has(state.activeWorkspaceId) ? state.activeWorkspaceId : null
  // Tabs of a deleted workspace go with it; their daemon sessions are left idle.
  const sessions = state.sessions.filter((s) => s.hostId !== hostId || known.has(s.workspaceId))
  const editorTabs = state.editorTabs.filter((t) => known.has(t.workspaceId))
  set({ ...state, hosts, activeWorkspaceId, sessions, editorTabs })
}

/** Every project, tagged with the host whose daemon owns it. */
export function allProjects(hosts: StoreState['hosts'] = state.hosts): HostedProject[] {
  return Object.values(hosts).flatMap((h) => h.harness?.projects.map((p) => ({ ...p, hostId: h.id })) ?? [])
}

/** Every workspace; only this computer's floating workspace is used, so other hosts' are left out. */
export function allWorkspaces(s: Pick<StoreState, 'hosts'> = state): HostedWorkspace[] {
  return Object.values(s.hosts).flatMap(
    (h) =>
      h.harness?.workspaces
        .filter((w) => h.id === LOCAL_HOST || w.id !== h.harness?.floatingWorkspaceId)
        .map((w) => ({ ...w, hostId: h.id })) ?? []
  )
}

export function findWorkspace(workspaceId: string): HostedWorkspace | null {
  return allWorkspaces().find((w) => w.id === workspaceId) ?? null
}

export function floatingWorkspaceId(s: StoreState = state): string | null {
  return s.hosts[LOCAL_HOST]?.harness?.floatingWorkspaceId ?? null
}

export function isFloating(workspaceId: string): boolean {
  return floatingWorkspaceId() === workspaceId
}

export function selectWorkspace(workspaceId: string): void {
  set({ ...state, activeWorkspaceId: workspaceId })
}

// ── Sessions ─────────────────────────────────────────────────────────────

/** Applies one host's session list, keeping transcripts this window already has. */
export function mergeSessions(hostId: HostId, list: SessionInfo[]): void {
  const previous = new Map(state.sessions.map((s) => [s.id, s]))
  const sessions: Session[] = state.sessions.filter((s) => s.hostId !== hostId)
  const unread = { ...state.unread }
  const transitions: SessionTransition[] = []
  for (const info of list) {
    if (info.workspaceId === null) continue
    const old = previous.get(info.id)
    let items = old?.items ?? []
    // The turn just ended: draw Orca's settled status line under it.
    if (old?.loaded && old.turnStartedAt !== null && info.turnStartedAt === null) {
      const seconds = Math.max(1, Math.round((Date.now() - old.turnStartedAt) / 1000))
      items = [...items, { kind: 'notice', text: `Worked for ${seconds}s` }]
    }
    const session: Session = { ...info, hostId, workspaceId: info.workspaceId, items, loaded: old?.loaded ?? false }
    sessions.push(session)
    if (old && old.status !== info.status) {
      transitions.push({ session, from: old.status, to: info.status })
      // Orca marks a workspace unread when its agent finishes or asks, until the user looks.
      if (info.status === 'needs-you' || (old.status === 'working' && info.status !== 'working')) {
        unread[info.id] = true
      }
    }
  }
  set({ ...state, unread, sessions: sessions.sort((a, b) => a.createdAt - b.createdAt) })
  for (const t of transitions) for (const listener of transitionListeners) listener(t)
}

export function addSession(session: Session): void {
  set({
    ...state,
    sessions: [...state.sessions.filter((s) => s.id !== session.id), session],
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

export function updateSession(id: string, change: (s: Session) => Session): void {
  set({ ...state, sessions: state.sessions.map((s) => (s.id === id ? change(s) : s)) })
}

/** Streams arrive as many small chunks; merge them into the trailing item of the same kind. */
export function appendText(id: string, kind: 'user' | 'agent' | 'thought', text: string): void {
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

export function markLoaded(id: string): void {
  updateSession(id, (s) => ({ ...s, loaded: true, items: [] }))
}

/** Highest-priority status across a workspace's sessions, ordered like Orca's card overlay. */
export function workspaceStatus(sessions: Session[]): SessionStatus | 'none' {
  if (sessions.some((s) => s.status === 'needs-you')) return 'needs-you'
  if (sessions.some((s) => s.status === 'working')) return 'working'
  if (sessions.some((s) => s.status === 'error')) return 'error'
  return sessions.length > 0 ? 'idle' : 'none'
}

/** Focuses a session wherever it lives: its workspace in the main area, or the floating panel. */
export function selectSession(sessionId: string): void {
  const session = state.sessions.find((s) => s.id === sessionId)
  if (session) focusTab(session.workspaceId, sessionId)
  if (state.dashboardOpen) set({ ...state, dashboardOpen: false })
}

// ── Terminals ────────────────────────────────────────────────────────────

export function setTerminals(hostId: HostId, terminals: TerminalInfo[]): void {
  set({
    ...state,
    terminals: [
      ...state.terminals.filter((t) => t.hostId !== hostId),
      ...terminals.map((t) => ({ ...t, hostId }))
    ]
  })
}

/** Focuses a terminal tab, opening the floating panel when it lives there. */
export function selectTerminal(terminalId: string): void {
  const terminal = state.terminals.find((t) => t.id === terminalId)
  if (terminal) focusTab(terminal.workspaceId, terminalId)
}

// ── Editor tabs and layout ───────────────────────────────────────────────

/** Opens (or refocuses) a file preview or diff tab in its workspace. */
export function openEditorTab(tab: Omit<EditorTab, 'id' | 'createdAt'>): void {
  const existing = state.editorTabs.find(
    (t) =>
      t.workspaceId === tab.workspaceId &&
      t.kind === tab.kind &&
      t.path === tab.path &&
      t.staged === tab.staged &&
      t.compare?.base === tab.compare?.base &&
      t.compare?.head === tab.compare?.head
  )
  const target = existing
    ? { ...existing, ...(tab.line !== undefined ? { line: tab.line } : {}) }
    : { ...tab, id: `${tab.kind}:${crypto.randomUUID()}`, createdAt: Date.now() }
  set({
    ...state,
    editorTabs: existing ? state.editorTabs.map((t) => (t.id === target.id ? target : t)) : [...state.editorTabs, target],
    activeSessionByWorkspace: { ...state.activeSessionByWorkspace, [tab.workspaceId]: target.id }
  })
}

export function setEditorDirty(id: string, dirty: boolean): void {
  if (state.editorTabs.find((t) => t.id === id)?.dirty === dirty) return
  set({ ...state, editorTabs: state.editorTabs.map((t) => (t.id === id ? { ...t, dirty } : t)) })
}

export function closeEditorTab(id: string): void {
  set({ ...state, editorTabs: state.editorTabs.filter((t) => t.id !== id) })
}

/** Follows a file or folder the explorer renamed or moved, so its open tabs keep working. */
export function moveEditorTabs(workspaceId: string, from: string, to: string): void {
  const moved = (path: string) => path === from || path.startsWith(`${from}/`)
  if (!state.editorTabs.some((t) => t.workspaceId === workspaceId && moved(t.path))) return
  set({
    ...state,
    editorTabs: state.editorTabs.map((t) =>
      t.workspaceId === workspaceId && moved(t.path) ? { ...t, path: to + t.path.slice(from.length) } : t
    )
  })
}

export function selectTab(workspaceId: string, tabId: string): void {
  set({ ...state, activeSessionByWorkspace: { ...state.activeSessionByWorkspace, [workspaceId]: tabId } })
}

function focusTab(workspaceId: string, tabId: string): void {
  const activeSessionByWorkspace = { ...state.activeSessionByWorkspace, [workspaceId]: tabId }
  set(
    isFloating(workspaceId)
      ? { ...state, activeSessionByWorkspace, floating: { ...state.floating, open: true } }
      : { ...state, activeSessionByWorkspace, activeWorkspaceId: workspaceId }
  )
}

export function setRightSidebar(change: Partial<StoreState['rightSidebar']>): void {
  set({ ...state, rightSidebar: { ...state.rightSidebar, ...change } })
}

export function markSeen(sessionId: string): void {
  if (!state.unread[sessionId]) return
  const { [sessionId]: _seen, ...unread } = state.unread
  set({ ...state, unread })
}

export function setDashboardOpen(open: boolean): void {
  set({ ...state, dashboardOpen: open })
}

export function setSidebarView(change: Partial<SidebarView>): void {
  set({ ...state, sidebarView: { ...state.sidebarView, ...change } })
}

export function setFloating(change: Partial<StoreState['floating']>): void {
  set({ ...state, floating: { ...state.floating, ...change } })
}
