import type { GitBranchCompareResult, GitBranchCompareSummary } from '@acp-harness/protocol'
import { changesBetween } from './git-changes.ts'
import { git } from './git-cli.ts'
import { defaultBaseRef } from './workspace-manager.ts'

// Orca's "Committed on Branch": what HEAD changed since it forked from the base ref
// (main/git/source-control/branch-compare.ts), compared commit-to-commit, never the working tree.

export async function gitBranchCompare(cwd: string, requestedBaseRef?: string | null): Promise<GitBranchCompareResult> {
  const baseRef = requestedBaseRef?.trim() || (await defaultBaseRef(cwd))
  const summary: GitBranchCompareSummary = { baseRef, baseOid: null, headOid: null, mergeBase: null, changedFiles: 0, status: 'ready' }
  const [headOid, baseOid] = await Promise.all([resolveCommit(cwd, 'HEAD'), resolveCommit(cwd, baseRef)])
  if (!headOid) {
    return { summary: { ...summary, status: 'unborn-head', errorMessage: 'This branch has no commits yet, so compare-to-base is unavailable.' }, entries: [] }
  }
  summary.headOid = headOid
  if (!baseOid) {
    return { summary: { ...summary, status: 'invalid-base', errorMessage: `Base ref ${baseRef} could not be resolved in this repository.` }, entries: [] }
  }
  summary.baseOid = baseOid
  const mergeBase = await git(cwd, ['merge-base', baseOid, headOid], { quiet: true }).catch(() => '')
  if (!mergeBase) {
    return {
      summary: { ...summary, status: 'no-merge-base', errorMessage: `This branch and ${baseRef} do not share a merge base.` },
      entries: []
    }
  }
  summary.mergeBase = mergeBase
  try {
    const [entries, counts] = await Promise.all([
      mergeBase === headOid ? Promise.resolve([]) : changesBetween(cwd, mergeBase, headOid),
      git(cwd, ['rev-list', '--left-right', '--count', `${baseOid}...${headOid}`])
    ])
    const [behind, ahead] = counts.split(/\s+/).map(Number)
    return { summary: { ...summary, changedFiles: entries.length, commitsAhead: ahead ?? 0, commitsBehind: behind ?? 0 }, entries }
  } catch (error) {
    return { summary: { ...summary, status: 'error', errorMessage: error instanceof Error ? error.message : 'Failed to load branch compare' }, entries: [] }
  }
}

/** Candidates for Orca's "Change Base Ref" picker; bounded so huge repos stay cheap. */
export async function gitBaseRefs(cwd: string): Promise<{ refs: string[]; defaultBaseRef: string }> {
  const [out, fallback] = await Promise.all([
    git(cwd, ['for-each-ref', '--count=500', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']).catch(() => ''),
    defaultBaseRef(cwd)
  ])
  const refs = out.split('\n').filter((r) => r && !r.endsWith('/HEAD'))
  return { refs, defaultBaseRef: fallback }
}

async function resolveCommit(cwd: string, ref: string): Promise<string | null> {
  if (!ref || ref.startsWith('-')) return null
  const out = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { quiet: true }).catch(() => '')
  return out.trim() || null
}
