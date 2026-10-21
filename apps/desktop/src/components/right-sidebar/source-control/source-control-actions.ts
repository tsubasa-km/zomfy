import type { GitUpstreamStatus } from '@acp-harness/protocol'

// Orca's commit-area split button: the primary action ladder (shared/source-control-primary-action-decision.ts)
// and the chevron dropdown (source-control-dropdown-*-items.ts). Every dropdown row always renders,
// disabled with a reason, so the menu keeps its shape across states.

export type RemoteOpKind = 'push' | 'force_push' | 'pull' | 'fast_forward' | 'sync' | 'fetch' | 'publish'
export type PrimaryActionKind = 'commit' | 'stage' | RemoteOpKind
export type DropdownActionKind = 'commit' | 'commit_push' | 'commit_sync' | 'amend' | RemoteOpKind

export interface PrimaryAction {
  kind: PrimaryActionKind
  label: string
  title: string
  disabled: boolean
}

export type DropdownEntry =
  | { kind: 'separator'; id: string }
  | { kind: DropdownActionKind; label: string; title: string; disabled: boolean }

export interface ActionInputs {
  stagedCount: number
  hasStageableChanges: boolean
  hasMessage: boolean
  hasConflicts: boolean
  isCommitting: boolean
  remoteOp: RemoteOpKind | null
  /** undefined until status has loaded; null on a detached HEAD. */
  upstream: GitUpstreamStatus | null | undefined
  hasBranch: boolean
  hasCommits: boolean
}

