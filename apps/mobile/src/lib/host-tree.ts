// The Host screen's tree: projects → workspaces → chats. Archived chats and the chats a workflow
// made for its steps are left out, as the desktop sidebar does.

import type { HarnessState, Project, SessionInfo, Workspace } from '@zomfy/protocol'

export interface WorkspaceNode {
  workspace: Workspace
  chats: SessionInfo[]
}

export interface ProjectNode {
  /** null for workspaces outside any project (the floating and scratch ones). */
  project: Project | null
  workspaces: WorkspaceNode[]
}

export const visibleChat = (s: SessionInfo): boolean => !s.archived && s.origin !== 'workflow' && s.workspaceId !== null

const recency = (s: SessionInfo): number => s.lastActivityAt ?? s.createdAt

export const projectLabel = (p: Project): string => p.displayName || p.name
export const workspaceLabel = (w: Workspace): string => w.displayName || w.branch || w.name

export function hostTree(state: HarnessState | null, sessions: readonly SessionInfo[]): ProjectNode[] {
  if (!state) return []
  const chatsBy = new Map<string, SessionInfo[]>()
  for (const s of sessions) {
    if (!visibleChat(s)) continue
    const list = chatsBy.get(s.workspaceId!) ?? []
    list.push(s)
    chatsBy.set(s.workspaceId!, list)
  }
  for (const list of chatsBy.values()) list.sort((a, b) => recency(b) - recency(a))
  const node = (w: Workspace): WorkspaceNode => ({ workspace: w, chats: chatsBy.get(w.id) ?? [] })
  const order = (a: { sortOrder?: number }, b: { sortOrder?: number }): number => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)

  const projects: ProjectNode[] = [...state.projects].sort(order).map((project) => ({
    project,
    workspaces: state.workspaces
      .filter((w) => w.projectId === project.id)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || order(a, b))
      .map(node)
      // A worktree with no chat to show is left out; the project's own checkout stays.
      .filter((n) => n.chats.length > 0 || n.workspace.isPrimary)
  }))
  // Workspaces with no project are listed only when they have chats to show.
  const loose = state.workspaces.filter((w) => w.projectId === null).map(node).filter((n) => n.chats.length > 0)
  if (loose.length > 0) projects.push({ project: null, workspaces: loose })
  return projects
}

/**
 * How many things on a host wait for the person: each ask this phone holds, plus each chat the host
 * marks as needing you that has no ask here (it was asked before this phone connected).
 */
export function needsYouCount(asks: readonly { sessionId: string }[], sessions: readonly SessionInfo[]): number {
  const asked = new Set(asks.map((a) => a.sessionId))
  return asks.length + sessions.filter((s) => visibleChat(s) && s.status === 'needs-you' && !asked.has(s.id)).length
}
