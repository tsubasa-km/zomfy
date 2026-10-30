import { createElement, type ComponentType } from 'react'
import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle
} from 'lucide-react'
import type { HostedCheck, HostedChecksStatus, HostedReview, HostedReviewDecision, HostingProviderId } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Orca's check-presentation.tsx and hosted-review-header-chrome.tsx: icons, state badges, tones.

type IconType = ComponentType<{ className?: string }>

export const CHECK_ICON: Record<string, IconType> = {
  success: CircleCheck,
  failure: CircleX,
  pending: LoaderCircle,
  cancelled: CircleX,
  skipped: CircleMinus,
  neutral: CircleDashed,
  timed_out: CircleX,
  action_required: AlertTriangle
}

export const CHECK_COLOR: Record<string, string> = {
  success: 'text-emerald-500',
  failure: 'text-rose-500',
  pending: 'text-amber-500',
  cancelled: 'text-muted-foreground/60',
  skipped: 'text-muted-foreground/60',
  neutral: 'text-muted-foreground',
  timed_out: 'text-rose-500',
  action_required: 'text-amber-500'
}

export function reviewShortLabel(provider: HostingProviderId): 'PR' | 'MR' {
  return provider === 'gitlab' ? 'MR' : 'PR'
}

export function reviewNumberLabel(review: Pick<HostedReview, 'provider' | 'number'>): string {
  return review.provider === 'gitlab' ? `!${review.number}` : `#${review.number}`
}

export function providerName(provider: HostingProviderId): string {
  return provider === 'gitlab' ? 'GitLab' : 'GitHub'
}

export function prStateColor(state: HostedReview['state']): string {
  switch (state) {
    case 'merged':
      return 'bg-purple-500/15 text-purple-500 border-purple-500/20'
    case 'closed':
      return 'bg-destructive/10 text-destructive border-destructive/20'
    case 'draft':
      return 'bg-muted text-muted-foreground/70 border-border'
    case 'open':
      return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20'
  }
}

/** The review's state word as shown; the English keys are the lowercase enum values. */
export function reviewStateLabel(state: HostedReview['state']): string {
  switch (state) {
    case 'open':
      return t('open')
    case 'merged':
      return t('merged')
    case 'closed':
      return t('closed')
    case 'draft':
      return t('draft')
  }
}

export function ReviewStateBadge({ state }: { state: HostedReview['state'] }) {
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase', prStateColor(state))}>
      {reviewStateLabel(state)}
    </span>
  )
}

function stateTone(state: HostedReview['state']): string {
  if (state === 'merged') return 'text-purple-500/80'
  if (state === 'open') return 'text-emerald-500/80'
  if (state === 'closed') return 'text-muted-foreground/60'
  return 'text-muted-foreground/50'
}

/** Orca's getReviewChecksTone: an open review's icon takes its checks' colour. */
function checksTone(status: HostedChecksStatus): string | null {
  if (status === 'failure') return 'text-rose-500/85'
  if (status === 'pending') return 'text-amber-500/85'
  if (status === 'success') return 'text-emerald-500/80'
  return null
}

/** Merged, closed and draft get their own glyphs; an open review shows its checks' tone. */
export function HostedReviewIcon({
  review,
  className,
  toneByChecks = false
}: {
  review: Pick<HostedReview, 'provider' | 'state' | 'checksStatus'>
  className?: string
  toneByChecks?: boolean
}) {
  const Icon: IconType =
    review.state === 'merged'
      ? GitMerge
      : review.state === 'closed'
        ? GitPullRequestClosed
        : review.state === 'draft'
          ? GitPullRequestDraft
          : review.provider === 'gitlab'
            ? GitMerge
            : GitPullRequest
  const tone = (toneByChecks && review.state === 'open' && checksTone(review.checksStatus)) || stateTone(review.state)
  return createElement(Icon, { className: cn(className, tone) })
}

export const REVIEW_DECISION_LABEL: Record<HostedReviewDecision, string> = {
  APPROVED: t('Approved'),
  CHANGES_REQUESTED: t('Changes requested'),
  REVIEW_REQUIRED: t('Review required')
}

export function reviewDecisionClass(decision: HostedReviewDecision): string {
  if (decision === 'APPROVED') return 'text-emerald-500'
  if (decision === 'CHANGES_REQUESTED') return 'text-rose-500'
  return 'text-muted-foreground'
}

/** Orca's getCheckStatusLabel, in English: agent prompts quote it. */
export function checkStatusText(check: HostedCheck): string {
  const conclusion = check.conclusion ?? 'pending'
  const labels: Record<string, string> = {
    success: 'Successful',
    failure: 'Failed',
    cancelled: 'Cancelled',
    timed_out: 'Timed out',
    action_required: 'Action required',
    neutral: 'Neutral',
    skipped: 'Skipped'
  }
  if (labels[conclusion]) return labels[conclusion]!
  if (check.status === 'queued') return 'Queued'
  if (check.status === 'in_progress') return 'In progress'
  return 'Pending'
}

/** The check's status as shown in the window's language. */
export function checkStatusLabel(check: HostedCheck): string {
  return t(checkStatusText(check))
}

/** "1m 12s" between start and finish (or now, while running). */
export function checkDuration(check: HostedCheck, now = Date.now()): string | null {
  if (!check.startedAt) return null
  const start = Date.parse(check.startedAt)
  const end = check.completedAt ? Date.parse(check.completedAt) : check.status === 'completed' ? NaN : now
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const minutes = Math.round((now - then) / 60_000)
  if (minutes < 1) return t('just now')
  if (minutes < 60) return t('{n}m ago', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('{n}h ago', { n: hours })
  const days = Math.round(hours / 24)
  if (days < 30) return t('{n}d ago', { n: days })
  return new Date(then).toLocaleDateString()
}

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener')
}
