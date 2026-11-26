// Code hosting (GitHub pull requests, GitLab merge requests, issues, CI checks). The daemon talks to
// `gh` / `glab` on its own host; generic names ("review", "work item") cover both providers, as
// Orca's hosted-review types do.

import type { TerminalInfo } from './terminals'

export type HostingProviderId = 'github' | 'gitlab'

/** One GitHub or GitLab account on a host, as a project picks it (docs/specs/project-hosting-accounts.md). */
export interface HostingAccountRef {
  provider: HostingProviderId
  /** e.g. `github.com`, `gitlab.example.com`. */
  host: string
  login: string
}

/** An account the daemon's host can act as. */
export interface HostingAccount extends HostingAccountRef {
  /** The CLI's active account for its host (glab's only one). */
  active: boolean
  /** Who holds its token: the CLI's own login, or a token Zomfy keeps. */
  source: 'gh' | 'glab' | 'zomfy'
  /** Where a token Zomfy keeps is stored. */
  storage?: 'keyring' | 'file'
  /** The CLI reported this account failing (expired token, say). */
  problem?: string
}

/** What a folder's remote or a clone URL points at. */
export interface HostingRemoteInfo {
  provider: HostingProviderId
  host: string
  /** `owner/repo` or the GitLab project path. */
  repo: string
}

/** Why hosting features are (un)available for a repository on this host. */
export type HostingAvailabilityState =
  | 'ready'
  | 'not-git'
  | 'no-remote'
  /** The remote is not a GitHub or GitLab host the CLI knows. */
  | 'unsupported-remote'
  | 'cli-missing'
  | 'unauthenticated'

export interface HostingAvailability {
  state: HostingAvailabilityState
  provider: HostingProviderId | null
  /** `owner/repo` or the GitLab project path. */
  repo: string | null
  /** e.g. `github.com`, `gitlab.example.com`. */
  host: string | null
  /** What to tell the user when not ready (install or login hint). */
  message?: string
}

export type HostedReviewState = 'open' | 'draft' | 'merged' | 'closed'
/** Rolled-up CI result; 'none' when the head commit has no checks. */
export type HostedChecksStatus = 'pending' | 'success' | 'failure' | 'neutral' | 'none'
export type HostedReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'

/** A GitHub pull request or GitLab merge request (Orca's HostedReviewInfo). */
export interface HostedReview {
  provider: HostingProviderId
  number: number
  title: string
  state: HostedReviewState
  url: string
  headRefName: string
  baseRefName: string
  headSha: string | null
  updatedAt: string | null
  author: string | null
  checksStatus: HostedChecksStatus
  reviewDecision: HostedReviewDecision | null
  /** Head lives in a fork, so its branch cannot be checked out from the base remote by name. */
  isCrossRepository?: boolean
}

export type HostedCheckConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'neutral'
  | 'skipped'
  | 'action_required'
  | 'pending'

/** One CI check run, status context or pipeline job (Orca's PRCheckDetail). */
export interface HostedCheck {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: HostedCheckConclusion | null
  url: string | null
  startedAt: string | null
  completedAt: string | null
  /** Workflow or pipeline stage, shown as context. */
  group?: string | null
}

export interface HostedReviewComment {
  id: string
  author: string | null
  body: string
  createdAt: string | null
  url: string | null
  /** Set for comments on a diff line. */
  path?: string | null
  line?: number | null
  /** 'review' bodies carry their verdict. */
  kind: 'comment' | 'review' | 'inline'
  reviewState?: string | null
  resolved?: boolean
}

export interface HostedReviewFile {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number | null
  deletions: number | null
}

export type WorkItemKind = 'issue' | 'review'

/** An issue, pull request or merge request listed on the Tasks page. */
export interface HostedWorkItem {
  provider: HostingProviderId
  kind: WorkItemKind
  number: number
  title: string
  /** Issues are 'open' or 'closed'. */
  state: HostedReviewState
  url: string
  author: string | null
  labels: string[]
  updatedAt: string | null
  /** Reviews only. */
  headRefName?: string
  checksStatus?: HostedChecksStatus
  reviewDecision?: HostedReviewDecision | null
  isCrossRepository?: boolean
  /** Markdown body; only on single-item fetches. */
  body?: string
}

/** Orca's Tasks presets: GitHub Open / Assigned to me / Mine / Needs review, GitLab state filters. */
export type WorkItemPreset = 'open' | 'assigned' | 'mine' | 'review-requested' | 'merged' | 'closed' | 'all'

export interface CreateReviewDefaults {
  title: string
  body: string
  /** Base branch name on the remote (no `origin/`). */
  base: string
  /** Remote branches that can be the base. */
  bases: string[]
  /** Commits on the branch not on the base. */
  commitCount: number
}

