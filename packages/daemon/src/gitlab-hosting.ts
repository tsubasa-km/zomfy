import type {
  HostedCheck,
  HostedCheckConclusion,
  HostedChecksStatus,
  HostedReview,
  HostedReviewComment,
  HostedReviewFile,
  HostedWorkItem,
  WorkItemPreset
} from '@acp-harness/protocol'
import { TtlCache } from './hosting-cache.ts'
import { parseJson } from './hosting-cli.ts'
import { countPatchLines, pickBranchReview, type HostingContext, type HostingProvider } from './hosting-provider.ts'

// GitLab through `glab api` (REST v4) against an explicit project path and host, plus `glab mr create`.

interface GlUser {
  id?: number
  username?: string
}

interface GlMr {
  iid: number
  title: string
  state: string
  draft?: boolean
  work_in_progress?: boolean
  web_url: string
  source_branch: string
  target_branch: string
  sha?: string | null
  updated_at?: string
  author?: GlUser | null
  labels?: string[]
  description?: string | null
  source_project_id?: number
  target_project_id?: number
  head_pipeline?: { status?: string } | null
  detailed_merge_status?: string
  diff_refs?: { base_sha?: string; head_sha?: string; start_sha?: string } | null
}

interface GlIssue {
  iid: number
  title: string
  state: string
  web_url: string
  author?: GlUser | null
  labels?: string[]
  updated_at?: string
  description?: string | null
}

function project(ctx: HostingContext): string {
  return `projects/${encodeURIComponent(ctx.remote.path)}`
}

async function api<T>(ctx: HostingContext, path: string): Promise<T> {
  return parseJson<T>(await ctx.run('glab', ctx.cwd, ['api', '--hostname', ctx.remote.host, path]))
}

const PIPELINE_STATUS: Record<string, HostedChecksStatus> = {
  success: 'success',
  failed: 'failure',
  running: 'pending',
  pending: 'pending',
  created: 'pending',
  preparing: 'pending',
  scheduled: 'pending',
  waiting_for_resource: 'pending',
  canceled: 'neutral',
  skipped: 'neutral',
  manual: 'neutral'
}

export function mapMergeRequest(mr: GlMr): HostedReview {
  const state: HostedReview['state'] =
    mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? (mr.draft || mr.work_in_progress ? 'draft' : 'open') : 'closed'
  const pipeline = mr.head_pipeline?.status
  return {
    provider: 'gitlab',
    number: mr.iid,
    title: mr.title,
    state,
    url: mr.web_url,
    headRefName: mr.source_branch,
    baseRefName: mr.target_branch,
    headSha: mr.sha ?? null,
    updatedAt: mr.updated_at ?? null,
    author: mr.author?.username ?? null,
    // List endpoints carry no pipeline, so their reviews read 'none' until the panel looks closer.
    checksStatus: pipeline ? (PIPELINE_STATUS[pipeline] ?? 'neutral') : 'none',
    reviewDecision: mr.detailed_merge_status === 'not_approved' ? 'REVIEW_REQUIRED' : null,
    isCrossRepository:
      mr.source_project_id !== undefined && mr.target_project_id !== undefined && mr.source_project_id !== mr.target_project_id
  }
}

export function mapJob(job: {
  name: string
  stage?: string
  status: string
  web_url?: string
  started_at?: string | null
  finished_at?: string | null
  allow_failure?: boolean
}): HostedCheck {
  const queued = ['created', 'pending', 'preparing', 'scheduled', 'waiting_for_resource'].includes(job.status)
  const running = job.status === 'running'
  const conclusion: HostedCheckConclusion =
    job.status === 'success'
      ? 'success'
      : job.status === 'failed'
        ? job.allow_failure
          ? 'neutral'
          : 'failure'
        : job.status === 'canceled'
          ? 'cancelled'
          : job.status === 'skipped'
            ? 'skipped'
            : job.status === 'manual'
              ? 'neutral'
              : 'pending'
  return {
    name: job.name,
    status: queued ? 'queued' : running ? 'in_progress' : 'completed',
    conclusion,
    url: job.web_url ?? null,
    startedAt: job.started_at ?? null,
    completedAt: job.finished_at ?? null,
    group: job.stage ?? null
  }
}

