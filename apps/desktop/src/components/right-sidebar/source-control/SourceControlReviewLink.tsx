import { setRightSidebar } from '@/session-store'
import { useReviewPolling, useWorkspaceReview } from '@/stores/hosting-store'
import { Button } from '@/components/ui/button'
import { HostedReviewIcon, reviewShortLabel } from '../checks/review-presentation'
import { t } from '@/i18n/i18n'

// Orca's header-toolbar HostedReviewToolbarLink / CreatePrHeaderButton: the branch's PR/MR (or a
// Create button) in the source-control toolbar, both leading to the Checks tab.

export function SourceControlReviewLink({ workspaceId, branch }: { workspaceId: string; branch: string | null }) {
  useReviewPolling(workspaceId, branch !== null)
  const { review, availability, fetchedAt } = useWorkspaceReview(workspaceId)
  const openChecks = () => setRightSidebar({ open: true, tab: 'checks' })
  if (review) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1 text-[11.5px] leading-none" data-source-control-review>
        <HostedReviewIcon review={review} className="size-3 shrink-0" />
        <button
          type="button"
          className="shrink-0 border-0 bg-transparent p-0 text-left leading-none font-medium text-foreground underline decoration-border underline-offset-2 opacity-80 hover:text-foreground hover:decoration-foreground"
          onClick={(e) => {
            e.stopPropagation()
            openChecks()
          }}
        >
          {reviewShortLabel(review.provider)} #{review.number}
        </button>
      </div>
    )
  }
  if (branch && fetchedAt > 0 && availability?.state === 'ready' && availability.provider) {
    return (
      <div className="flex min-w-0 flex-1 items-center">
        <Button type="button" size="xs" variant="outline" onClick={openChecks} data-source-control-create-review>
          {t('Create {kind}', { kind: reviewShortLabel(availability.provider) })}
        </Button>
      </div>
    )
  }
  return <span className="min-w-0 flex-1" aria-hidden="true" />
}
