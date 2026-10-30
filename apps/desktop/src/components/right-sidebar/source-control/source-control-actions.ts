import type { GitUpstreamStatus } from '@acp-harness/protocol'
import { t } from '@/i18n/i18n'

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
  push: t('Push'),
  force_push: t('Force Push'),
  pull: t('Pull'),
  fast_forward: t('Fast-forward'),
  sync: t('Sync'),
  fetch: t('Fetch'),
  publish: t('Publish Branch')
}

/** One key per count form, so each language words the number its own way. */
const counted = (n: number, one: string, many: string, values: Record<string, unknown> = {}) =>
  t(n === 1 ? one : many, { n, ...values })
const countLabel = (base: string, n: number) => (n > 0 ? `${base} (${n})` : base)
const shouldForcePush = (u: GitUpstreamStatus | null | undefined) =>
  Boolean(u?.hasUpstream && u.ahead > 0 && u.behind > 0 && u.behindArePatchEquivalent)

export function resolvePrimaryAction(i: ActionInputs): PrimaryAction {
  const commit = (title: string, disabled: boolean): PrimaryAction => ({ kind: 'commit', label: t('Commit'), title, disabled })
  if (i.isCommitting) return commit(t('Commit in progress…'), true)
  if (i.remoteOp) {
    return { kind: i.remoteOp, label: OP_LABEL[i.remoteOp], title: t('{op} in progress…', { op: OP_LABEL[i.remoteOp] }), disabled: true }
  }
  if (i.hasConflicts) return commit(t('Resolve conflicts before committing'), true)
  if (i.stagedCount > 0) return commit(i.hasMessage ? t('Commit staged changes') : t('Enter a commit message to commit'), !i.hasMessage)
  if (i.hasStageableChanges) return { kind: 'stage', label: t('Stage All'), title: t('Stage all changes'), disabled: false }
  const u = i.upstream
  if (u === undefined || !i.hasCommits) return commit(t('Stage at least one file to commit'), true)
  if (!i.hasBranch || u === null) {
    return { kind: 'publish', label: t('Publish Branch'), title: t('Check out a branch before publishing commits.'), disabled: true }
  }
  if (!u.hasUpstream) return { kind: 'publish', label: t('Publish Branch'), title: t('Publish this branch to origin'), disabled: false }
  if (u.ahead > 0 && u.behind > 0) {
    if (shouldForcePush(u)) {
      return {
        kind: 'force_push',
        label: t('Force Push'),
        title: counted(
          u.ahead,
          'Remote only has older copies of local commits. Force push {n} branch commit with lease to update {upstream}.',
          'Remote only has older copies of local commits. Force push {n} branch commits with lease to update {upstream}.',
          { upstream: u.upstreamName ?? t('the remote branch') }
        ),
        disabled: false
      }
    }
    return { kind: 'sync', label: t('Sync'), title: t('Pull {behind}, push {ahead}', { behind: u.behind, ahead: u.ahead }), disabled: false }
  }
  if (u.behind > 0) return { kind: 'pull', label: t('Pull'), title: counted(u.behind, 'Pull {n} commit', 'Pull {n} commits'), disabled: false }
  if (u.ahead > 0) return { kind: 'push', label: t('Push'), title: counted(u.ahead, 'Push {n} commit', 'Push {n} commits'), disabled: false }
  return commit(t('Nothing to commit. Branch is up to date.'), true)
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
    ? t('Operation in progress…')
    : i.hasConflicts
      ? t('Resolve conflicts before committing')
      : i.stagedCount === 0
        ? t('Stage at least one file to commit')
        : !i.hasMessage
          ? t('Enter a commit message to commit')
          : null

  const commitPushTitle = loading
    ? t('Checking branch status…')
    : detached
      ? t('Check out a branch before pushing commits')
      : !hasUpstream
        ? t('Publish the branch first to push commits')
        : (commitBlocked ??
          (forcePush
            ? t('Commit staged changes and force push with lease')
            : behind > 0
              ? t('Commit staged changes and try to push')
              : t('Commit staged changes and push')))
  const commitSyncTitle = loading
    ? t('Checking branch status…')
    : detached
      ? t('Check out a branch before syncing commits')
      : !hasUpstream
        ? t('Publish the branch first to sync commits')
        : forcePush
          ? (commitBlocked ?? t('Use Commit & Force Push — remote only has older copies of local commits'))
          : (commitBlocked ?? t('Commit, then pull and push'))

  const pullTitle = (verb: 'Pull' | 'Fast-forward') => {
    const pull = verb === 'Pull'
    return loading
      ? t('Checking branch status…')
      : detached
        ? pull
          ? t('Check out a branch before pulling commits')
          : t('Check out a branch before fast-forwarding')
        : !hasUpstream
          ? pull
            ? t('Publish the branch first to pull commits')
            : t('Publish the branch first to fast-forward')
          : forcePush
            ? pull
              ? t('Nothing new to pull — remote only has older copies of local commits')
              : t('Nothing new to fast-forward — remote only has older copies of local commits')
            : behind === 0
              ? pull
                ? t('Nothing to pull')
                : t('Nothing to fast-forward')
              : !pull && ahead > 0
                ? t('Try a fast-forward pull; git may reject local commits')
                : pull
                  ? counted(behind, 'Pull {n} commit', 'Pull {n} commits')
                  : counted(behind, 'Fast-forward {n} commit', 'Fast-forward {n} commits')
  }

  return [
    { kind: 'commit', label: t('Commit'), title: commitBlocked ?? t('Commit staged changes'), disabled: commitBlocked !== null },
    {
      kind: 'commit_push',
      label: forcePush ? t('Commit & Force Push') : t('Commit & Push'),
      title: commitPushTitle,
      disabled: loading || detached || !hasUpstream || commitBlocked !== null
    },
    {
      kind: 'commit_sync',
      label: t('Commit & Sync'),
      title: commitSyncTitle,
      disabled: loading || detached || !hasUpstream || forcePush || commitBlocked !== null
    },
    {
      kind: 'amend',
      label: t('Commit (Amend)'),
      title: busy
        ? t('Operation in progress…')
        : !i.hasCommits
          ? t('There is no commit to amend yet')
          : i.hasConflicts
            ? t('Resolve conflicts before committing')
            : i.hasMessage
              ? t('Amend the last commit with the staged changes and this message')
              : t('Amend the last commit with the staged changes, keeping its message'),
      disabled: busy || !i.hasCommits || i.hasConflicts
    },
    { kind: 'separator', id: 'before-remote' },
    {
      kind: 'push',
      label: countLabel(t('Push'), ahead),
      title: detached
        ? t('Check out a branch before pushing commits')
        : !hasUpstream
          ? t('Push this branch and set an upstream if needed')
          : forcePush
            ? t('Try a regular push; git may require force push')
            : behind > 0 && ahead > 0
              ? t('Push local commits; git may require syncing first')
              : ahead === 0
                ? upstreamName
                  ? t('Nothing to push to {upstream}', { upstream: upstreamName })
                  : t('Nothing to push')
                : counted(ahead, 'Push {n} commit', 'Push {n} commits'),
      disabled: busy || detached || loading
    },
    {
      kind: 'force_push',
      label: countLabel(t('Force Push'), ahead),
      title: detached
        ? t('Check out a branch before force pushing commits')
        : !hasUpstream
          ? t('Publish this branch, replacing any remote branch of the same name')
          : ahead === 0
            ? upstreamName
              ? t('Nothing to force push to {upstream}', { upstream: upstreamName })
              : t('Nothing to force push')
            : counted(ahead, 'Force push {n} commit with lease to {upstream}', 'Force push {n} commits with lease to {upstream}', {
                upstream: upstreamName ?? t('the remote branch')
              }),
      disabled: busy || detached || loading
    },
    {
      kind: 'pull',
      label: countLabel(t('Pull'), behind),
      title: pullTitle('Pull'),
      disabled: busy || loading || detached || !hasUpstream
    },
    {
      kind: 'fast_forward',
      label: countLabel(t('Fast-forward'), behind),
      title: pullTitle('Fast-forward'),
      disabled: busy || loading || detached || !hasUpstream
    },
    {
      kind: 'sync',
      label: ahead === 0 && behind === 0 ? t('Sync') : `${t('Sync')} (↓${behind} ↑${ahead})`,
      title: loading
        ? t('Checking branch status…')
        : detached
          ? t('Check out a branch before syncing commits')
          : !hasUpstream
            ? t('Publish the branch first to sync commits')
            : forcePush
              ? t('Use Force Push — remote only has older copies of local commits')
              : ahead === 0 && behind === 0
                ? t('Branch is up to date')
                : t('Pull {behind}, push {ahead}', { behind, ahead }),
      disabled: busy || loading || detached || !hasUpstream || forcePush
    },
    { kind: 'fetch', label: t('Fetch'), title: t('Fetch from remote without merging'), disabled: busy },
    {
      kind: 'publish',
      label: detached ? t('No Branch') : t('Publish Branch'),
      title: loading
        ? t('Checking branch status…')
        : detached
          ? t('Check out a branch before publishing commits')
          : hasUpstream
            ? t('Already published to {upstream}', { upstream: upstreamName })
            : t('Publish this branch to origin'),
      disabled: busy || loading || detached || hasUpstream
    }
  ]
}
