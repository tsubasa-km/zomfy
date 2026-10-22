import type { Project, ProjectGroup, Workspace } from '@acp-harness/protocol'
import type { HostId, Session, SidebarView } from '@/session-store'
import type { SidebarFilters } from '@/stores/sidebar-store'

// Which workspaces the sidebar shows and in what order: Orca's compute-visible-worktrees and
// worktree-manual-order, reduced to what the harness tracks.

export interface FilterContext {
  hostId: HostId
  sessions: Session[]
  unread: Record<string, true>
  projectName: (projectId: string | null) => string
}

export function projectLabel(project: Pick<Project, 'name' | 'displayName'>): string {
  return project.displayName ?? project.name
}

export function workspaceLabel(workspace: Pick<Workspace, 'name' | 'displayName'>): string {
  return workspace.displayName ?? workspace.name
}

function matchesQuery(workspace: Workspace, query: string, projectName: string): boolean {
  const haystack = [workspace.displayName, workspace.name, workspace.branch, workspace.comment, projectName]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}

export function workspaceMatches(workspace: Workspace, filters: SidebarFilters, ctx: FilterContext): boolean {
  if (filters.hostIds.length > 0 && !filters.hostIds.includes(ctx.hostId)) return false
  if (filters.projectIds.length > 0 && !filters.projectIds.includes(workspace.projectId ?? '')) return false
  if (filters.hidePrimary && workspace.isPrimary) return false
  if (filters.statuses.length > 0 && !filters.statuses.includes(workspace.status ?? 'none')) return false
  const own = ctx.sessions.filter((s) => s.workspaceId === workspace.id)
  if (filters.agentRunning && !own.some((s) => s.status === 'working')) return false
  if (filters.needsYou && !own.some((s) => s.status === 'needs-you')) return false
  if (filters.unread && !workspace.unread && !own.some((s) => ctx.unread[s.id])) return false
  if (filters.query.trim() && !matchesQuery(workspace, filters.query, ctx.projectName(workspace.projectId))) {
    return false
  }
  return true
}

/** Pinned first (Orca's pin), then the project's own checkout, then the chosen order. */
export function sortWorkspaces<T extends Workspace>(list: T[], view: SidebarView, sessions: Session[]): T[] {
  const lastActivity = (w: Workspace) =>
    Math.max(w.createdAt, ...sessions.filter((s) => s.workspaceId === w.id).map((s) => s.turnStartedAt ?? s.createdAt))
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    if (view.sortBy === 'manual') return manualRank(a) - manualRank(b) || a.createdAt - b.createdAt
    if (view.groupBy === 'project' && a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    if (view.sortBy === 'name') return workspaceLabel(a).localeCompare(workspaceLabel(b))
    if (view.sortBy === 'recent') return lastActivity(b) - lastActivity(a)
    return a.createdAt - b.createdAt
  })
}

/** Never-dragged workspaces keep creation order after the arranged ones; the primary leads. */
function manualRank(w: Workspace): number {
  return w.sortOrder ?? (w.isPrimary ? -1 : 1e6)
}

export function sortProjects<T extends Project>(projects: T[]): T[] {
  return projects
    .map((project, index) => ({ project, index }))
    .sort((a, b) => (a.project.sortOrder ?? a.index) - (b.project.sortOrder ?? b.index) || a.index - b.index)
    .map((x) => x.project)
}

export function sortGroups(groups: ProjectGroup[]): ProjectGroup[] {
  return [...groups].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

export interface WorkspaceNode {
  workspace: Workspace
  children: WorkspaceNode[]
}

/** Children nest under a visible parent (Orca's lineage); an orphan whose parent is hidden stays top level. */
export function buildWorkspaceTree(sorted: Workspace[]): WorkspaceNode[] {
  const visible = new Set(sorted.map((w) => w.id))
  const nodes = new Map(sorted.map((w) => [w.id, { workspace: w, children: [] as WorkspaceNode[] }]))
  const roots: WorkspaceNode[] = []
  for (const w of sorted) {
    const node = nodes.get(w.id)!
    const parent = w.parentWorkspaceId && visible.has(w.parentWorkspaceId) ? nodes.get(w.parentWorkspaceId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export function flattenTree(nodes: WorkspaceNode[]): Workspace[] {
  return nodes.flatMap((n) => [n.workspace, ...flattenTree(n.children)])
}

/** Moves `dragged` before or after `target` in `ids`; returns null when nothing changes. */
export function reorderIds(ids: string[], dragged: string, target: string, position: 'before' | 'after'): string[] | null {
  if (dragged === target) return null
  const rest = ids.filter((id) => id !== dragged)
  const at = rest.indexOf(target)
  if (at === -1) return null
  rest.splice(position === 'before' ? at : at + 1, 0, dragged)
  return rest.join() === ids.join() ? null : rest
}