const viewers = new TtlCache<GlUser>(30 * 60_000)

function viewer(ctx: HostingContext): Promise<GlUser> {
  return viewers.get(ctx.remote.host, () => api<GlUser>(ctx, 'user'))
}

const MR_STATE: Partial<Record<WorkItemPreset, string>> = { merged: 'merged', closed: 'closed', all: 'all' }

/** `glab mr create` argv; exported so the exact write command can be checked without running it. */
export function gitlabCreateArgs(ctx: HostingContext, input: { title: string; body: string; base: string; head: string; draft: boolean }): string[] {
  return [
    'mr',
    'create',
    '-R',
    // A full URL names a self-managed host unambiguously; a bare path would mean gitlab.com.
    ctx.remote.host === 'gitlab.com' ? ctx.remote.path : `https://${ctx.remote.host}/${ctx.remote.path}`,
    '--source-branch',
    input.head,
    '--target-branch',
    input.base,
    '--title',
    input.title,
    '--description',
    input.body,
    '--yes',
    ...(input.draft ? ['--draft'] : [])
  ]
}

function issueItem(issue: GlIssue): HostedWorkItem {
  return {
    provider: 'gitlab',
    kind: 'issue',
    number: issue.iid,
    title: issue.title,
    state: issue.state === 'closed' ? 'closed' : 'open',
    url: issue.web_url,
    author: issue.author?.username ?? null,
    labels: issue.labels ?? [],
    updatedAt: issue.updated_at ?? null,
    ...(issue.description !== undefined ? { body: issue.description ?? '' } : {})
  }
}

function reviewItem(mr: GlMr): HostedWorkItem {
  const review = mapMergeRequest(mr)
  return {
    provider: 'gitlab',
    kind: 'review',
    number: review.number,
    title: review.title,
    state: review.state,
    url: review.url,
    author: review.author,
    labels: mr.labels ?? [],
    updatedAt: review.updatedAt,
    headRefName: review.headRefName,
    checksStatus: review.checksStatus,
    reviewDecision: review.reviewDecision,
    isCrossRepository: review.isCrossRepository,
    ...(mr.description !== undefined ? { body: mr.description ?? '' } : {})
  }
}

