// Projects that span hosts: one project made of host projects (a repository or folder on each
// host), so its workspaces can live in WSL, on an SSH host and on this computer at once. Each host
// still owns its own projects and worktrees; this computer's daemon keeps only which belong together.

export interface ProjectMemberRef {
  hostId: string
  projectId: string
}

export interface ProjectLink {
  id: string
  /** The first member is the project's main one: its name, and where its lead agent runs. */
  members: ProjectMemberRef[]
}

export const PROJECT_LINK_METHODS = {
  projectLinksList: '_harness/projectLinks/list',
  projectLinkSave: '_harness/projectLinks/save',
  projectLinkRemove: '_harness/projectLinks/remove'
} as const

export const PROJECT_LINK_NOTIFICATIONS = {
  /** Every client of this computer's daemon hears the full list after any change. */
  projectLinksChanged: '_harness/projectLinks/changed'
} as const

export interface ProjectLinkRequests {
  [PROJECT_LINK_METHODS.projectLinksList]: { params: Record<string, never>; result: ProjectLink[] }
  [PROJECT_LINK_METHODS.projectLinkSave]: { params: { link: ProjectLink }; result: ProjectLink[] }
  [PROJECT_LINK_METHODS.projectLinkRemove]: { params: { id: string }; result: ProjectLink[] }
}
