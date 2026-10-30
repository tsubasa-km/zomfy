import { Copy, Ellipsis, ExternalLink, RefreshCw, Wrench } from 'lucide-react'
import type { HostingAvailability, HostedReview } from '@acp-harness/protocol'
import { allProjects, allWorkspaces, useStore } from '@/session-store'
import { useGitStatus } from '@/hooks/use-git-status'
import { loadChecks, loadReview, useReviewPolling, useWorkspaceReview } from '@/stores/hosting-store'
import { SendToAgentMenu } from '@/components/SendToAgentMenu'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ChecksList } from './ChecksList'
import { CreateReviewComposer } from './CreateReviewComposer'
import { ReviewCommentsSection } from './ReviewCommentsSection'
import { ReviewFilesSection } from './ReviewFilesSection'
import { brokenChecks, buildFixBrokenChecksPrompt } from './review-agent-prompts'
import {
  HostedReviewIcon,
  REVIEW_DECISION_LABEL,
  ReviewStateBadge,
  openExternal,
  providerName,
  relativeTime,
  reviewDecisionClass,
  reviewNumberLabel,
  reviewShortLabel
} from './review-presentation'
import { t } from '@/i18n/i18n'

// Orca's right-sidebar ChecksPanel: the branch's PR/MR header, CI checks, changed files and
// comments; with no review yet, the create composer (checks-panel/empty-content.tsx).

function EmptyState({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-6" data-checks-empty>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && <div className="mt-1 text-xs break-words text-muted-foreground">{description}</div>}
      {children}
    </div>
  )
}

/** Orca's Landing/checks copy for a host that cannot reach GitHub or GitLab yet. */
function unavailableCopy(availability: HostingAvailability): { title: string; description: string } {
  const name = availability.provider ? providerName(availability.provider) : t('GitHub or GitLab')
  switch (availability.state) {
    case 'cli-missing':
      return { title: t('{name} CLI is not installed', { name }), description: availability.message ?? '' }
    case 'unauthenticated':
      return { title: t('Not signed in to {name}', { name }), description: availability.message ?? '' }
    case 'no-remote':
      return { title: t('No remote'), description: availability.message ?? t('This repository has no remote.') }
    case 'unsupported-remote':
      return { title: t('Checks unavailable'), description: availability.message ?? t('The remote is not a GitHub or GitLab repository.') }
    default:
      return { title: t('Checks unavailable'), description: availability.message ?? t('Checks require a Git branch and hosted review context') }
  }
}

export function ChecksPanel({ workspaceId }: { workspaceId: string }) {
  const isFolder = useStore((s) => {
    const workspace = allWorkspaces(s).find((w) => w.id === workspaceId)
    const project = allProjects(s.hosts).find((p) => p.id === workspace?.projectId)
    return !project || project.kind !== 'git'
  })
  useReviewPolling(workspaceId, !isFolder)
  const entry = useWorkspaceReview(workspaceId)
  const { status } = useGitStatus(isFolder ? null : workspaceId)

  if (isFolder) {
    return <EmptyState title={t('Checks unavailable')} description={t('Checks require a Git branch and hosted review context')} />
  }
  const { availability, review, branch } = entry
  const refresh = () => {
    void loadReview(workspaceId, true).then(() => loadChecks(workspaceId, true))
  }
  const retry = (
    <Button size="xs" variant="outline" className="mt-3" disabled={entry.loading} onClick={refresh}>
      {entry.loading ? t('Refreshing…') : t('Retry')}
    </Button>
  )

  if (entry.fetchedAt === 0 || (entry.loading && !availability)) {
    return <EmptyState title={t('Checking review status')} description={t('Looking for a pull or merge request on this branch.')} />
  }
  if (entry.error && !review) {
    return (
      <EmptyState title={t('Could not check review status')} description={entry.error}>
        {retry}
      </EmptyState>
    )
  }
  if (availability && availability.state !== 'ready') {
    const copy = unavailableCopy(availability)
    return (
      <EmptyState title={copy.title} description={copy.description}>
        {retry}
      </EmptyState>
    )
  }
  if (!branch) {
    return <EmptyState title={t('Detached HEAD')} description={t('Check out a branch to see its pull or merge request.')} />
  }
  if (!review) {
    const provider = availability?.provider ?? 'github'
    const short = reviewShortLabel(provider)
    const long = provider === 'gitlab' ? t('merge request') : t('pull request')
    const upstream = status?.upstream
    const needsPush = !upstream?.hasUpstream || (upstream.ahead ?? 0) > 0
    // Pushing would update that other branch, and the host would see no head to review.
    const trackedElsewhere =
      upstream?.hasUpstream && upstream.upstreamName && upstream.upstreamName.slice(upstream.upstreamName.indexOf('/') + 1) !== branch
        ? upstream.upstreamName
        : null
    return (
      <div className="flex-1 overflow-auto">
        <EmptyState title={t('No {kind} found', { kind: long })} description={t('Create a {kind} to start checks and review.', { kind: long })}>
          <div className="mt-4 border-t border-border pt-3">
            <CreateReviewComposer key={`${workspaceId}:${branch}`} workspaceId={workspaceId} provider={provider} branch={branch} needsPush={needsPush} blockedReason={trackedElsewhere ? t('{branch} tracks {upstream}; publish it under its own name before creating a {kind}.', { branch, upstream: trackedElsewhere, kind: long }) : null} />
          </div>
          <Button size="xs" variant="outline" className="mt-3" disabled={entry.loading} onClick={refresh} aria-label={t('Refresh {kind} status', { kind: short })}>
            {entry.loading ? t('Refreshing…') : t('Refresh')}
          </Button>
        </EmptyState>
      </div>
    )
  }
  return <ActiveReview workspaceId={workspaceId} review={review} />
}

