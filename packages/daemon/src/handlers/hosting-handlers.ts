import {
  HARNESS_METHODS,
  type HostedCheck,
  type HostedReview,
  type HostedWorkItem,
  type HostingAvailability,
  type Project
} from '@zomfy/protocol'
import { currentBranch } from '../git-cli.ts'
import { githubHosting } from '../github-hosting.ts'
import { gitlabHosting } from '../gitlab-hosting.ts'
import { checkoutReviewBranch, createReviewDefaults, linkedReviewNumber, reviewDiffRevisions } from '../hosted-review-git.ts'
import { TtlCache } from '../hosting-cache.ts'
import { accountForRemote, loginArgv } from '../hosting-accounts.ts'
import { hostingAccounts } from '../hosting-account-service.ts'
import { HostingCliError, installHint, loginHint, runHostingCli, type HostingRunner } from '../hosting-cli.ts'
import { pickBranchReview, rollUpChecks, type HostingContext, type HostingProvider } from '../hosting-provider.ts'
import { parseRemoteUrl, providerForHost, resolveHostingRemote } from '../hosting-remote.ts'
import { expandHome } from '../repo-bootstrap.ts'
import { homedir } from 'node:os'
import type { HandlerContext } from './handler-context.ts'

// Caches keep gh/glab well inside rate limits: clients poll no faster than every 30s, and several
// panels asking at once share one call.
const reviews = new TtlCache<HostedReview | null>(30_000)
const summaries = new TtlCache<HostedReview[]>(60_000)
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

/**
 * Where a provider call runs; with the project, its gh/glab calls act as the project's account
 * when that matches the remote (docs/specs/project-hosting-accounts.md).
 */
export async function hostingContext(
  cwd: string,
  project?: Pick<Project, 'hostingAccount'> | null
): Promise<{ availability: HostingAvailability; ctx: HostingContext | null; provider: HostingProvider | null }> {
  const { availability, remote } = await resolveHostingRemote(cwd)
  if (!remote) return { availability, ctx: null, provider: null }
  const env = await hostingAccounts().env(accountForRemote(project?.hostingAccount, remote))
  const run: HostingRunner =
    Object.keys(env).length === 0 ? runHostingCli : (tool, dir, args, options = {}) => runHostingCli(tool, dir, args, { ...options, env: { ...env, ...options.env } })
  return { availability, ctx: { cwd, remote, run }, provider: PROVIDERS[remote.provider] }
}

/** The branch's linked review when it was checked out for one, else the one its head matches. */
async function branchReview(ctx: HostingContext, provider: HostingProvider, branch: string): Promise<HostedReview | null> {
  const linked = await linkedReviewNumber(ctx.cwd, branch)
  return linked ? provider.review(ctx, linked) : provider.reviewForBranch(ctx, branch)
}

async function requireContext(cwd: string, project: Pick<Project, 'hostingAccount'> | null): Promise<{ ctx: HostingContext; provider: HostingProvider }> {
  const { availability, ctx, provider } = await hostingContext(cwd, project)
  if (!ctx || !provider) throw new Error(availability.message ?? 'No GitHub or GitLab remote')
  return { ctx, provider }
}

