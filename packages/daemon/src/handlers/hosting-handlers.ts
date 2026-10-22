import {
  HARNESS_METHODS,
  type HostedCheck,
  type HostedReview,
  type HostedWorkItem,
  type HostingAvailability,
  type Project
} from '@acp-harness/protocol'
import { currentBranch } from '../git-cli.ts'
import { githubHosting } from '../github-hosting.ts'
import { gitlabHosting } from '../gitlab-hosting.ts'
import { checkoutReviewBranch, createReviewDefaults, reviewDiffRevisions } from '../hosted-review-git.ts'
import { TtlCache } from '../hosting-cache.ts'
import { HostingCliError, loginHint, runHostingCli } from '../hosting-cli.ts'
import { rollUpChecks, type HostingContext, type HostingProvider } from '../hosting-provider.ts'
import { resolveHostingRemote } from '../hosting-remote.ts'
import type { HandlerContext } from './handler-context.ts'

// Caches keep gh/glab well inside rate limits: clients poll no faster than every 30s, and several
// panels asking at once share one call.
const reviews = new TtlCache<HostedReview | null>(30_000)
const summaries = new TtlCache<Map<string, HostedReview>>(60_000)
const checks = new TtlCache<HostedCheck[]>(20_000)
const workItems = new TtlCache<HostedWorkItem[]>(30_000)

const PROVIDERS: Record<HostingProvider['id'], HostingProvider> = { github: githubHosting, gitlab: gitlabHosting }

/** A CLI failure that means "not set up here" rather than "this call broke". */
function availabilityFromError(error: unknown, base: HostingAvailability): HostingAvailability | null {
  if (!(error instanceof HostingCliError)) return null
  if (error.kind === 'missing') return { ...base, state: 'cli-missing', message: error.message }
  if (error.kind === 'auth') return { ...base, state: 'unauthenticated', message: loginHint(error.tool, base.host) }
  return null
}

