import type { FileDiff, GitChange, GitDiffCompare, GitDiscardArea, GitFileStatus, GitStatusResult, GitUpstreamStatus } from '@acp-harness/protocol'
import { currentBranch, git, isGitRepository } from './git-cli.ts'

// Commands stay within Git 2.25: porcelain v1, numstat, restore (2.23). No --pathspec-from-file (2.26).

export async function gitStatus(cwd: string): Promise<GitStatusResult> {
  if (!(await isGitRepository(cwd))) return { isRepo: false, branch: null, staged: [], unstaged: [] }
  const [porcelain, stagedStats, unstagedStats, branch, head] = await Promise.all([
    git(cwd, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all']),
    numstat(cwd, ['diff', '--cached', '--numstat', '-z']),
    numstat(cwd, ['diff', '--numstat', '-z']),
    currentBranch(cwd),
    git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], { quiet: true }).catch(() => null)
  ])
  const staged: GitChange[] = []
  const unstaged: GitChange[] = []
  const records = porcelain.split('\0')
  let upstream: GitUpstreamStatus | null = null
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    if (record.startsWith('## ')) {
      upstream = branch ? parseBranchHeader(record) : null
      continue
    }
    const x = record[0]!
    const y = record[1]!
    const path = record.slice(3)
    // Renames carry the old path as the next NUL-separated record.
    const oldPath = x === 'R' || x === 'C' ? records[++i] : undefined
    if (x === '?' && y === '?') {
      unstaged.push({ path, status: 'untracked', additions: null, deletions: null })
      continue
    }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      unstaged.push({ path, status: 'conflicted', additions: null, deletions: null })
      continue
    }
    if (x !== ' ') {
      staged.push({ path, ...(oldPath ? { oldPath } : {}), status: statusOf(x), ...stagedStats.get(path) ?? noStats })
    }
    if (y !== ' ') {
      unstaged.push({ path, status: statusOf(y), ...unstagedStats.get(path) ?? noStats })
    }
  }
  if (upstream && upstream.ahead > 0 && upstream.behind > 0) {
    upstream.behindArePatchEquivalent = await behindArePatchEquivalent(cwd)
  }
  return { isRepo: true, branch, staged, unstaged, head: head || null, upstream }
}

/** `## main...origin/main [ahead 1, behind 2]`; `[gone]` means the remote branch was deleted. */
function parseBranchHeader(header: string): GitUpstreamStatus {
  const match = /^## (?:No commits yet on |Initial commit on )?(\S+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(header)
  const upstreamName = match?.[2] ?? null
  const tracking = match?.[3] ?? ''
  if (!upstreamName || tracking === 'gone') return { hasUpstream: false, upstreamName: null, ahead: 0, behind: 0 }
  return {
    hasUpstream: true,
    upstreamName,
    ahead: Number(/ahead (\d+)/.exec(tracking)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(tracking)?.[1] ?? 0)
  }
}

/** Orca's force-with-lease probe: every upstream-only commit is `=` under --cherry-mark. */
async function behindArePatchEquivalent(cwd: string): Promise<boolean> {
  const out = await git(cwd, ['log', '--no-color', '--oneline', '--cherry-mark', '--right-only', '--max-count=200', 'HEAD...@{upstream}', '--'], {
    quiet: true
  }).catch(() => '')
  const lines = out.split('\n').filter(Boolean)
  return lines.length > 0 && lines.every((line) => line.startsWith('='))
}

export async function gitDiff(cwd: string, path: string, staged: boolean, compare?: GitDiffCompare): Promise<FileDiff> {
  assertWorkspacePaths([path])
  if (compare) {
    assertRevisions([compare.base, compare.head])
    const patch = await git(cwd, ['diff', '--no-color', '--no-ext-diff', compare.base, compare.head, '--', path])
    return { path, staged, patch, binary: /^Binary files /m.test(patch) }
  }
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', path], { quiet: true }).then(
    () => true,
    () => false
  )
  // An untracked file diffs against nothing.
  const patch =
    !tracked && !staged
      ? await noIndexDiff(cwd, path)
      : await git(cwd, ['diff', '--no-color', '--no-ext-diff', ...(staged ? ['--cached'] : []), '--', path])
  return { path, staged, patch, binary: /^Binary files /m.test(patch) }
}

export async function gitStage(cwd: string, paths: string[]): Promise<void> {
  assertWorkspacePaths(paths)
  for (const chunk of chunks(paths)) await git(cwd, ['add', '-A', '--', ...chunk])
}

