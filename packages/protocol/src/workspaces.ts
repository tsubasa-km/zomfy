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
  /** Shown instead of `name` when set (Orca's "Update" dialog). */
  displayName?: string
  comment?: string
  pinned?: boolean
  status?: WorkspaceStatusId
  /** Marked unread by hand; finished agent turns are tracked by the client. */
  unread?: boolean
}

/** Orca's default workspace board statuses. */
export const WORKSPACE_STATUSES = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
] as const

export type WorkspaceStatusId = (typeof WORKSPACE_STATUSES)[number]['id']

export type WorkspacePatch = Partial<Pick<Workspace, 'displayName' | 'comment' | 'pinned' | 'status' | 'unread'>>

/** The machine (or WSL distro, SSH host) a daemon runs on. */
export interface HostInfo {
  /** 'local' for the desktop's own OS, 'wsl:<distro>', later 'ssh:<name>'. */
  id: string
  label: string
  platform: string
}

export interface HarnessState {
  host: HostInfo
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

/** A project listed in Orca's active profile, offered for import. */
export interface OrcaProject {
  name: string
  /** As Orca stored it: a local path or a \\wsl.localhost\<distro>\... UNC path. */
  path: string
  kind: ProjectKind
}

export const WORKSPACE_METHODS = {
  stateGet: '_harness/state/get',
  projectAdd: '_harness/projects/add',
  projectRemove: '_harness/projects/remove',
  workspaceCreate: '_harness/workspaces/create',
  workspaceRemove: '_harness/workspaces/remove',
  workspaceUpdate: '_harness/workspaces/update',
  branchesList: '_harness/git/branches',
  floatingCwdSet: '_harness/floating/cwd/set',
  orcaProjects: '_harness/import/orca'
} as const

export interface WorkspaceRequests {
  [WORKSPACE_METHODS.stateGet]: { params: Record<string, never>; result: HarnessState }
  [WORKSPACE_METHODS.projectAdd]: { params: { path: string }; result: Project }
  [WORKSPACE_METHODS.projectRemove]: { params: { projectId: string }; result: Record<string, never> }
  [WORKSPACE_METHODS.workspaceCreate]: { params: CreateWorkspaceParams; result: Workspace }
  [WORKSPACE_METHODS.workspaceRemove]: { params: RemoveWorkspaceParams; result: Record<string, never> }
  [WORKSPACE_METHODS.workspaceUpdate]: { params: { workspaceId: string; patch: WorkspacePatch }; result: Workspace }
  [WORKSPACE_METHODS.branchesList]: { params: { projectId: string }; result: BranchList }
  [WORKSPACE_METHODS.floatingCwdSet]: { params: { path: string }; result: Workspace }
  [WORKSPACE_METHODS.orcaProjects]: { params: Record<string, never>; result: OrcaProject[] }
}
