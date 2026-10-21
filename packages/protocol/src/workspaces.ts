export type ProjectKind = 'git' | 'folder'

/** Scripts Orca keeps under `scripts:` in orca.yaml; the project's own copy runs after the file's. */
export interface ProjectHooks {
  /** Runs in a terminal after a worktree is created. */
  setup?: string
  /** Runs before a worktree is deleted. */
  archive?: string
}

export interface Project {
  id: string
  name: string
  /** Absolute path on the daemon's host. */
  path: string
  kind: ProjectKind
  /** Shown instead of `name` when set (Orca's project settings). */
  displayName?: string
  /** Ref new workspaces start from unless the composer picks another. */
  defaultBaseRef?: string
  /** Folder new worktrees go under; defaults to the harness workspace root. */
  worktreeRoot?: string
  hooks?: ProjectHooks
  groupId?: string
  /** Manual order (Orca's "Project order: Manual"); lower first. */
  sortOrder?: number
}

/** Orca's project groups: a named folder of projects in the sidebar. */
export interface ProjectGroup {
  id: string
  name: string
  collapsed?: boolean
  sortOrder?: number
}

export type ProjectPatch = Partial<
  Pick<Project, 'displayName' | 'defaultBaseRef' | 'worktreeRoot' | 'hooks' | 'groupId'>
>

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
  /** The workspace this one was created from (Orca's lineage); shown nested under it. */
  parentWorkspaceId?: string
  /** Manual order within its group; lower first. */
  sortOrder?: number
}

/** Orca's default workspace board statuses. */
export const WORKSPACE_STATUSES = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'completed', label: 'Done' }
] as const

export type WorkspaceStatusId = (typeof WORKSPACE_STATUSES)[number]['id']

export type WorkspacePatch = Partial<
  Pick<Workspace, 'displayName' | 'comment' | 'pinned' | 'status' | 'unread' | 'parentWorkspaceId'>
>

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
  /** Optional so an older daemon's state still parses. */
  projectGroups?: ProjectGroup[]
}

export interface CreateWorkspaceParams {
  projectId: string
  name: string
  /** Ref the new branch starts from; defaults to the project's base ref. */
  baseRef?: string
  /** Branch to create instead of `<user>/<name>` (Orca's branch name override). */
  branchName?: string
  /** Check out this existing local branch instead of creating one (Orca's "start from branch"). */
  existingBranch?: string
  parentWorkspaceId?: string
  comment?: string
  /** Run the project's setup script in a terminal; defaults to true. */
  runSetup?: boolean
}

export interface CreateWorkspaceResult extends Workspace {
  /** Terminal running the setup script, when one started. */
  setupTerminalId?: string
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
  /** Remote-tracking branches (`origin/main`); optional for older daemons. */
  remoteBranches?: string[]
  /** What an unspecified base resolves to. */
  defaultBaseRef?: string
  /** Local branches already checked out in a worktree, which cannot be checked out again. */
  checkedOut?: string[]
}

/** Card badges: uncommitted line counts and position against upstream (or the base ref). */
export interface WorkspaceSummary {
  workspaceId: string
  additions: number
  deletions: number
  changedFiles: number
  ahead: number | null
  behind: number | null
  /** What ahead/behind count against. */
  compareRef: string | null
  /** Every commit is already in the base ref and nothing is uncommitted: safe to clean up. */
  merged: boolean
}

/** What deleting a workspace would throw away (Orca's DeleteWorktreeDirtyChangeHint). */
export interface WorkspaceInspection {
  modifiedFiles: number
  untrackedFiles: number
  /** Commits not on upstream or the base ref; null when unknown. */
  unpushedCommits: number | null
}

export interface ProjectHookInfo {
  /** orca.yaml or acp-harness.yaml at the project root, when present. */
  file: string | null
  fileHooks: ProjectHooks
  localHooks: ProjectHooks
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
  orcaProjects: '_harness/import/orca',
  projectUpdate: '_harness/projects/update',
  projectsReorder: '_harness/projects/reorder',
  projectHooks: '_harness/projects/hooks',
  projectClone: '_harness/projects/clone',
  projectCreateRepo: '_harness/projects/create-repo',
  projectGroupCreate: '_harness/project-groups/create',
  projectGroupUpdate: '_harness/project-groups/update',
  projectGroupRemove: '_harness/project-groups/remove',
  workspacesReorder: '_harness/workspaces/reorder',
  workspaceSummaries: '_harness/workspaces/summaries',
  workspaceInspect: '_harness/workspaces/inspect'
} as const

export interface WorkspaceRequests {
  [WORKSPACE_METHODS.stateGet]: { params: Record<string, never>; result: HarnessState }
  [WORKSPACE_METHODS.projectAdd]: { params: { path: string }; result: Project }
  [WORKSPACE_METHODS.projectRemove]: { params: { projectId: string }; result: Record<string, never> }
  [WORKSPACE_METHODS.workspaceCreate]: { params: CreateWorkspaceParams; result: CreateWorkspaceResult }
  [WORKSPACE_METHODS.workspaceRemove]: { params: RemoveWorkspaceParams; result: Record<string, never> }
  [WORKSPACE_METHODS.workspaceUpdate]: { params: { workspaceId: string; patch: WorkspacePatch }; result: Workspace }
  [WORKSPACE_METHODS.branchesList]: { params: { projectId: string }; result: BranchList }
  [WORKSPACE_METHODS.floatingCwdSet]: { params: { path: string }; result: Workspace }
  [WORKSPACE_METHODS.orcaProjects]: { params: Record<string, never>; result: OrcaProject[] }
  [WORKSPACE_METHODS.projectUpdate]: { params: { projectId: string; patch: ProjectPatch }; result: Project }
  [WORKSPACE_METHODS.projectsReorder]: { params: { projectIds: string[] }; result: Record<string, never> }
  [WORKSPACE_METHODS.projectHooks]: { params: { projectId: string }; result: ProjectHookInfo }
  [WORKSPACE_METHODS.projectClone]: {
    params: { url: string; parentPath: string; name?: string }
    result: Project
  }
  [WORKSPACE_METHODS.projectCreateRepo]: { params: { parentPath: string; name: string }; result: Project }
  [WORKSPACE_METHODS.projectGroupCreate]: {
    params: { name: string; projectIds?: string[] }
    result: ProjectGroup
  }
  [WORKSPACE_METHODS.projectGroupUpdate]: {
    params: { groupId: string; patch: Partial<Pick<ProjectGroup, 'name' | 'collapsed'>> }
    result: ProjectGroup
  }
  [WORKSPACE_METHODS.projectGroupRemove]: { params: { groupId: string }; result: Record<string, never> }
  /** Sets `sortOrder` by position; ids not listed keep theirs. */
  [WORKSPACE_METHODS.workspacesReorder]: { params: { workspaceIds: string[] }; result: Record<string, never> }
  [WORKSPACE_METHODS.workspaceSummaries]: { params: Record<string, never>; result: WorkspaceSummary[] }
  [WORKSPACE_METHODS.workspaceInspect]: { params: { workspaceId: string }; result: WorkspaceInspection }
}