type Ws = { workspaceId: string }

export const HOSTING_METHODS = {
  hostingReview: '_harness/hosting/review',
  hostingReviewSummaries: '_harness/hosting/reviewSummaries',
  hostingChecks: '_harness/hosting/checks',
  hostingReviewComments: '_harness/hosting/reviewComments',
  hostingReviewFiles: '_harness/hosting/reviewFiles',
  hostingCreateDefaults: '_harness/hosting/createDefaults',
  hostingCreateReview: '_harness/hosting/createReview',
  hostingWorkItems: '_harness/hosting/workItems',
  hostingWorkItem: '_harness/hosting/workItem',
  hostingCheckoutReview: '_harness/hosting/checkoutReview',
  hostingAccounts: '_harness/hosting/accounts',
  hostingAccountAddToken: '_harness/hosting/accountAddToken',
  hostingAccountRemove: '_harness/hosting/accountRemove',
  hostingAccountLogin: '_harness/hosting/accountLogin',
  hostingRemoteOf: '_harness/hosting/remoteOf'
} as const

export interface HostingRequests {
  /** The workspace branch's PR/MR (open first, else the newest); `force` skips the short cache. */
  [HOSTING_METHODS.hostingReview]: {
    params: Ws & { force?: boolean }
    result: { availability: HostingAvailability; branch: string | null; review: HostedReview | null }
  }
  /** One batched lookup per project for the sidebar cards; workspaces without a review are left out. */
  [HOSTING_METHODS.hostingReviewSummaries]: {
    params: Record<string, never>
    result: { workspaceId: string; review: HostedReview }[]
  }
  [HOSTING_METHODS.hostingChecks]: {
    params: Ws & { number: number; force?: boolean }
    result: { checks: HostedCheck[]; status: HostedChecksStatus }
  }
  [HOSTING_METHODS.hostingReviewComments]: {
    params: Ws & { number: number }
    result: { comments: HostedReviewComment[] }
  }
  /**
   * Changed files plus local revisions to diff them with: the head is fetched when missing, and
   * `base` is the merge base, matching the host's three-dot diff.
   */
  [HOSTING_METHODS.hostingReviewFiles]: {
    params: Ws & { number: number }
    result: { files: HostedReviewFile[]; base: string; head: string }
  }
  [HOSTING_METHODS.hostingCreateDefaults]: { params: Ws; result: CreateReviewDefaults }
  /** Creates the PR/MR for the workspace branch, which must already be pushed. */
  [HOSTING_METHODS.hostingCreateReview]: {
    params: Ws & { title: string; body: string; base: string; draft: boolean }
    result: { review: HostedReview | null; url: string }
  }
  [HOSTING_METHODS.hostingWorkItems]: {
    params: { projectId: string; kind: WorkItemKind; preset: WorkItemPreset; search?: string; limit?: number }
    result: { availability: HostingAvailability; items: HostedWorkItem[] }
  }
  [HOSTING_METHODS.hostingWorkItem]: {
    params: { projectId: string; kind: WorkItemKind; number: number }
    result: HostedWorkItem
  }
  /**
   * Makes a local branch holding the PR/MR head (fetched from the base remote) for a new worktree;
   * returns its name. Same-repository reviews reuse the head branch name and track it.
   */
  [HOSTING_METHODS.hostingCheckoutReview]: {
    params: { projectId: string; number: number }
    result: { branch: string }
  }
  /** Every account this host's gh and glab hold, and the GitLab tokens Zomfy keeps. Newer daemons only. */
  [HOSTING_METHODS.hostingAccounts]: {
    params: { force?: boolean }
    result: { accounts: HostingAccount[]; cli: { gh: boolean; glab: boolean } }
  }
  /** Checks a GitLab personal access token with the host and keeps it; the login comes from the host. */
  [HOSTING_METHODS.hostingAccountAddToken]: {
    params: { provider: 'gitlab'; host: string; token: string }
    result: HostingAccount
  }
  /** Forgets a token Zomfy keeps; a CLI's own login is left to the CLI. */
  [HOSTING_METHODS.hostingAccountRemove]: { params: HostingAccountRef; result: Record<string, never> }
  /** A terminal running `gh auth login` / `glab auth login` for the host, in the workspace (else the floating one). */
  [HOSTING_METHODS.hostingAccountLogin]: {
    params: { provider: HostingProviderId; host: string; workspaceId?: string }
    result: TerminalInfo
  }
  /** What a folder's remote (`origin`, else the first) or a clone URL points at; null when not GitHub or GitLab. */
  [HOSTING_METHODS.hostingRemoteOf]: {
    params: { path?: string; url?: string }
    result: HostingRemoteInfo | null
  }
}