const OP_LABEL: Record<RemoteOpKind, string> = {
  push: 'Push',
  force_push: 'Force Push',
  pull: 'Pull',
  fast_forward: 'Fast-forward',
  sync: 'Sync',
  fetch: 'Fetch',
  publish: 'Publish Branch'
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const countLabel = (base: string, n: number) => (n > 0 ? `${base} (${n})` : base)
const shouldForcePush = (u: GitUpstreamStatus | null | undefined) =>
  Boolean(u?.hasUpstream && u.ahead > 0 && u.behind > 0 && u.behindArePatchEquivalent)

export function resolvePrimaryAction(i: ActionInputs): PrimaryAction {
  const commit = (title: string, disabled: boolean): PrimaryAction => ({ kind: 'commit', label: 'Commit', title, disabled })
  if (i.isCommitting) return commit('Commit in progress…', true)
  if (i.remoteOp) {
    return { kind: i.remoteOp, label: OP_LABEL[i.remoteOp], title: `${OP_LABEL[i.remoteOp]} in progress…`, disabled: true }
  }
  if (i.hasConflicts) return commit('Resolve conflicts before committing', true)
  if (i.stagedCount > 0) return commit(i.hasMessage ? 'Commit staged changes' : 'Enter a commit message to commit', !i.hasMessage)
  if (i.hasStageableChanges) return { kind: 'stage', label: 'Stage All', title: 'Stage all changes', disabled: false }
  const u = i.upstream
  if (u === undefined || !i.hasCommits) return commit('Stage at least one file to commit', true)
  if (!i.hasBranch || u === null) {
    return { kind: 'publish', label: 'Publish Branch', title: 'Check out a branch before publishing commits.', disabled: true }
  }
  if (!u.hasUpstream) return { kind: 'publish', label: 'Publish Branch', title: 'Publish this branch to origin', disabled: false }
  if (u.ahead > 0 && u.behind > 0) {
    if (shouldForcePush(u)) {
      return {
        kind: 'force_push',
        label: 'Force Push',
        title: `Remote only has older copies of local commits. Force push ${plural(u.ahead, 'branch commit')} with lease to update ${u.upstreamName ?? 'the remote branch'}.`,
        disabled: false
      }
    }
    return { kind: 'sync', label: 'Sync', title: `Pull ${u.behind}, push ${u.ahead}`, disabled: false }
  }
  if (u.behind > 0) return { kind: 'pull', label: 'Pull', title: `Pull ${plural(u.behind, 'commit')}`, disabled: false }
  if (u.ahead > 0) return { kind: 'push', label: 'Push', title: `Push ${plural(u.ahead, 'commit')}`, disabled: false }
  return commit('Nothing to commit. Branch is up to date.', true)
}

export function resolveDropdownItems(i: ActionInputs): DropdownEntry[] {
  const busy = i.isCommitting || i.remoteOp !== null
  const u = i.upstream
  const loading = u === undefined
  const detached = !i.hasBranch || u === null
  const hasUpstream = Boolean(u?.hasUpstream)
  const ahead = u?.ahead ?? 0
  const behind = u?.behind ?? 0
  const forcePush = shouldForcePush(u)
  const upstreamName = u?.upstreamName

  const commitBlocked = busy
    ? 'Operation in progress…'
    : i.hasConflicts
      ? 'Resolve conflicts before committing'
      : i.stagedCount === 0
        ? 'Stage at least one file to commit'
        : !i.hasMessage
          ? 'Enter a commit message to commit'
          : null

  const commitPushTitle = loading
    ? 'Checking branch status…'
    : detached
      ? 'Check out a branch before pushing commits'
      : !hasUpstream
        ? 'Publish the branch first to push commits'
        : (commitBlocked ??
          (forcePush
            ? 'Commit staged changes and force push with lease'
            : behind > 0
              ? 'Commit staged changes and try to push'
              : 'Commit staged changes and push'))
  const commitSyncTitle = loading
    ? 'Checking branch status…'
    : detached
      ? 'Check out a branch before syncing commits'
      : !hasUpstream
        ? 'Publish the branch first to sync commits'
        : forcePush
          ? (commitBlocked ?? 'Use Commit & Force Push — remote only has older copies of local commits')
          : (commitBlocked ?? 'Commit, then pull and push')

  const pullTitle = (verb: string) =>
    loading
      ? 'Checking branch status…'
      : detached
        ? `Check out a branch before ${verb === 'Pull' ? 'pulling commits' : 'fast-forwarding'}`
        : !hasUpstream
          ? `Publish the branch first to ${verb === 'Pull' ? 'pull commits' : 'fast-forward'}`
          : forcePush
            ? `Nothing new to ${verb.toLowerCase()} — remote only has older copies of local commits`
            : behind === 0
              ? `Nothing to ${verb.toLowerCase()}`
              : verb === 'Fast-forward' && ahead > 0
                ? 'Try a fast-forward pull; git may reject local commits'
                : `${verb} ${plural(behind, 'commit')}`

  return [
    { kind: 'commit', label: 'Commit', title: commitBlocked ?? 'Commit staged changes', disabled: commitBlocked !== null },
    {
      kind: 'commit_push',
      label: forcePush ? 'Commit & Force Push' : 'Commit & Push',
      title: commitPushTitle,
      disabled: loading || detached || !hasUpstream || commitBlocked !== null
    },
    {
      kind: 'commit_sync',
      label: 'Commit & Sync',
      title: commitSyncTitle,
      disabled: loading || detached || !hasUpstream || forcePush || commitBlocked !== null
    },
    {
      kind: 'amend',
      label: 'Commit (Amend)',
      title: busy
        ? 'Operation in progress…'
        : !i.hasCommits
          ? 'There is no commit to amend yet'
          : i.hasConflicts
            ? 'Resolve conflicts before committing'
            : i.hasMessage
              ? 'Amend the last commit with the staged changes and this message'
              : 'Amend the last commit with the staged changes, keeping its message',
      disabled: busy || !i.hasCommits || i.hasConflicts
    },
    { kind: 'separator', id: 'before-remote' },
    {
      kind: 'push',
      label: countLabel('Push', ahead),
      title: detached
        ? 'Check out a branch before pushing commits'
        : !hasUpstream
          ? 'Push this branch and set an upstream if needed'
          : forcePush
            ? 'Try a regular push; git may require force push'
            : behind > 0 && ahead > 0
              ? 'Push local commits; git may require syncing first'
              : ahead === 0
                ? `Nothing to push${upstreamName ? ` to ${upstreamName}` : ''}`
                : `Push ${plural(ahead, 'commit')}`,
      disabled: busy || detached || loading
    },
    {
      kind: 'force_push',
      label: countLabel('Force Push', ahead),
      title: detached
        ? 'Check out a branch before force pushing commits'
        : !hasUpstream
          ? 'Publish this branch, replacing any remote branch of the same name'
          : ahead === 0
            ? `Nothing to force push${upstreamName ? ` to ${upstreamName}` : ''}`
            : `Force push ${plural(ahead, 'commit')} with lease to ${upstreamName ?? 'the remote branch'}`,
      disabled: busy || detached || loading
    },
    {
      kind: 'pull',
      label: countLabel('Pull', behind),
      title: pullTitle('Pull'),
      disabled: busy || loading || detached || !hasUpstream
    },
    {
      kind: 'fast_forward',
      label: countLabel('Fast-forward', behind),
      title: pullTitle('Fast-forward'),
      disabled: busy || loading || detached || !hasUpstream
    },
    {
      kind: 'sync',
      label: ahead === 0 && behind === 0 ? 'Sync' : `Sync (↓${behind} ↑${ahead})`,
      title: loading
        ? 'Checking branch status…'
        : detached
          ? 'Check out a branch before syncing commits'
          : !hasUpstream
            ? 'Publish the branch first to sync commits'
            : forcePush
              ? 'Use Force Push — remote only has older copies of local commits'
              : ahead === 0 && behind === 0
                ? 'Branch is up to date'
                : `Pull ${behind}, push ${ahead}`,
      disabled: busy || loading || detached || !hasUpstream || forcePush
    },
    { kind: 'fetch', label: 'Fetch', title: 'Fetch from remote without merging', disabled: busy },
    {
      kind: 'publish',
      label: detached ? 'No Branch' : 'Publish Branch',
      title: loading
        ? 'Checking branch status…'
        : detached
          ? 'Check out a branch before publishing commits'
          : hasUpstream
            ? `Already published to ${upstreamName}`
            : 'Publish this branch to origin',
      disabled: busy || loading || detached || hasUpstream
    }
  ]
}
