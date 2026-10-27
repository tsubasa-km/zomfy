import { allProjects, allWorkspaces, type HostedProject, type Session } from '@/session-store'

/** The host project a session's workspace belongs to. */
export function projectOfSession(session: Session): HostedProject | null {
  const workspace = allWorkspaces().find((w) => w.id === session.workspaceId && w.hostId === session.hostId)
  return allProjects().find((p) => p.id === workspace?.projectId && p.hostId === session.hostId) ?? null
}
