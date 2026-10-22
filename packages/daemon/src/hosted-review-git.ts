import type { CreateReviewDefaults } from '@acp-harness/protocol'
import { branchExists, git } from './git-cli.ts'
import type { HostingProvider } from './hosting-provider.ts'
import type { HostingRemote } from './hosting-remote.ts'

// Local git work around hosted reviews: making their commits available to diff, a branch to check
// out, and the create-review defaults drawn from the branch's commits.

const FETCH_TIMEOUT = 120_000

async function hasCommit(cwd: string, sha: string): Promise<boolean> {
  return git(cwd, ['cat-file', '-e', `${sha}^{commit}`], { quiet: true }).then(
    () => true,
    () => false
  )
}

/** Local revisions for a review's three-dot diff, fetching the head (and base) only when missing. */
export async function reviewDiffRevisions(
  cwd: string,
  remote: HostingRemote,
  provider: HostingProvider,
  number: number,
  refs: { baseSha: string | null; headSha: string | null; baseRefName: string }
): Promise<{ base: string; head: string }> {
  let head = refs.headSha
  if (!head || !(await hasCommit(cwd, head))) {
    await git(cwd, ['fetch', '--no-tags', remote.remote, provider.reviewHeadRef(number)], { timeoutMs: FETCH_TIMEOUT })
    head = refs.headSha && (await hasCommit(cwd, refs.headSha)) ? refs.headSha : await git(cwd, ['rev-parse', 'FETCH_HEAD'])
  }
  let base = refs.baseSha && (await hasCommit(cwd, refs.baseSha)) ? refs.baseSha : null
  if (!base && refs.baseRefName) {
    await git(cwd, ['fetch', '--no-tags', remote.remote, refs.baseRefName], { timeoutMs: FETCH_TIMEOUT }).catch(() => undefined)
    base = refs.baseSha && (await hasCommit(cwd, refs.baseSha)) ? refs.baseSha : `${remote.remote}/${refs.baseRefName}`
  }
  if (!base) throw new Error('The review base is not available locally')
  const mergeBase = await git(cwd, ['merge-base', base, head], { quiet: true }).catch(() => base!)
  return { base: mergeBase.trim(), head }
}

const LINK_KEY = 'acpHarnessReview'

/** The review a branch was checked out for (Orca's linked PR), so fork heads still find theirs. */
export async function linkedReviewNumber(cwd: string, branch: string): Promise<number | null> {
  const out = await git(cwd, ['config', '--get', `branch.${branch}.${LINK_KEY}`], { quiet: true }).catch(() => '')
  const number = Number(out.trim())
  return Number.isInteger(number) && number > 0 ? number : null
}

async function linkReview(cwd: string, branch: string, number: number): Promise<string> {
  await git(cwd, ['config', `branch.${branch}.${LINK_KEY}`, String(number)])
  return branch
}

/**
 * A local branch with the review's head for a new worktree. Same-repository reviews get their own
 * branch name tracking the remote; fork heads land on `pr-<n>` / `mr-<n>`.
 */
export async function checkoutReviewBranch(
  cwd: string,
  remote: HostingRemote,
  provider: HostingProvider,
  review: { number: number; headRefName?: string; isCrossRepository?: boolean }
): Promise<string> {
  const head = review.headRefName
  if (head && !review.isCrossRepository) {
    if (await branchExists(cwd, head)) return linkReview(cwd, head, review.number)
    await git(cwd, ['fetch', '--no-tags', remote.remote, `+refs/heads/${head}:refs/remotes/${remote.remote}/${head}`], {
      timeoutMs: FETCH_TIMEOUT
    })
    await git(cwd, ['branch', '--track', head, `${remote.remote}/${head}`])
    return linkReview(cwd, head, review.number)
  }
  const branch = `${provider.id === 'gitlab' ? 'mr' : 'pr'}-${review.number}`
  if (!(await branchExists(cwd, branch))) {
    await git(cwd, ['fetch', '--no-tags', remote.remote, `${provider.reviewHeadRef(review.number)}:refs/heads/${branch}`], {
      timeoutMs: FETCH_TIMEOUT
    })
  }
  return linkReview(cwd, branch, review.number)
}

/** "fix-login_bug" → "Fix login bug" (Orca's humanizeBranchSlug, roughly). */
export function humanizeBranch(branch: string): string {
  const leaf = (branch.split('/').pop() ?? branch).replace(/[-_]+/g, ' ').trim()
  return leaf ? leaf[0]!.toUpperCase() + leaf.slice(1) : branch
}

/** Title and body as `gh pr create --fill` would: one commit speaks for itself, several become a list. */
export async function createReviewDefaults(
  cwd: string,
  remote: HostingRemote,
  branch: string,
  defaultBaseRef: string
): Promise<CreateReviewDefaults> {
  const prefix = `${remote.remote}/`
  const base = defaultBaseRef.startsWith(prefix) ? defaultBaseRef.slice(prefix.length) : defaultBaseRef.replace(/^refs\/heads\//, '')
  const refsOut = await git(cwd, ['for-each-ref', '--count=300', '--sort=-committerdate', '--format=%(refname:short)', `refs/remotes/${remote.remote}`]).catch(() => '')
  const remoteBranches = refsOut.split('\n').filter((ref) => ref && !ref.endsWith('/HEAD') && ref !== remote.remote)
  const bases = [...new Set(remoteBranches.map((ref) => ref.slice(prefix.length)).filter((b) => b && b !== branch))]
  const baseRef = remoteBranches.includes(`${prefix}${base}`) ? `${prefix}${base}` : base
  const log = await git(cwd, ['log', '--max-count=50', '--format=%s%x1f%b%x1e', `${baseRef}..HEAD`], { quiet: true }).catch(() => '')
  const commits = log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = '', body = ''] = entry.split('\x1f')
      return { subject: subject.trim(), body: body.trim() }
    })
  const only = commits.length === 1 ? commits[0]! : null
  return {
    title: only ? only.subject : humanizeBranch(branch),
    body: only ? only.body : commits.length > 1 ? commits.map((c) => `- ${c.subject}`).reverse().join('\n') : '',
    base,
    bases: bases.includes(base) ? bases : [base, ...bases],
    commitCount: commits.length
  }
}