function ActiveReview({ workspaceId, review }: { workspaceId: string; review: HostedReview }) {
  const entry = useWorkspaceReview(workspaceId)
  const short = reviewShortLabel(review.provider)
  const broken = brokenChecks(entry.checks ?? [])
  const refreshing = entry.loading || entry.checksLoading
  return (
    <div className="flex-1 overflow-auto" data-checks-panel data-review-number={review.number}>
      <div className="space-y-2.5 border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <HostedReviewIcon review={review} className="size-4 shrink-0" />
          <button
            type="button"
            className="rounded px-0.5 text-[12px] font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            title={t('Open on {provider}', { provider: providerName(review.provider) })}
            onClick={() => openExternal(review.url)}
            data-review-link
          >
            {reviewNumberLabel(review)}
          </button>
          <ReviewStateBadge state={review.state} />
          <div className="flex-1" />
          <button
            type="button"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title={t('Refresh')}
            aria-label={t('Refresh')}
            disabled={refreshing}
            onClick={() => void loadReview(workspaceId, true).then(() => loadChecks(workspaceId, true))}
          >
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('More {kind} actions', { kind: short })} className="text-muted-foreground hover:text-foreground">
                <Ellipsis className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => openExternal(review.url)}>
                <ExternalLink className="size-3.5" />
                {t('Open on {provider}', { provider: providerName(review.provider) })}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(review.url)}>
                <Copy className="size-3.5" />
                {t('Copy link')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="text-[12px] leading-snug text-foreground" data-review-title>
          {review.title}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono">{review.baseRefName}</span>
          <span>←</span>
          <span className="min-w-0 truncate font-mono">{review.headRefName}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {[
            review.author && t('by {author}', { author: review.author }),
            review.updatedAt && t('Updated {time}', { time: relativeTime(review.updatedAt) })
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {review.reviewDecision && (
          <div className={cn('text-[11px] font-medium', reviewDecisionClass(review.reviewDecision))} data-review-decision>
            {REVIEW_DECISION_LABEL[review.reviewDecision]}
          </div>
        )}
      </div>

      {broken.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-rose-500/5 px-3 py-2 text-[11px]" data-triage-strip>
          <Wrench className="size-3.5 shrink-0 text-rose-500" />
          <span className="min-w-0 flex-1 text-foreground">
            {broken.length === 1 ? t('{n} failing check', { n: broken.length }) : t('{n} failing checks', { n: broken.length })}
          </span>
          <SendToAgentMenu
            workspaceId={workspaceId}
            count={broken.length}
            label={t('Fix with AI')}
            tooltip={t('Send the failing checks to an agent')}
            buildPrompt={() => buildFixBrokenChecksPrompt(review, entry.checks ?? [])}
          />
        </div>
      )}

      <ChecksList checks={entry.checks} loading={entry.checksLoading} error={entry.checksError} />
      <ReviewFilesSection workspaceId={workspaceId} review={review} />
      <ReviewCommentsSection workspaceId={workspaceId} review={review} />
    </div>
  )
}
