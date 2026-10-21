import type { FileDiff, GitChange, GitFileStatus, GitStatusResult } from '@acp-harness/protocol'
import { currentBranch, git, isGitRepository } from './git-cli.ts'

// Commands stay within Git 2.25: porcelain v1, numstat, restore --staged (2.23).

export async function gitStatus(cwd: string): Promise<GitStatusResult> {
  if (!(await isGitRepository(cwd))) return { isRepo: false, branch: null, staged: [], unstaged: [] }
  const [porcelain, stagedStats, unstagedStats, branch] = await Promise.all([
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    numstat(cwd, ['diff', '--cached', '--numstat', '-z']),
    numstat(cwd, ['diff', '--numstat', '-z']),
    currentBranch(cwd)
  ])
  const staged: GitChange[] = []
  const unstaged: GitChange[] = []
  const records = porcelain.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
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
  return { isRepo: true, branch, staged, unstaged }
}

export async function gitDiff(cwd: string, path: string, staged: boolean): Promise<FileDiff> {
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', path], { quiet: true }).then(
    () => true,
    () => false
  )
  // An untracked file diffs against nothing.
  const patch =
    !tracked && !staged
      ? await noIndexDiff(cwd, path)
      : await git(cwd, ['diff', ...(staged ? ['--cached'] : []), '--', path])
  return { path, staged, patch, binary: /^Binary files /m.test(patch) }
}

export async function gitStage(cwd: string, paths: string[]): Promise<void> {
  await git(cwd, ['add', '--', ...paths])
}

export async function gitUnstage(cwd: string, paths: string[]): Promise<void> {
  await git(cwd, ['restore', '--staged', '--', ...paths])
}

export async function gitCommit(cwd: string, message: string): Promise<string> {
  if (!message.trim()) throw new Error('Commit message is empty')
  await git(cwd, ['commit', '-m', message])
  return git(cwd, ['rev-parse', '--short', 'HEAD'])
}

const noStats = { additions: null, deletions: null }

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
  const proc = Bun.spawn(['git', 'diff', '--no-index', '--', '/dev/null', path], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
    windowsHide: true
  })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text.replace(/\n$/, '')
}