export const gitlabHosting: HostingProvider = {
  id: 'gitlab',
  tool: 'glab',

  async reviewForBranch(ctx, branch) {
    const list = await api<GlMr[]>(
      ctx,
      `${project(ctx)}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all&order_by=updated_at&per_page=5`
    )
    const picked = pickBranchReview(list.map(mapMergeRequest))
    if (!picked) return null
    // Only the single-MR endpoint reports the head pipeline and approval state.
    return mapMergeRequest(await api<GlMr>(ctx, `${project(ctx)}/merge_requests/${picked.number}`))
  },

  async recentReviewsByBranch(ctx) {
    const list = await api<GlMr[]>(ctx, `${project(ctx)}/merge_requests?state=all&order_by=updated_at&per_page=50`)
    const byBranch = new Map<string, HostedReview[]>()
    for (const review of list.map(mapMergeRequest)) {
      if (review.isCrossRepository) continue
      byBranch.set(review.headRefName, [...(byBranch.get(review.headRefName) ?? []), review])
    }
    return new Map([...byBranch].map(([branch, reviews]) => [branch, pickBranchReview(reviews)!]))
  },

  async checks(ctx, number) {
    const pipelines = await api<{ id: number }[]>(ctx, `${project(ctx)}/merge_requests/${number}/pipelines?per_page=1`)
    const latest = pipelines[0]
    if (!latest) return []
    const jobs = await api<Parameters<typeof mapJob>[0][]>(ctx, `${project(ctx)}/pipelines/${latest.id}/jobs?per_page=100`)
    return jobs.map(mapJob)
  },

  async comments(ctx, number) {
    const notes = await api<
      {
        id: number
        body: string
        author?: GlUser
        created_at?: string
        system?: boolean
        resolved?: boolean
        position?: { new_path?: string; old_path?: string; new_line?: number | null; old_line?: number | null } | null
      }[]
    >(ctx, `${project(ctx)}/merge_requests/${number}/notes?per_page=100&sort=asc&order_by=created_at`)
    return notes
      .filter((n) => !n.system)
      .map(
        (n): HostedReviewComment => ({
          id: String(n.id),
          author: n.author?.username ?? null,
          body: n.body,
          createdAt: n.created_at ?? null,
          url: null,
          kind: n.position ? 'inline' : 'comment',
          path: n.position ? (n.position.new_path ?? n.position.old_path ?? null) : null,
          line: n.position ? (n.position.new_line ?? n.position.old_line ?? null) : null,
          resolved: n.resolved
        })
      )
  },

  async reviewFiles(ctx, number) {
    const mr = await api<GlMr>(ctx, `${project(ctx)}/merge_requests/${number}`)
    type GlDiff = { old_path: string; new_path: string; new_file?: boolean; deleted_file?: boolean; renamed_file?: boolean; diff?: string }
    const diffs = await api<GlDiff[]>(ctx, `${project(ctx)}/merge_requests/${number}/diffs?per_page=100`).catch(async () =>
      // GitLab before 15.7 only has the deprecated /changes endpoint.
      (await api<{ changes?: GlDiff[] }>(ctx, `${project(ctx)}/merge_requests/${number}/changes`)).changes ?? []
    )
    const files: HostedReviewFile[] = diffs.map((d) => {
      const counts = d.diff ? countPatchLines(d.diff) : null
      return {
        path: d.new_path,
        ...(d.renamed_file ? { oldPath: d.old_path } : {}),
        status: d.new_file ? 'added' : d.deleted_file ? 'deleted' : d.renamed_file ? 'renamed' : 'modified',
        additions: counts?.additions ?? null,
        deletions: counts?.deletions ?? null
      }
    })
    return {
      files,
      baseSha: mr.diff_refs?.base_sha ?? null,
      headSha: mr.diff_refs?.head_sha ?? mr.sha ?? null,
      baseRefName: mr.target_branch
    }
  },

  async createReview(ctx, input) {
    const out = await ctx.run('glab', ctx.cwd, gitlabCreateArgs(ctx, input), { timeoutMs: 60_000 })
    return /https?:\/\/\S+\/merge_requests\/\d+/.exec(out)?.[0] ?? ''
  },

  async workItems(ctx, kind, preset, search, limit) {
    const params = new URLSearchParams({ per_page: String(limit), order_by: 'updated_at' })
    if (search.trim()) params.set('search', search.trim())
    if (kind === 'issue') {
      params.set('state', preset === 'closed' || preset === 'merged' ? 'closed' : preset === 'all' ? 'all' : 'opened')
      if (preset === 'assigned') params.set('scope', 'assigned_to_me')
      if (preset === 'mine') params.set('scope', 'created_by_me')
      return (await api<GlIssue[]>(ctx, `${project(ctx)}/issues?${params}`)).map(issueItem)
    }
    params.set('state', MR_STATE[preset] ?? 'opened')
    if (preset === 'mine') params.set('scope', 'created_by_me')
    if (preset === 'assigned') params.set('scope', 'assigned_to_me')
    if (preset === 'review-requested') {
      const me = await viewer(ctx)
      if (me.username) params.set('reviewer_username', me.username)
    }
    return (await api<GlMr[]>(ctx, `${project(ctx)}/merge_requests?${params}`)).map(reviewItem)
  },

  async workItem(ctx, kind, number) {
    return kind === 'issue'
      ? issueItem(await api<GlIssue>(ctx, `${project(ctx)}/issues/${number}`))
      : reviewItem(await api<GlMr>(ctx, `${project(ctx)}/merge_requests/${number}`))
  },

  reviewHeadRef: (number) => `refs/merge-requests/${number}/head`
}