export function registerHostingHandlers({ handle, workspaces, workspaceRoot, terminals }: HandlerContext): void {
  async function project(projectId: string): Promise<Project> {
    const found = (await workspaces.snapshot()).projects.find((p) => p.id === projectId)
    if (!found) throw new Error(`Unknown project ${projectId}`)
    return found
  }
  /** The workspace's project, whose account its calls use; null for the floating workspace. */
  function projectOf(workspaceId: string): Project | null {
    try {
      return workspaces.requireWorkspace(workspaceId).project
    } catch {
      return null
    }
  }

  handle(HARNESS_METHODS.hostingReview, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const branch = await currentBranch(root)
    const { availability, ctx, provider } = await hostingContext(root, projectOf(p.workspaceId))
    if (!ctx || !provider || !branch) return { availability, branch, review: null }
    try {
      const review = await reviews.get(`${root}|${branch}`, () => branchReview(ctx, provider, branch), p.force)
      return { availability, branch, review }
    } catch (error) {
      const unavailable = availabilityFromError(error, availability)
      if (unavailable) return { availability: unavailable, branch, review: null }
      throw friendly(error)
    }
  })

  handle(HARNESS_METHODS.hostingReviewSummaries, async () => {
    type Target = { workspaceId: string; path: string; branch: string }
    const byProject = new Map<string, { project: Project; targets: Target[] }>()
    for (const { workspace, project } of workspaces.projectWorkspaces()) {
      if (project.kind !== 'git' || !workspace.branch) continue
      const entry = byProject.get(project.id) ?? { project, targets: [] }
      entry.targets.push({ workspaceId: workspace.id, path: workspace.path, branch: workspace.branch })
      byProject.set(project.id, entry)
    }
    const results = await Promise.all(
      [...byProject.values()].map(async ({ project, targets }) => {
        try {
          const { ctx, provider } = await hostingContext(project.path, project)
          if (!ctx || !provider) return []
          const recent = await summaries.get(project.path, () => provider.recentReviews(ctx))
          const linked = await Promise.all(targets.map((t) => linkedReviewNumber(t.path, t.branch)))
          return targets.flatMap((target, i) => {
            const number = linked[i]
            const review = number
              ? recent.find((r) => r.number === number)
              : pickBranchReview(recent.filter((r) => r.headRefName === target.branch && !r.isCrossRepository))
            return review ? [{ workspaceId: target.workspaceId, review }] : []
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
    const { ctx, provider } = await requireContext(root, projectOf(p.workspaceId))
    const list = await checks.get(`${root}#${p.number}`, () => provider.checks(ctx, p.number), p.force).catch((e) => {
      throw friendly(e)
    })
    return { checks: list, status: rollUpChecks(list) }
  })

  handle(HARNESS_METHODS.hostingReviewComments, async (p) => {
    const { ctx, provider } = await requireContext(workspaceRoot(p.workspaceId), projectOf(p.workspaceId))
    return { comments: await provider.comments(ctx, p.number).catch((e) => Promise.reject(friendly(e))) }
  })

  handle(HARNESS_METHODS.hostingReviewFiles, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const { ctx, provider } = await requireContext(root, projectOf(p.workspaceId))
    const result = await provider.reviewFiles(ctx, p.number).catch((e) => Promise.reject(friendly(e)))
    const { base, head } = await reviewDiffRevisions(root, ctx.remote, provider, p.number, result)
    return { files: result.files, base, head }
  })

  handle(HARNESS_METHODS.hostingCreateDefaults, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const { workspace, project } = workspaces.requireWorkspace(p.workspaceId)
    const { ctx } = await requireContext(root, project)
    const branch = (await currentBranch(root)) ?? workspace.branch ?? ''
    return createReviewDefaults(root, ctx.remote, branch, await workspaces.baseRefOf(project))
  })

  handle(HARNESS_METHODS.hostingCreateReview, async (p) => {
    const root = workspaceRoot(p.workspaceId)
    const branch = await currentBranch(root)
    if (!branch) throw new Error('Check out a branch before creating a review')
    if (!p.title.trim()) throw new Error('A title is required')
    const { ctx, provider } = await requireContext(root, projectOf(p.workspaceId))
    const url = await provider
      .createReview(ctx, { title: p.title.trim(), body: p.body, base: p.base, head: branch, draft: p.draft })
      .catch((e) => Promise.reject(friendly(e)))
    summaries.invalidate(root)
    const review = await reviews.get(`${root}|${branch}`, () => branchReview(ctx, provider, branch), true).catch(() => null)
    return { review, url: review?.url ?? url }
  })

  handle(HARNESS_METHODS.hostingWorkItems, async (p) => {
    const found = await project(p.projectId)
    const { path } = found
    const { availability, ctx, provider } = await hostingContext(path, found)
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
    const found = await project(p.projectId)
    const { ctx, provider } = await requireContext(found.path, found)
    return provider.workItem(ctx, p.kind, p.number).catch((e) => Promise.reject(friendly(e)))
  })

  handle(HARNESS_METHODS.hostingCheckoutReview, async (p) => {
    const found = await project(p.projectId)
    const { path } = found
    const { ctx, provider } = await requireContext(path, found)
    const review = await provider.workItem(ctx, 'review', p.number).catch((e) => Promise.reject(friendly(e)))
    return { branch: await checkoutReviewBranch(path, ctx.remote, provider, review) }
  })

  // docs/specs/project-hosting-accounts.md
  handle(HARNESS_METHODS.hostingAccounts, (p) => hostingAccounts().list(p.force === true))
  handle(HARNESS_METHODS.hostingAccountAddToken, (p) => {
    if (p.provider !== 'gitlab') throw new Error('Only GitLab tokens are kept by Zomfy; sign in to GitHub with gh')
    return hostingAccounts().addGitlabToken(p.host, p.token)
  })
  handle(HARNESS_METHODS.hostingAccountRemove, async (p) => {
    await hostingAccounts().remove(p)
    return {}
  })
  handle(HARNESS_METHODS.hostingAccountLogin, async (p) => {
    const host = p.host.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9.-]*(?::\d+)?$/.test(host)) throw new Error(` is not a host name`)
    const tool = p.provider === 'github' ? 'gh' : 'glab'
    const exe = Bun.which(tool)
    if (!exe) throw new Error(installHint(tool))
    const workspaceId = p.workspaceId ?? (await workspaces.snapshot()).floatingWorkspaceId
    return terminals.create({
      workspaceId,
      cwd: workspaceRoot(workspaceId),
      cols: 120,
      rows: 30,
      program: { argv: loginArgv(p.provider, host, exe), title: p.provider === 'github' ? 'Sign in to GitHub' : 'Sign in to GitLab' }
    })
  })
  handle(HARNESS_METHODS.hostingRemoteOf, async (p) => {
    if (p.path?.trim()) {
      const { remote } = await resolveHostingRemote(expandHome(p.path))
      return remote ? { provider: remote.provider, host: remote.host, repo: remote.path } : null
    }
    const parsed = p.url?.trim() ? parseRemoteUrl(p.url) : null
    if (!parsed) return null
    const provider = await providerForHost(parsed.host, homedir())
    return provider ? { provider, host: parsed.host, repo: parsed.path } : null
  })
}

