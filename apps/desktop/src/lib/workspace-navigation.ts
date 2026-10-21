import { allWorkspaces, floatingWorkspaceId, getState, selectSession, selectWorkspace, setDashboardOpen } from '@/session-store'
import { closeSettings } from '@/stores/app-overlay-store'

// Orca's worktree navigation (Cmd+1–9, Cmd+Shift+↑/↓): numbers follow the sidebar as the user
// sees it, so grouping, sorting, pins and collapsed groups all count.

/** Workspace ids in sidebar order; falls back to creation order when the sidebar is not rendered. */
export function visibleWorkspaceIds(): string[] {
  const seen = new Set<string>()
  for (const card of document.querySelectorAll<HTMLElement>('[data-workspace-id]')) {
    const id = card.dataset.workspaceId
    if (id && !card.closest('[data-floating-workspace]')) seen.add(id)
  }
  if (seen.size > 0) return [...seen]
  const floating = floatingWorkspaceId()
  return allWorkspaces()
    .filter((w) => w.id !== floating)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((w) => w.id)
}

function show(workspaceId: string): void {
  selectWorkspace(workspaceId)
  if (getState().dashboardOpen) setDashboardOpen(false)
  closeSettings()
}

/** Ctrl/Cmd+1–9; returns false when there is no workspace at that position. */
export function selectWorkspaceByIndex(index: number): boolean {
  const ids = visibleWorkspaceIds()
  const id = ids[index]
  if (!id) return false
  show(id)
  return true
}

/** Next/previous in sidebar order, wrapping at the ends like Orca. */
export function stepWorkspace(delta: 1 | -1): boolean {
  const ids = visibleWorkspaceIds()
  if (ids.length === 0) return false
  const current = ids.indexOf(getState().activeWorkspaceId ?? '')
  const next = current === -1 ? (delta === 1 ? 0 : ids.length - 1) : (current + delta + ids.length) % ids.length
  show(ids[next]!)
  return true
}

/** Cycles through agents waiting on the user, oldest tab first, starting after the one on screen. */
export function jumpToAgentNeedingYou(): boolean {
  const state = getState()
  const waiting = state.sessions.filter((s) => s.status === 'needs-you')
  if (waiting.length === 0) return false
  const onScreen = state.activeWorkspaceId ? state.activeSessionByWorkspace[state.activeWorkspaceId] : undefined
  const at = waiting.findIndex((s) => s.id === onScreen)
  selectSession(waiting[(at + 1) % waiting.length]!.id)
  closeSettings()
  return true
}

/** The workspace keyboard commands act on: the floating panel's while focus is inside it, else the main one. */
export function focusedWorkspaceId(): string | null {
  const floating = floatingWorkspaceId()
  if (floating && getState().floating.open && document.activeElement?.closest('[data-floating-workspace]')) return floating
  return getState().activeWorkspaceId
}
