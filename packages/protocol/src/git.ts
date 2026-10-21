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

export const GIT_METHODS = {
  gitStatus: '_harness/git/status',
  gitDiff: '_harness/git/diff',
  gitStage: '_harness/git/stage',
  gitUnstage: '_harness/git/unstage',
  gitCommit: '_harness/git/commit'
} as const

export interface GitRequests {
  [GIT_METHODS.gitStatus]: { params: { workspaceId: string }; result: GitStatusResult }
  [GIT_METHODS.gitDiff]: { params: { workspaceId: string; path: string; staged: boolean }; result: FileDiff }
  [GIT_METHODS.gitStage]: { params: { workspaceId: string; paths: string[] }; result: Record<string, never> }
  [GIT_METHODS.gitUnstage]: { params: { workspaceId: string; paths: string[] }; result: Record<string, never> }
  [GIT_METHODS.gitCommit]: { params: { workspaceId: string; message: string }; result: { commit: string } }
}
