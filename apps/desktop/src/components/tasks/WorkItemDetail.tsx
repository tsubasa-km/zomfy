import { useEffect, useState } from 'react'
import { ArrowLeft, CircleDot, ExternalLink, LoaderCircle } from 'lucide-react'
import { HARNESS_METHODS, type HostedWorkItem } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostedProject } from '@/session-store'
import { Button } from '@/components/ui/button'
import { HostedReviewIcon, ReviewStateBadge, openExternal, providerName, relativeTime } from '@/components/right-sidebar/checks/review-presentation'
import { workItemLabel } from './work-item-prompt'
import { t } from '@/i18n/i18n'

// Orca's GitHubItemDialog / PullRequestPage header and description, as a page inside Tasks with
// "Start workspace" as the primary action.

export function WorkItemDetail({
  project,
  item,
  onBack,
  onStart
}: {
  project: HostedProject
  item: HostedWorkItem
  onBack: () => void
  onStart: (item: HostedWorkItem) => void
}) {
  const [full, setFull] = useState<HostedWorkItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void harnessRequest(HARNESS_METHODS.hostingWorkItem, { projectId: project.id, kind: item.kind, number: item.number }, project.hostId).then(
      (r) => !cancelled && setFull(r),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e))
    )
    return () => {
      cancelled = true
    }
  }, [project.id, project.hostId, item.kind, item.number])

  const shown = full ?? item
  const backLabel = item.kind === 'issue' ? t('Issues') : item.provider === 'gitlab' ? t('Merge requests') : t('Pull requests')
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm" data-work-item-detail>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <Button size="xs" variant="ghost" onClick={onBack}>
          <ArrowLeft />
          {backLabel}
        </Button>
        <div className="flex-1" />
        <Button size="xs" variant="outline" onClick={() => openExternal(shown.url)}>
          <ExternalLink />
          {t('Open on {provider}', { provider: providerName(shown.provider) })}
        </Button>
        <Button size="xs" onClick={() => onStart(full ?? item)} data-work-item-start>
          {item.kind === 'issue'
            ? t('Start workspace from issue')
            : t('Start workspace from {kind}', { kind: item.provider === 'gitlab' ? 'MR' : 'PR' })}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {shown.kind === 'review' ? (
            <HostedReviewIcon review={{ provider: shown.provider, state: shown.state, checksStatus: shown.checksStatus ?? 'none' }} className="size-4" />
          ) : (
            <CircleDot className={shown.state === 'open' ? 'size-4 text-emerald-500' : 'size-4 text-purple-500'} />
          )}
          <span>{workItemLabel(shown)}</span>
          <ReviewStateBadge state={shown.state} />
          {shown.author && <span>· {shown.author}</span>}
          {shown.updatedAt && <span>· {t('Updated {time}', { time: relativeTime(shown.updatedAt) })}</span>}
        </div>
        <h2 className="mt-2 text-lg leading-snug font-semibold text-foreground">{shown.title}</h2>
        {shown.kind === 'review' && shown.headRefName && <div className="mt-1 font-mono text-xs text-muted-foreground">{shown.headRefName}</div>}
        {shown.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {shown.labels.map((label) => (
              <span key={label} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {label}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 border-t border-border/60 pt-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!full && !error && <LoaderCircle className="size-4 animate-spin text-muted-foreground" />}
          {full && (
            <div className="max-w-3xl text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground" data-work-item-body>
              {full.body?.trim() || <span className="text-muted-foreground">{t('No description provided.')}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
