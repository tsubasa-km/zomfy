// Harness extension methods carried over the ACP connection. ACP reserves `_`-prefixed method
// names for extensions, so these never collide with protocol methods.

export type ProjectKind = 'git' | 'folder'

export interface Project {
  id: string
  name: string
  /** Absolute path on the daemon's host. */
  path: string
  kind: ProjectKind
}

export interface Workspace {
  id: string
  /** null for the floating workspace, which belongs to no project. */
  projectId: string | null
  name: string
  path: string
  /** Checked-out branch for git worktrees; null for folders and detached HEADs. */
  branch: string | null
  /** The project's own checkout (or folder), as opposed to a worktree the harness created. */
  isPrimary: boolean
  createdAt: number
}

export interface HarnessState {
  projects: Project[]
  workspaces: Workspace[]
  floatingWorkspaceId: string
}

export interface CreateWorkspaceParams {
  projectId: string
  name: string
  /** Ref the new branch starts from; defaults to the project's current HEAD branch. */
  baseRef?: string
}

export interface RemoveWorkspaceParams {
  workspaceId: string
  /** Also delete the workspace's branch when it is fully merged or the user forces it. */
  deleteBranch?: boolean
  force?: boolean
}

export interface BranchList {
  current: string | null
  branches: string[]
}

export const HARNESS_METHODS = {
  stateGet: '_harness/state/get',
  projectAdd: '_harness/projects/add',
  projectRemove: '_harness/projects/remove',
  workspaceCreate: '_harness/workspaces/create',
  workspaceRemove: '_harness/workspaces/remove',
  branchesList: '_harness/git/branches',
  floatingCwdSet: '_harness/floating/cwd/set'
} as const

export const HARNESS_NOTIFICATIONS = {
  stateChanged: '_harness/state/changed'
} as const

export interface HarnessRequests {
  [HARNESS_METHODS.stateGet]: { params: Record<string, never>; result: HarnessState }
  [HARNESS_METHODS.projectAdd]: { params: { path: string }; result: Project }
  [HARNESS_METHODS.projectRemove]: { params: { projectId: string }; result: Record<string, never> }
  [HARNESS_METHODS.workspaceCreate]: { params: CreateWorkspaceParams; result: Workspace }
  [HARNESS_METHODS.workspaceRemove]: { params: RemoveWorkspaceParams; result: Record<string, never> }
  [HARNESS_METHODS.branchesList]: { params: { projectId: string }; result: BranchList }
  [HARNESS_METHODS.floatingCwdSet]: { params: { path: string }; result: Workspace }
}

export type HarnessMethod = keyof HarnessRequests
