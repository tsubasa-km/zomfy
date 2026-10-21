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

/** The execution host owns session status; clients only present it (Orca's agent-status rule). */
export type SessionStatus = 'idle' | 'working' | 'needs-you' | 'error'

export interface SessionInfo {
  id: string
  /** null for sessions an outside ACP client opened by cwd alone. */
  workspaceId: string | null
  cwd: string
  title: string
  status: SessionStatus
  createdAt: number
  /** Set while a turn runs. */
  turnStartedAt: number | null
}

export interface TerminalInfo {
  id: string
  workspaceId: string
  title: string
  /** Shell program the terminal was started with. */
  shell: string
  cwd: string
  createdAt: number
  /** null while the shell runs. */
  exitCode: number | null
}

export interface ShellOption {
  id: string
  label: string
}

export interface FileEntry {
  name: string
  /** Workspace-relative, '/'-separated. */
  path: string
  kind: 'file' | 'dir' | 'symlink'
}

export interface FileContent {
  path: string
  content: string
  binary: boolean
  truncated: boolean
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitChange {
  /** Workspace-relative, '/'-separated. */
  path: string
  oldPath?: string
  status: GitFileStatus
  additions: number | null
  deletions: number | null
}

export interface GitStatusResult {
  isRepo: boolean
  branch: string | null
  staged: GitChange[]
  unstaged: GitChange[]
}

export interface FileDiff {
  path: string
  staged: boolean
  /** Unified diff text; empty when there is no textual change. */
  patch: string
  binary: boolean
}

export const HARNESS_METHODS = {
  stateGet: '_harness/state/get',
  projectAdd: '_harness/projects/add',
  projectRemove: '_harness/projects/remove',
  workspaceCreate: '_harness/workspaces/create',
  workspaceRemove: '_harness/workspaces/remove',
  branchesList: '_harness/git/branches',
  floatingCwdSet: '_harness/floating/cwd/set',
  sessionsList: '_harness/sessions/list',
  sessionCreate: '_harness/sessions/create',
  sessionClose: '_harness/sessions/close',
  shellsList: '_harness/terminals/shells',
  terminalsList: '_harness/terminals/list',
  terminalCreate: '_harness/terminals/create',
  terminalAttach: '_harness/terminals/attach',
  terminalInput: '_harness/terminals/input',
  terminalResize: '_harness/terminals/resize',
  terminalClose: '_harness/terminals/close',
  fsList: '_harness/fs/list',
  fsRead: '_harness/fs/read',
  gitStatus: '_harness/git/status',
  gitDiff: '_harness/git/diff',
  gitStage: '_harness/git/stage',
  gitUnstage: '_harness/git/unstage',
  gitCommit: '_harness/git/commit'
} as const

export const HARNESS_NOTIFICATIONS = {
  stateChanged: '_harness/state/changed',
  sessionsChanged: '_harness/sessions/changed',
  terminalsChanged: '_harness/terminals/changed',
  terminalOutput: '_harness/terminals/output'
} as const

export interface TerminalOutput {
  terminalId: string
  data: string
}

export interface HarnessRequests {
  [HARNESS_METHODS.stateGet]: { params: Record<string, never>; result: HarnessState }
  [HARNESS_METHODS.projectAdd]: { params: { path: string }; result: Project }
  [HARNESS_METHODS.projectRemove]: { params: { projectId: string }; result: Record<string, never> }
  [HARNESS_METHODS.workspaceCreate]: { params: CreateWorkspaceParams; result: Workspace }
  [HARNESS_METHODS.workspaceRemove]: { params: RemoveWorkspaceParams; result: Record<string, never> }
  [HARNESS_METHODS.branchesList]: { params: { projectId: string }; result: BranchList }
  [HARNESS_METHODS.floatingCwdSet]: { params: { path: string }; result: Workspace }
  [HARNESS_METHODS.sessionsList]: { params: Record<string, never>; result: SessionInfo[] }
  [HARNESS_METHODS.sessionCreate]: { params: { workspaceId: string }; result: SessionInfo }
  [HARNESS_METHODS.sessionClose]: { params: { sessionId: string }; result: Record<string, never> }
  [HARNESS_METHODS.shellsList]: { params: Record<string, never>; result: ShellOption[] }
  [HARNESS_METHODS.terminalsList]: { params: Record<string, never>; result: TerminalInfo[] }
  [HARNESS_METHODS.terminalCreate]: {
    params: { workspaceId: string; shellId?: string; cols: number; rows: number }
    result: TerminalInfo
  }
  /** Recent output, so a reloaded window repaints the screen before live output resumes. */
  [HARNESS_METHODS.terminalAttach]: { params: { terminalId: string }; result: { buffer: string } }
  [HARNESS_METHODS.terminalInput]: { params: { terminalId: string; data: string }; result: Record<string, never> }
  [HARNESS_METHODS.terminalResize]: {
    params: { terminalId: string; cols: number; rows: number }
    result: Record<string, never>
  }
  [HARNESS_METHODS.terminalClose]: { params: { terminalId: string }; result: Record<string, never> }
  [HARNESS_METHODS.fsList]: { params: { workspaceId: string; dir: string }; result: FileEntry[] }
  [HARNESS_METHODS.fsRead]: { params: { workspaceId: string; path: string }; result: FileContent }
  [HARNESS_METHODS.gitStatus]: { params: { workspaceId: string }; result: GitStatusResult }
  [HARNESS_METHODS.gitDiff]: { params: { workspaceId: string; path: string; staged: boolean }; result: FileDiff }
  [HARNESS_METHODS.gitStage]: { params: { workspaceId: string; paths: string[] }; result: Record<string, never> }
  [HARNESS_METHODS.gitUnstage]: { params: { workspaceId: string; paths: string[] }; result: Record<string, never> }
  [HARNESS_METHODS.gitCommit]: { params: { workspaceId: string; message: string }; result: { commit: string } }
}

export type HarnessMethod = keyof HarnessRequests
