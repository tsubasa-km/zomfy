import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  HostedCheck,
  HostedCheckConclusion,
  HostedReview,
  HostedReviewComment,
  HostedReviewDecision,
  HostedReviewFile,
  HostedWorkItem,
  WorkItemPreset
} from '@acp-harness/protocol'
import { parseJson } from './hosting-cli.ts'
import { pickBranchReview, rollUpChecks, type HostingContext, type HostingProvider } from './hosting-provider.ts'

// GitHub through `gh`, always with an explicit -R so a checkout with several remotes never prompts
// for a default repository.

const PR_FIELDS = [
  'number',
  'title',
  'state',
  'isDraft',
  'url',
  'headRefName',
  'baseRefName',
  'headRefOid',
  'updatedAt',
  'author',
  'reviewDecision',
  'statusCheckRollup',
  'isCrossRepository'
].join(',')

interface GhRollupItem {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
  startedAt?: string
  completedAt?: string
  detailsUrl?: string
  targetUrl?: string
  workflowName?: string
}

interface GhPr {
  number: number
  title: string
  state: string
  isDraft?: boolean
  url: string
  headRefName?: string
  baseRefName?: string
  headRefOid?: string
  updatedAt?: string
  author?: { login?: string } | null
  reviewDecision?: string | null
  statusCheckRollup?: GhRollupItem[] | null
  isCrossRepository?: boolean
  labels?: { name: string }[]
  body?: string
}

interface GhIssue {
  number: number
  title: string
  state: string
  url: string
  author?: { login?: string } | null
  labels?: { name: string }[]
  updatedAt?: string
  body?: string
}

function repoArg(ctx: HostingContext): string[] {
  const { host, path } = ctx.remote
  return ['-R', host === 'github.com' ? path : `${host}/${path}`]
}

async function gh<T>(ctx: HostingContext, args: string[]): Promise<T> {
  return parseJson<T>(await ctx.run('gh', ctx.cwd, args))
}

const CONCLUSIONS: Record<string, HostedCheckConclusion> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out',
  NEUTRAL: 'neutral',
  SKIPPED: 'skipped',
  STALE: 'neutral',
  ACTION_REQUIRED: 'action_required',
  STARTUP_FAILURE: 'failure'
}

/** A check run or a legacy commit status from statusCheckRollup. */
export function mapRollupItem(item: GhRollupItem): HostedCheck {
  if (item.__typename === 'StatusContext' || (item.context && !item.name)) {
    const state = (item.state ?? '').toUpperCase()
    const pending = state === 'PENDING' || state === 'EXPECTED'
    return {
      name: item.context ?? 'status',
      status: pending ? 'in_progress' : 'completed',
      conclusion: pending ? 'pending' : (CONCLUSIONS[state] ?? 'neutral'),
      url: item.targetUrl || null,
      startedAt: item.startedAt || null,
      completedAt: null
    }
  }
  const status = (item.status ?? '').toUpperCase()
  const completed = status === 'COMPLETED'
  return {
    name: item.name ?? 'check',
    status: completed ? 'completed' : status === 'IN_PROGRESS' ? 'in_progress' : 'queued',
    conclusion: completed ? (CONCLUSIONS[(item.conclusion ?? '').toUpperCase()] ?? 'neutral') : 'pending',
    url: item.detailsUrl || null,
    startedAt: item.startedAt && !item.startedAt.startsWith('0001') ? item.startedAt : null,
    completedAt: item.completedAt && !item.completedAt.startsWith('0001') ? item.completedAt : null,
    group: item.workflowName || null
  }
}

function reviewState(pr: { state: string; isDraft?: boolean }): HostedReview['state'] {
  const state = pr.state.toUpperCase()
  if (state === 'MERGED') return 'merged'
  if (state === 'CLOSED') return 'closed'
  return pr.isDraft ? 'draft' : 'open'
}

function decision(value: string | null | undefined): HostedReviewDecision | null {
  return value === 'APPROVED' || value === 'CHANGES_REQUESTED' || value === 'REVIEW_REQUIRED' ? value : null
}