function friendly(error: unknown): Error {
  if (error instanceof HostingCliError && error.kind === 'rate-limit') {
    return new Error(`${error.tool === 'gh' ? 'GitHub' : 'GitLab'} is temporarily limiting requests. Try again shortly.`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

async function hostingContext(cwd: string): Promise<{ availability: HostingAvailability; ctx: HostingContext | null; provider: HostingProvider | null }> {
  const { availability, remote } = await resolveHostingRemote(cwd)
  if (!remote) return { availability, ctx: null, provider: null }
  return { availability, ctx: { cwd, remote, run: runHostingCli }, provider: PROVIDERS[remote.provider] }
}

async function requireContext(cwd: string): Promise<{ ctx: HostingContext; provider: HostingProvider }> {
  const { availability, ctx, provider } = await hostingContext(cwd)
  if (!ctx || !provider) throw new Error(availability.message ?? 'No GitHub or GitLab remote')
  return { ctx, provider }
}

export function registerHostingHandlers({ handle, workspaces, workspaceRoot }: HandlerContext): void {
  async function project(projectId: string): Promise<Project> {
    const found = (await workspaces.snapshot()).projects.find((p) => p.id === projectId)
    if (!found) throw new Error(`Unknown project ${projectId}`)
    return found
  }

  handle(HARNESS_METHODS.hostingReview, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const branch = await currentBranch(root)
    const { availability, ctx, provider } = await hostingContext(root)
    if (!ctx || !provider || !branch) return { availability, branch, review: null }
    try {
      const review = await reviews.get(`${root}|${branch}`, () => provider.reviewForBranch(ctx, branch), p.force)
      return { availability, branch, review }
    } catch (error) {
      const unavailable = availabilityFromError(error, availability)
      if (unavailable) return { availability: unavailable, branch, review: null }
      throw friendly(error)
    }
  })

  handle(HARNESS_METHODS.hostingReviewSummaries, async () => {
    const byProject = new Map<string, { project: Project; workspaceIds: Map<string, string> }>()
    for (const { workspace, project } of workspaces.projectWorkspaces()) {
      if (project.kind !== 'git' || !workspace.branch) continue
      const entry = byProject.get(project.id) ?? { project, workspaceIds: new Map() }
      entry.workspaceIds.set(workspace.id, workspace.branch)
      byProject.set(project.id, entry)
    }
    const results = await Promise.all(
      [...byProject.values()].map(async ({ project, workspaceIds }) => {
        try {
          const { ctx, provider } = await hostingContext(project.path)
          if (!ctx || !provider) return []
          const recent = await summaries.get(project.path, () => provider.recentReviewsByBranch(ctx))
          return [...workspaceIds].flatMap(([workspaceId, branch]) => {
            const review = recent.get(branch)
            return review ? [{ workspaceId, review }] : []
          })
        } catch {
          // Cards stay without a review badge; the panel reports the reason.
          return []
        }
      })
    )
    return results.flat()
  })

  handle(HARNESS_METHODS.hostingChecks, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const { ctx, provider } = await requireContext(root)
    const list = await checks.get(`${root}#${p.number}`, () => provider.checks(ctx, p.number), p.force).catch((e) => {
      throw friendly(e)
    })
    return { checks: list, status: rollUpChecks(list) }
  })

  handle(HARNESS_METHODS.hostingReviewComments, async (p) => {
    const { ctx, provider } = await requireContext(workspaceRoot(p.workspaceId))
    return { comments: await provider.comments(ctx, p.number).catch((e) => Promise.reject(friendly(e))) }
  })

  handle(HARNESS_METHODS.hostingReviewFiles, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const { ctx, provider } = await requireContext(root)
    const result = await provider.reviewFiles(ctx, p.number).catch((e) => Promise.reject(friendly(e)))
    const { base, head } = await reviewDiffRevisions(root, ctx.remote, provider, p.number, result)
    return { files: result.files, base, head }
  })

  handle(HARNESS_METHODS.hostingCreateDefaults, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const { workspace, project } = workspaces.requireWorkspace(p.workspaceId)
    const { ctx } = await requireContext(root)
    const branch = (await currentBranch(root)) ?? workspace.branch ?? ''
    return createReviewDefaults(root, ctx.remote, branch, await workspaces.baseRefOf(project))
  })

  handle(HARNESS_METHODS.hostingCreateReview, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const branch = await currentBranch(root)
    if (!branch) throw new Error('Check out a branch before creating a review')
    if (!p.title.trim()) throw new Error('A title is required')
    const { ctx, provider } = await requireContext(root)
    const url = await provider
      .createReview(ctx, { title: p.title.trim(), body: p.body, base: p.base, head: branch, draft: p.draft })
      .catch((e) => Promise.reject(friendly(e)))
    summaries.invalidate(root)
    const review = await reviews.get(`${root}|${branch}`, () => provider.reviewForBranch(ctx, branch), true).catch(() => null)
    return { review, url: review?.url ?? url }
  })

  handle(HARNESS_METHODS.hostingWorkItems, async (p) => {
    const { path } = await project(p.projectId)
    const { availability, ctx, provider } = await hostingContext(path)
    if (!ctx || !provider) return { availability, items: [] }
    const limit = Math.min(Math.max(p.limit ?? 30, 1), 100)
    const search = p.search ?? ''
    try {
      const items = await workItems.get(`${path}|${p.kind}|${p.preset}|${search}|${limit}`, () =>
        provider.workItems(ctx, p.kind, p.preset, search, limit)
      )
      return { availability, items }
    } catch (error) {
      const unavailable = availabilityFromError(error, availability)
      if (unavailable) return { availability: unavailable, items: [] }
      throw friendly(error)
    }
  })

  handle(HARNESS_METHODS.hostingWorkItem, async (p) => {
    const { ctx, provider } = await requireContext((await project(p.projectId)).path)
    return provider.workItem(ctx, p.kind, p.number).catch((e) => Promise.reject(friendly(e)))
  })

  handle(HARNESS_METHODS.hostingCheckoutReview, async (p) => {
    const { path } = await project(p.projectId)
    const { ctx, provider } = await requireContext(path)
    const review = await provider.workItem(ctx, 'review', p.number).catch((e) => Promise.reject(friendly(e)))
    return { branch: await checkoutReviewBranch(path, ctx.remote, provider, review) }
  })
}
