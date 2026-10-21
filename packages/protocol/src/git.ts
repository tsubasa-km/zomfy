export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitChange {
  /** Workspace-relative, '/'-separated. */
  path: string
  oldPath?: string
  status: GitFileStatus
  additions: number | null
  deletions: number | null
}

/** The current branch against its upstream; `hasUpstream: false` means it was never published. */
export interface GitUpstreamStatus {
  hasUpstream: boolean
  /** Short name, e.g. `origin/main`. */
  upstreamName: string | null
  ahead: number
  behind: number
  /** Diverged only because the branch was rebased: the remote holds older copies of local commits, so force-with-lease is the fix. */
  behindArePatchEquivalent?: boolean
}

export interface GitStatusResult {
  isRepo: boolean
  branch: string | null
  staged: GitChange[]
  unstaged: GitChange[]
  /** HEAD commit, null before the first commit. */
  head?: string | null
  /** Null on a detached HEAD or outside a repository. */
  upstream?: GitUpstreamStatus | null
}

/** Compares two revisions instead of the index or working tree. */
export interface GitDiffCompare {
  base: string
  head: string
}

export interface FileDiff {
  path: string
  staged: boolean
  /** Unified diff text; empty when there is no textual change. */
  patch: string
  binary: boolean
}

export type GitDiscardArea = 'staged' | 'unstaged' | 'untracked'

// Orca's commit graph model (shared/git-history-types.ts).
export type GitHistoryGraphColorId =
  | 'git-graph-ref'
  | 'git-graph-remote-ref'
  | 'git-graph-base-ref'
  | 'git-graph-lane-1'
  | 'git-graph-lane-2'
  | 'git-graph-lane-3'
  | 'git-graph-lane-4'
  | 'git-graph-lane-5'

export type GitHistoryRefCategory = 'branches' | 'remote branches' | 'tags' | 'commits'

export interface GitHistoryItemRef {
  id: string
  name: string
  revision?: string
  category?: GitHistoryRefCategory
  color?: GitHistoryGraphColorId
}

export interface GitHistoryItem {
  id: string
  parentIds: string[]
  subject: string
  message: string
  displayId?: string
  author?: string
  authorEmail?: string
  /** Epoch milliseconds. */
  timestamp?: number
  references?: GitHistoryItemRef[]
}

export interface GitHistoryResult {
  items: GitHistoryItem[]
  currentRef?: GitHistoryItemRef
  remoteRef?: GitHistoryItemRef
  baseRef?: GitHistoryItemRef
  mergeBase?: string
  hasIncomingChanges: boolean
  hasOutgoingChanges: boolean
  hasMore: boolean
  limit: number
}

export interface GitCommitChanges {
  commit: string
  /** First parent, or git's empty tree for a root commit, so it can be diffed against. */
  parent: string
  entries: GitChange[]
}

export interface GitBranchCompareSummary {
  baseRef: string
  baseOid: string | null
  headOid: string | null
  mergeBase: string | null
  changedFiles: number
  commitsAhead?: number
  commitsBehind?: number
  status: 'ready' | 'invalid-base' | 'unborn-head' | 'no-merge-base' | 'error'
  errorMessage?: string
}

export interface GitBranchCompareResult {
  summary: GitBranchCompareSummary
  entries: GitChange[]
}

type Ws = { workspaceId: string }
type Empty = Record<string, never>

export const GIT_METHODS = {
  gitStatus: '_harness/git/status',
  gitDiff: '_harness/git/diff',
  gitStage: '_harness/git/stage',
  gitUnstage: '_harness/git/unstage',
  gitDiscard: '_harness/git/discard',
  gitCommit: '_harness/git/commit',
  gitPush: '_harness/git/push',
  gitPull: '_harness/git/pull',
  gitFetch: '_harness/git/fetch',
  gitSync: '_harness/git/sync',
  gitHistory: '_harness/git/history',
  gitCommitChanges: '_harness/git/commitChanges',
  gitBranchCompare: '_harness/git/branchCompare',
  gitBaseRefs: '_harness/git/baseRefs',
  gitGenerateCommitMessage: '_harness/git/generateCommitMessage',
  gitCancelCommitMessage: '_harness/git/cancelCommitMessage'
} as const

export interface GitRequests {
  [GIT_METHODS.gitStatus]: { params: Ws; result: GitStatusResult }
  [GIT_METHODS.gitDiff]: { params: Ws & { path: string; staged: boolean; compare?: GitDiffCompare }; result: FileDiff }
  [GIT_METHODS.gitStage]: { params: Ws & { paths: string[] }; result: Empty }
  [GIT_METHODS.gitUnstage]: { params: Ws & { paths: string[] }; result: Empty }
  /** Reverts tracked paths and deletes untracked ones; `staged` also unstages (staged new files are deleted). */
  [GIT_METHODS.gitDiscard]: { params: Ws & { paths: string[]; area: GitDiscardArea }; result: Empty }
  /** `amend` with an empty message keeps the previous one. */
  [GIT_METHODS.gitCommit]: { params: Ws & { message: string; amend?: boolean }; result: { commit: string } }
  /** Pushes to the upstream, or publishes the branch (sets an upstream) when it has none. */
  [GIT_METHODS.gitPush]: { params: Ws & { forceWithLease?: boolean }; result: Empty }
  [GIT_METHODS.gitPull]: { params: Ws & { ffOnly?: boolean }; result: Empty }
  [GIT_METHODS.gitFetch]: { params: Ws; result: Empty }
  /** Fetch, pull, then push what is left ahead (Orca's Sync). */
  [GIT_METHODS.gitSync]: { params: Ws; result: Empty }
  [GIT_METHODS.gitHistory]: { params: Ws & { limit?: number; baseRef?: string | null }; result: GitHistoryResult }
  [GIT_METHODS.gitCommitChanges]: { params: Ws & { commit: string }; result: GitCommitChanges }
  /** Committed changes on HEAD since it forked from `baseRef` (default: the repo's default base). */
  [GIT_METHODS.gitBranchCompare]: { params: Ws & { baseRef?: string | null }; result: GitBranchCompareResult }
  [GIT_METHODS.gitBaseRefs]: { params: Ws; result: { refs: string[]; defaultBaseRef: string } }
  /** One-shot Claude call over the staged diff; rejects when cancelled. */
  [GIT_METHODS.gitGenerateCommitMessage]: { params: Ws; result: { message: string } }
  [GIT_METHODS.gitCancelCommitMessage]: { params: Ws; result: Empty }
}