export function mapPullRequest(pr: GhPr): HostedReview {
  return {
    provider: 'github',
    number: pr.number,
    title: pr.title,
    state: reviewState(pr),
    url: pr.url,
    headRefName: pr.headRefName ?? '',
    baseRefName: pr.baseRefName ?? '',
    headSha: pr.headRefOid ?? null,
    updatedAt: pr.updatedAt ?? null,
    author: pr.author?.login ?? null,
    checksStatus: rollUpChecks((pr.statusCheckRollup ?? []).map(mapRollupItem)),
    reviewDecision: decision(pr.reviewDecision),
    isCrossRepository: pr.isCrossRepository ?? false
  }
}

/** Orca's Tasks preset queries (shared/task-preset-query.ts), newest activity first. */
export function githubSearchQuery(kind: 'issue' | 'review', preset: WorkItemPreset, search: string): string {
  const presetQuery: Record<WorkItemPreset, string> = {
    open: 'is:open',
    assigned: 'is:open assignee:@me',
    mine: 'is:open author:@me',
    'review-requested': 'is:open review-requested:@me',
    merged: kind === 'review' ? 'is:merged' : 'is:closed',
    closed: kind === 'review' ? 'is:closed is:unmerged' : 'is:closed',
    all: ''
  }
  return [presetQuery[preset], search.trim(), 'sort:updated-desc'].filter(Boolean).join(' ')
}

function issueItem(issue: GhIssue): HostedWorkItem {
  return {
    provider: 'github',
    kind: 'issue',
    number: issue.number,
    title: issue.title,
    state: issue.state.toUpperCase() === 'CLOSED' ? 'closed' : 'open',
    url: issue.url,
    author: issue.author?.login ?? null,
    labels: (issue.labels ?? []).map((l) => l.name),
    updatedAt: issue.updatedAt ?? null,
    ...(issue.body !== undefined ? { body: issue.body } : {})
  }
}

function reviewItem(pr: GhPr): HostedWorkItem {
  const review = mapPullRequest(pr)
  return {
    provider: 'github',
    kind: 'review',
    number: review.number,
    title: review.title,
    state: review.state,
    url: review.url,
    author: review.author,
    labels: (pr.labels ?? []).map((l) => l.name),
    updatedAt: review.updatedAt,
    headRefName: review.headRefName,
    checksStatus: review.checksStatus,
    reviewDecision: review.reviewDecision,
    isCrossRepository: review.isCrossRepository,
    ...(pr.body !== undefined ? { body: pr.body } : {})
  }
}

const FILE_STATUS: Record<string, HostedReviewFile['status']> = {
  ADDED: 'added',
  DELETED: 'deleted',
  RENAMED: 'renamed',
  COPIED: 'added'
}

/** `gh pr create` argv; exported so the exact write command can be checked without running it. */
export function githubCreateArgs(ctx: HostingContext, input: { title: string; base: string; head: string; draft: boolean }, bodyFile: string): string[] {
  return [
    'pr',
    'create',
    ...repoArg(ctx),
    '--base',
    input.base,
    '--head',
    input.head,
    '--title',
    input.title,
    '--body-file',
    bodyFile,
    ...(input.draft ? ['--draft'] : [])
  ]
}

