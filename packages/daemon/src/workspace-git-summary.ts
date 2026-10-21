import type { Workspace, WorkspaceInspection, WorkspaceSummary } from '@acp-harness/protocol'
import { git } from './git-cli.ts'

// Card badges and delete-dialog facts. Git 2.25: diff --numstat, rev-list --left-right --count, @{u}.

export async function workspaceSummary(workspace: Workspace, baseRef: string): Promise<WorkspaceSummary | null> {
  const cwd = workspace.path
  const [numstat, untracked, upstream] = await Promise.all([
    git(cwd, ['diff', '--numstat', 'HEAD'], { quiet: true }).catch(() => null),
    git(cwd, ['ls-files', '--others', '--exclude-standard'], { quiet: true }).catch(() => ''),
    upstreamOf(cwd)
  ])
  // No HEAD (an unborn branch) or not a repository: nothing to badge.
  if (numstat === null) return null
  let additions = 0
  let deletions = 0
  let changedFiles = 0
  for (const line of numstat.split('\n')) {
    if (!line) continue
    const [added, deleted] = line.split('\t')
    changedFiles++
    additions += Number(added) || 0
    deletions += Number(deleted) || 0
  }
  changedFiles += untracked ? untracked.split('\n').length : 0

  const compareRef = upstream ?? (workspace.isPrimary ? null : baseRef)
  const counts = compareRef ? await leftRight(cwd, compareRef) : null
  const aheadOfBase = compareRef === baseRef ? (counts?.ahead ?? null) : await countRange(cwd, `${baseRef}..HEAD`)
  return {
    workspaceId: workspace.id,
    additions,
    deletions,
    changedFiles,
    ahead: counts?.ahead ?? null,
    behind: counts?.behind ?? null,
    compareRef,
    merged: !workspace.isPrimary && changedFiles === 0 && aheadOfBase === 0
  }
}

export async function inspectWorkspace(workspace: Workspace, baseRef: string): Promise<WorkspaceInspection> {
  const status = await git(workspace.path, ['status', '--porcelain=v1', '--untracked-files=all'], { quiet: true }).catch(
    () => ''
  )
  let modifiedFiles = 0
  let untrackedFiles = 0
  for (const line of status.split('\n')) {
    if (!line) continue
    if (line.startsWith('??')) untrackedFiles++
    else modifiedFiles++
  }
  const compare = (await upstreamOf(workspace.path)) ?? baseRef
  return { modifiedFiles, untrackedFiles, unpushedCommits: await countRange(workspace.path, `${compare}..HEAD`) }
}

async function upstreamOf(cwd: string): Promise<string | null> {
  return git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { quiet: true }).catch(() => null)
}

async function leftRight(cwd: string, ref: string): Promise<{ ahead: number; behind: number } | null> {
  const out = await git(cwd, ['rev-list', '--left-right', '--count', `${ref}...HEAD`], { quiet: true }).catch(
    () => null
  )
  const [behind, ahead] = out?.split(/\s+/).map(Number) ?? []
  return behind === undefined || ahead === undefined || Number.isNaN(behind) ? null : { ahead, behind }
}

async function countRange(cwd: string, range: string): Promise<number | null> {
  const out = await git(cwd, ['rev-list', '--count', range], { quiet: true }).catch(() => null)
  return out === null ? null : Number(out)
}
