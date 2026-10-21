import { useSyncExternalStore } from 'react'
import type { WorkspaceStatusId, WorkspaceSummary } from '@acp-harness/protocol'
import type { HostId } from '@/session-store'

// Sidebar-only view state (Orca's workspace filters, card layout, selection, board). The daemon owns
// workspaces; this keeps how one window looks at them.

export type StatusFilterId = WorkspaceStatusId | 'none'

export interface SidebarFilters {
  /** Free text over name, branch, notes and project (Orca's board search). */
  query: string
  statuses: StatusFilterId[]
  agentRunning: boolean
  needsYou: boolean
  unread: boolean
  /** Orca's "Hide default branch": the project's own checkout. */
  hidePrimary: boolean
  hostIds: HostId[]
  projectIds: string[]
}

export type CardLayout = 'detailed' | 'compact'

/** Orca's "Show properties" rows. */
export type CardProperty = 'branch' | 'changes' | 'sync' | 'agents' | 'notes'

export const CARD_PROPERTIES: { id: CardProperty; label: string }[] = [
  { id: 'branch', label: 'Branch' },
  { id: 'changes', label: 'Changes (+/-)' },
  { id: 'sync', label: 'Ahead / behind' },
  { id: 'agents', label: 'Agent activity' },
  { id: 'notes', label: 'Notes' }
]

export const EMPTY_FILTERS: SidebarFilters = {
  query: '',
  statuses: [],
  agentRunning: false,
  needsYou: false,
  unread: false,
  hidePrimary: false,
  hostIds: [],
  projectIds: []
}

export interface DropTarget {
  id: string
  position: 'before' | 'after' | 'inside'
}

interface SidebarState {
  filters: SidebarFilters
  cardLayout: CardLayout
  cardProperties: CardProperty[]
  collapsedProjects: string[]
  /** Multi-selected workspace ids (Ctrl/Shift click). */
  selection: string[]
  selectionAnchor: string | null
  boardOpen: boolean
  summaries: Record<string, WorkspaceSummary>
  dropTarget: DropTarget | null
}

const KEY = 'acp-harness.sidebar.v1'
type Saved = Pick<SidebarState, 'filters' | 'cardLayout' | 'cardProperties' | 'collapsedProjects'>

function readSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

const saved = readSaved()
let state: SidebarState = {
  // The search text is per visit; the filters persist, as Orca's do.
  filters: { ...EMPTY_FILTERS, ...saved.filters, query: '' },
  cardLayout: saved.cardLayout ?? 'detailed',
  cardProperties: saved.cardProperties ?? CARD_PROPERTIES.map((p) => p.id),
  collapsedProjects: saved.collapsedProjects ?? [],
  selection: [],
  selectionAnchor: null,
  boardOpen: false,
  summaries: {},
  dropTarget: null
}
const listeners = new Set<() => void>()

function set(change: Partial<SidebarState>): void {
  state = { ...state, ...change }
  for (const listener of listeners) listener()
  try {
    const persisted: Saved = {
      filters: state.filters,
      cardLayout: state.cardLayout,
      cardProperties: state.cardProperties,
      collapsedProjects: state.collapsedProjects
    }
    localStorage.setItem(KEY, JSON.stringify(persisted))
  } catch {
    // Storage can be unavailable; the view then starts from defaults.
  }
}

export function useSidebarStore<T>(select: (s: SidebarState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => select(state)
  )
}

export function getSidebarState(): SidebarState {
  return state
}

export function setFilters(change: Partial<SidebarFilters>): void {
  set({ filters: { ...state.filters, ...change } })
}

export function resetFilters(): void {
  set({ filters: { ...EMPTY_FILTERS, query: state.filters.query } })
}

/** Filters other than the search text, for the trigger's count badge. */
export function activeFilterCount(f: SidebarFilters): number {
  return (
    (f.statuses.length > 0 ? 1 : 0) +
    (f.agentRunning ? 1 : 0) +
    (f.needsYou ? 1 : 0) +
    (f.unread ? 1 : 0) +
    (f.hidePrimary ? 1 : 0) +
    (f.hostIds.length > 0 ? 1 : 0) +
    (f.projectIds.length > 0 ? 1 : 0)
  )
}

export function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function setCardLayout(cardLayout: CardLayout): void {
  set({ cardLayout })
}

export function toggleCardProperty(property: CardProperty): void {
  set({ cardProperties: toggleIn(state.cardProperties, property) })
}

export function toggleProjectCollapsed(projectId: string): void {
  set({ collapsedProjects: toggleIn(state.collapsedProjects, projectId) })
}

export function setBoardOpen(boardOpen: boolean): void {
  set({ boardOpen })
}

export function setSummaries(hostWorkspaceIds: string[], list: WorkspaceSummary[]): void {
  const summaries = { ...state.summaries }
  for (const id of hostWorkspaceIds) delete summaries[id]
  for (const s of list) summaries[s.workspaceId] = s
  set({ summaries })
}

export function setDropTarget(dropTarget: DropTarget | null): void {
  const current = state.dropTarget
  if (current?.id === dropTarget?.id && current?.position === dropTarget?.position) return
  set({ dropTarget })
}

// ── Selection ────────────────────────────────────────────────────────────

/** Orca's list gestures: Ctrl/Cmd toggles one card, Shift extends from the anchor. */
export function selectWithGesture(
  id: string,
  gesture: { toggle: boolean; range: boolean },
  activeId: string | null,
  /** Cards in the order they are drawn, for Shift ranges. */
  order: string[]
): void {
  if (gesture.range) {
    const anchor = state.selectionAnchor ?? activeId ?? id
    const from = order.indexOf(anchor)
    const to = order.indexOf(id)
    if (from !== -1 && to !== -1) {
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
      set({ selection: gesture.toggle ? [...new Set([...state.selection, ...range])] : range, selectionAnchor: anchor })
      return
    }
  }
  // The first Ctrl-click also keeps the workspace that is open, so two clicks make a pair.
  const base = state.selection.length === 0 && activeId && activeId !== id ? [activeId] : state.selection
  set({ selection: toggleIn(base, id), selectionAnchor: id })
}

export function clearSelection(): void {
  if (state.selection.length === 0 && state.selectionAnchor === null) return
  set({ selection: [], selectionAnchor: null })
}

export function setSelection(selection: string[]): void {
  set({ selection })
}

/** A plain click: one workspace, and the anchor for a later Shift-click. */
export function selectSingle(id: string): void {
  set({ selection: [], selectionAnchor: id })
}