export const githubHosting: HostingProvider = {
  id: 'github',
  tool: 'gh',

  async reviewForBranch(ctx, branch) {
    const prs = await gh<GhPr[]>(ctx, ['pr', 'list', ...repoArg(ctx), '--head', branch, '--state', 'all', '--limit', '5', '--json', PR_FIELDS])
    return pickBranchReview(prs.filter((pr) => pr.headRefName === branch && !pr.isCrossRepository).map(mapPullRequest))
  },

  async review(ctx, number) {
    return mapPullRequest(await gh<GhPr>(ctx, ['pr', 'view', String(number), ...repoArg(ctx), '--json', PR_FIELDS]))
  },

  async recentReviews(ctx) {
    const prs = await gh<GhPr[]>(ctx, ['pr', 'list', ...repoArg(ctx), '--state', 'all', '--limit', '50', '--json', PR_FIELDS])
    return prs.map(mapPullRequest)
  },

  async checks(ctx, number) {
    const pr = await gh<GhPr>(ctx, ['pr', 'view', String(number), ...repoArg(ctx), '--json', 'statusCheckRollup'])
    return (pr.statusCheckRollup ?? []).slice(0, 200).map(mapRollupItem)
  },

  async comments(ctx, number) {
    const { host, path } = ctx.remote
    const [conversation, inline] = await Promise.all([
      gh<{
        comments?: { id?: string; author?: { login?: string }; body: string; createdAt?: string; url?: string }[]
        reviews?: { id?: string; author?: { login?: string }; body: string; state?: string; submittedAt?: string }[]
      }>(ctx, ['pr', 'view', String(number), ...repoArg(ctx), '--json', 'comments,reviews']),
      gh<
        {
          id: number
          user?: { login?: string }
          body: string
          path?: string
          line?: number | null
          original_line?: number | null
          created_at?: string
          html_url?: string
        }[]
      >(ctx, ['api', '--hostname', host, `repos/${path}/pulls/${number}/comments?per_page=100`])
    ])
    const comments: HostedReviewComment[] = [
      ...(conversation.comments ?? []).map((c, i) => ({
        id: c.id ?? `comment-${i}`,
        author: c.author?.login ?? null,
        body: c.body,
        createdAt: c.createdAt ?? null,
        url: c.url ?? null,
        kind: 'comment' as const
      })),
      // A bare approval has no text but its verdict still matters.
      ...(conversation.reviews ?? [])
        .filter((r) => r.body.trim() || (r.state && r.state !== 'COMMENTED'))
        .map((r, i) => ({
          id: r.id ?? `review-${i}`,
          author: r.author?.login ?? null,
          body: r.body,
          createdAt: r.submittedAt ?? null,
          url: null,
          kind: 'review' as const,
          reviewState: r.state ?? null
        })),
      ...inline.map((c) => ({
        id: String(c.id),
        author: c.user?.login ?? null,
        body: c.body,
        createdAt: c.created_at ?? null,
        url: c.html_url ?? null,
        path: c.path ?? null,
        line: c.line ?? c.original_line ?? null,
        kind: 'inline' as const
      }))
    ]
    return comments.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).slice(0, 300)
  },

  async reviewFiles(ctx, number) {
    const pr = await gh<{
      files?: { path: string; additions?: number; deletions?: number; changeType?: string }[]
      baseRefOid?: string
      headRefOid?: string
      baseRefName?: string
    }>(ctx, ['pr', 'view', String(number), ...repoArg(ctx), '--json', 'files,baseRefOid,headRefOid,baseRefName'])
    return {
      files: (pr.files ?? []).slice(0, 500).map((f) => ({
        path: f.path,
        status: FILE_STATUS[(f.changeType ?? '').toUpperCase()] ?? 'modified',
        additions: f.additions ?? null,
        deletions: f.deletions ?? null
      })),
      baseSha: pr.baseRefOid ?? null,
      headSha: pr.headRefOid ?? null,
      baseRefName: pr.baseRefName ?? ''
    }
  },

  async createReview(ctx, input) {
    const dir = await mkdtemp(join(tmpdir(), 'acp-harness-pr-'))
    try {
      const bodyFile = join(dir, 'body.md')
      await writeFile(bodyFile, input.body, 'utf8')
      const out = await ctx.run('gh', ctx.cwd, githubCreateArgs(ctx, input, bodyFile), { timeoutMs: 60_000 })
      return out.trim().split('\n').reverse().find((line) => line.startsWith('http'))?.trim() ?? ''
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },

  async workItems(ctx, kind, preset, search, limit) {
    const query = githubSearchQuery(kind, preset, search)
    if (kind === 'issue') {
      const issues = await gh<GhIssue[]>(ctx, [
        'issue',
        'list',
        ...repoArg(ctx),
        '--state',
        'all',
        '--limit',
        String(limit),
        '--search',
        query,
        '--json',
        'number,title,state,url,author,labels,updatedAt'
      ])
      return issues.map(issueItem)
    }
    const prs = await gh<GhPr[]>(ctx, [
      'pr',
      'list',
      ...repoArg(ctx),
      '--state',
      'all',
      '--limit',
      String(limit),
      '--search',
      query,
      '--json',
      `${PR_FIELDS},labels`
    ])
    return prs.map(reviewItem)
  },

  async workItem(ctx, kind, number) {
    if (kind === 'issue') {
      return issueItem(
        await gh<GhIssue>(ctx, ['issue', 'view', String(number), ...repoArg(ctx), '--json', 'number,title,state,url,author,labels,updatedAt,body'])
      )
    }
    return reviewItem(await gh<GhPr>(ctx, ['pr', 'view', String(number), ...repoArg(ctx), '--json', `${PR_FIELDS},labels,body`]))
  },

  reviewHeadRef: (number) => `refs/pull/${number}/head`
}
