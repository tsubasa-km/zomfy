import { currentBranch, git, GitError } from './git-cli.ts'
import { gitStatus } from './git-changes.ts'

// Push / pull / fetch / sync after Orca's main/git/remote.ts. Everything runs on the daemon's host
// with prompts disabled (git-cli), so missing credentials fail fast and surface as a clean message.

const NETWORK_TIMEOUT_MS = 120_000
const net = { timeoutMs: NETWORK_TIMEOUT_MS }

export type RemoteOperation = 'push' | 'pull' | 'fetch' | 'sync'

export async function gitPush(cwd: string, options: { forceWithLease?: boolean } = {}): Promise<void> {
  await normalizeErrors('push', () => push(cwd, options.forceWithLease ?? false))
}

export async function gitPull(cwd: string, options: { ffOnly?: boolean } = {}): Promise<void> {
  await normalizeErrors('pull', () => pull(cwd, options.ffOnly ? ['--ff-only'] : []))
}

export async function gitFetch(cwd: string): Promise<void> {
  await normalizeErrors('fetch', () => git(cwd, ['fetch', '--prune'], net))
}

/** Orca's syncBranch: fetch; a rebased branch force-pushes with lease, otherwise pull then push what is left ahead. */
export async function gitSync(cwd: string): Promise<void> {
  await normalizeErrors('sync', async () => {
    await git(cwd, ['fetch', '--prune'], net)
    const before = (await gitStatus(cwd)).upstream
    if (!before?.hasUpstream) throw new Error('no upstream')
    if (before.ahead > 0 && before.behind > 0 && before.behindArePatchEquivalent) {
      await push(cwd, true)
      return
    }
    if (before.behind > 0) await pull(cwd, [])
    const after = (await gitStatus(cwd)).upstream
    if (after && after.ahead > 0) await push(cwd, false)
  })
}

async function push(cwd: string, forceWithLease: boolean): Promise<void> {
  const branch = await currentBranch(cwd)
  if (!branch) throw new Error('Check out a branch before pushing commits.')
  const lease = forceWithLease ? ['--force-with-lease'] : []
  const remote = await configValue(cwd, `branch.${branch}.remote`)
  const merge = await configValue(cwd, `branch.${branch}.merge`)
  if (remote && remote !== '.' && merge) {
    // Explicit refspec: push.default=simple refuses when the upstream name differs from the branch.
    await git(cwd, ['push', ...lease, remote, `HEAD:${merge}`], net)
    return
  }
  // Publish: origin (or the only remote) gets a same-named branch, tracked from now on.
  const remotes = (await git(cwd, ['remote'])).split('\n').filter(Boolean)
  const target = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!target) throw new Error('No remote is configured for this repository. Add one to publish the branch.')
  await git(cwd, ['push', ...lease, '--set-upstream', target, `HEAD:refs/heads/${branch}`], net)
}

async function pull(cwd: string, args: string[]): Promise<void> {
  try {
    await git(cwd, ['pull', ...args], net)
  } catch (error) {
    // Git 2.27+ refuses divergent pulls without a pull.rebase policy; retry as the historical merge default.
    if (!args.includes('--ff-only') && error instanceof Error && DIVERGENT_PULL.test(error.message)) {
      await git(cwd, ['pull', '--no-rebase', ...args], net)
      return
    }
    throw error
  }
}

async function configValue(cwd: string, key: string): Promise<string | null> {
  return git(cwd, ['config', '--get', key], { quiet: true }).then(
    (v) => v.trim() || null,
    () => null
  )
}

async function normalizeErrors(operation: RemoteOperation, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (error) {
    throw new Error(normalizeGitErrorMessage(error, operation))
  }
}

const DIVERGENT_PULL = /Need to specify how to reconcile divergent branches|divergent branches and need to specify how to reconcile them/i
const USERPASS_URL = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi
const HTTPS_TOKEN_URL = /(https?:\/\/)[^\s/@:]+@/gi

/** Orca's shared/git-remote-error.ts: credential-scrubbed, one actionable line. */
export function normalizeGitErrorMessage(error: unknown, operation: RemoteOperation): string {
  if (!(error instanceof Error)) return 'Git remote operation failed.'
  const raw = (error instanceof GitError && error.stderr ? error.stderr : error.message)
    .replace(USERPASS_URL, '$1')
    .replace(HTTPS_TOKEN_URL, '$1')
  const isPush = operation === 'push' || operation === 'sync'
  if (isPush && (raw.includes('non-fast-forward') || raw.includes('fetch first'))) {
    return 'Push rejected: remote has newer commits (non-fast-forward). Please pull or sync first.'
  }
  if (raw.includes('stale info')) return 'Force push rejected: the remote branch moved since the last fetch. Fetch and try again.'
  if (
    raw.includes('could not read Username') ||
    raw.includes('Authentication failed') ||
    raw.includes('Permission denied (publickey') ||
    raw.includes('terminal prompts disabled')
  ) {
    return 'Authentication failed. Check your remote credentials.'
  }
  if (raw.includes('Could not resolve host') || raw.includes('Network is unreachable')) return 'Network error. Check your connection.'
  if (raw.includes('timed out after')) return `${capitalize(operation)} timed out. Check your connection and try again.`
  if (raw.includes('no tracking information') || raw.includes('no upstream') || raw === 'no upstream') {
    return 'Branch has no upstream. Publish the branch first.'
  }
  if (DIVERGENT_PULL.test(raw)) {
    return 'Pull needs a Git pull policy for divergent branches: git config pull.rebase false (merge), true (rebase), or pull.ff only.'
  }
  if (raw.includes('Your local changes to the following files would be overwritten') || raw.includes('Your local changes would be overwritten')) {
    return 'Pull would overwrite local changes. Commit, stash, or discard them before pulling.'
  }
  if (raw.includes('untracked working tree files would be overwritten')) {
    return 'Pull would overwrite untracked files. Move, remove, or add them before pulling.'
  }
  if (raw.includes('Not possible to fast-forward')) return 'Cannot fast-forward: the branch has local commits. Use Pull or Sync instead.'
  if (raw.includes('CONFLICT')) return 'Pull stopped on merge conflicts. Resolve them, then commit.'
  // The last stderr line is the diagnostic; the full blob can leak local paths.
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.at(-1) ?? `${capitalize(operation)} failed.`
}

function capitalize(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1)
}
