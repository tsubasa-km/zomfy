import type {
  HostedCheck,
  HostedChecksStatus,
  HostedReview,
  HostedReviewComment,
  HostedReviewFile,
  HostedWorkItem,
  HostingProviderId,
  WorkItemKind,
  WorkItemPreset
} from '@acp-harness/protocol'
import type { HostingRunner, HostingTool } from './hosting-cli.ts'
import type { HostingRemote } from './hosting-remote.ts'

/** Where a provider call runs: a checkout on this host and the remote repository it maps to. */
export interface HostingContext {
  cwd: string
  remote: HostingRemote
  run: HostingRunner
}

export interface CreateReviewInput {
  title: string
  body: string
  base: string
  head: string
  draft: boolean
}

/** What every code host offers; GitHub and GitLab each implement it over their own CLI. */
export interface HostingProvider {
  id: HostingProviderId
  tool: HostingTool
  reviewForBranch(ctx: HostingContext, branch: string): Promise<HostedReview | null>
  /** Recent reviews keyed by head branch, in one call, for sidebar cards. */
  recentReviewsByBranch(ctx: HostingContext): Promise<Map<string, HostedReview>>
  checks(ctx: HostingContext, number: number): Promise<HostedCheck[]>
  comments(ctx: HostingContext, number: number): Promise<HostedReviewComment[]>
  reviewFiles(ctx: HostingContext, number: number): Promise<{ files: HostedReviewFile[]; baseSha: string | null; headSha: string | null; baseRefName: string }>
  /** Returns the new review's URL. */
  createReview(ctx: HostingContext, input: CreateReviewInput): Promise<string>
  workItems(ctx: HostingContext, kind: WorkItemKind, preset: WorkItemPreset, search: string, limit: number): Promise<HostedWorkItem[]>
  workItem(ctx: HostingContext, kind: WorkItemKind, number: number): Promise<HostedWorkItem>
  /** The ref the base remote publishes a review's head under. */
  reviewHeadRef(number: number): string
}

/** Orca's roll-up: any failure wins, then anything still running, then success. */
export function rollUpChecks(checks: HostedCheck[]): HostedChecksStatus {
  if (checks.length === 0) return 'none'
  const conclusions = checks.map((c) => c.conclusion ?? 'pending')
  if (conclusions.some((c) => c === 'failure' || c === 'timed_out' || c === 'cancelled' || c === 'action_required')) return 'failure'
  if (conclusions.some((c) => c === 'pending')) return 'pending'
  if (conclusions.some((c) => c === 'success')) return 'success'
  return 'neutral'
}

/** Open first, then the most recently updated: what a branch's "current" review is. */
export function pickBranchReview(reviews: HostedReview[]): HostedReview | null {
  const rank = (r: HostedReview) => (r.state === 'open' || r.state === 'draft' ? 1 : 0)
  return (
    [...reviews].sort((a, b) => rank(b) - rank(a) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null
  )
}

/** +/- counts from a unified diff body. */
export function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}