export async function gitUnstage(cwd: string, paths: string[]): Promise<void> {
  assertWorkspacePaths(paths)
  const hasHead = await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], { quiet: true }).then(
    () => true,
    () => false
  )
  // `restore --staged` needs a HEAD to restore from; before the first commit, unstaging is removal from the index.
  for (const chunk of chunks(paths)) {
    await git(cwd, hasHead ? ['restore', '--staged', '--', ...chunk] : ['rm', '--cached', '-r', '-q', '--', ...chunk])
  }
}

/** Orca's discard: revert tracked paths, delete untracked ones; a staged discard also drops the index entry. */
export async function gitDiscard(cwd: string, paths: string[], area: GitDiscardArea): Promise<void> {
  assertWorkspacePaths(paths)
  if (paths.length === 0) return
  if (area === 'untracked') {
    // Pathspec-scoped clean never follows symlinked parents the way a recursive delete could.
    for (const chunk of chunks(paths)) await git(cwd, ['clean', '-ffdq', '--', ...chunk])
    return
  }
  if (area === 'unstaged') {
    for (const chunk of chunks(paths)) await git(cwd, ['restore', '--worktree', '--', ...chunk])
    return
  }
  const inHead = new Set<string>()
  for (const chunk of chunks(paths)) {
    const out = await git(cwd, ['ls-tree', '-z', '--name-only', 'HEAD', '--', ...chunk], { quiet: true }).catch(() => '')
    for (const p of out.split('\0')) if (p) inHead.add(p)
  }
  const restore = paths.filter((p) => inHead.has(p))
  const added = paths.filter((p) => !inHead.has(p))
  for (const chunk of chunks(restore)) await git(cwd, ['restore', '--staged', '--worktree', '--source=HEAD', '--', ...chunk])
  for (const chunk of chunks(added)) await git(cwd, ['rm', '-f', '-r', '-q', '--', ...chunk])
}

export async function gitCommit(cwd: string, message: string, amend = false): Promise<string> {
  if (!message.trim() && !amend) throw new Error('Commit message is empty')
  await git(cwd, ['commit', ...(amend ? ['--amend'] : []), ...(message.trim() ? ['-m', message] : ['--no-edit'])])
  return git(cwd, ['rev-parse', '--short', 'HEAD'])
}

/** Changed files between two revisions, with line counts. */
export async function changesBetween(cwd: string, base: string, head: string): Promise<GitChange[]> {
  assertRevisions([base, head])
  const [nameStatus, stats] = await Promise.all([
    git(cwd, ['diff', '--no-color', '--name-status', '-z', '-M', base, head, '--']),
    numstat(cwd, ['diff', '--numstat', '-z', '-M', base, head, '--'])
  ])
  const entries: GitChange[] = []
  const records = nameStatus.split('\0')
  for (let i = 0; i < records.length; i++) {
    const code = records[i]
    if (!code) continue
    const letter = code[0]!
    if (letter === 'R' || letter === 'C') {
      const oldPath = records[++i]!
      const path = records[++i]!
      entries.push({ path, oldPath, status: 'renamed', ...stats.get(path) ?? noStats })
      continue
    }
    const path = records[++i]!
    entries.push({ path, status: letter === 'U' ? 'conflicted' : statusOf(letter), ...stats.get(path) ?? noStats })
  }
  return entries
}

const noStats = { additions: null, deletions: null }
const CHUNK = 200

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

/** Paths come from the client; refuse anything that could name a file outside the workspace. */
function assertWorkspacePaths(paths: string[]): void {
  for (const p of paths) {
    if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.split(/[\\/]/).includes('..')) {
      throw new Error(`Path "${p}" is outside the workspace`)
    }
  }
}

/** A revision starting with `-` would be read as an option. */
export function assertRevisions(revisions: string[]): void {
  for (const r of revisions) if (!r || r.startsWith('-')) throw new Error(`Invalid revision "${r}"`)
}

function statusOf(code: string): GitFileStatus {
  switch (code) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    default:
      return 'modified'
  }
}

async function numstat(cwd: string, args: string[]): Promise<Map<string, { additions: number | null; deletions: number | null }>> {
  const out = await git(cwd, args).catch(() => '')
  const stats = new Map<string, { additions: number | null; deletions: number | null }>()
  const records = out.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const [added, deleted, path] = record.split('\t')
    // Renames list "added\tdeleted\t" then old and new paths as separate records.
    const target = path === '' ? records[(i += 2)] : path
    if (!target) continue
    stats.set(target, {
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted)
    })
  }
  return stats
}

/** git's exit code 1 means "files differ"; capture its stdout ourselves for that case. */
async function noIndexDiff(cwd: string, path: string): Promise<string> {
  const proc = Bun.spawn(['git', 'diff', '--no-color', '--no-index', '--', '/dev/null', path], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
    windowsHide: true
  })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text.replace(/\n$/, '')
}
