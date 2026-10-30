import { ChevronDown, ChevronUp, CircleCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

/** Orca's ConflictBanner: unresolved count with previous/next, or the resolved-locally state. */
export function ConflictBanner({
  total,
  currentIndex,
  onJump,
  onAcceptAll,
  onMarkResolved
}: {
  total: number
  currentIndex: number | null
  onJump: (direction: 'previous' | 'next') => void
  onAcceptAll: (choice: 'current' | 'incoming') => void
  /** Shown once every marker is gone; stages the file as git expects. */
  onMarkResolved?: () => void
}): React.JSX.Element {
  const isUnresolved = total > 0
  return (
    <div
      role="status"
      data-conflict-banner={isUnresolved ? 'unresolved' : 'resolved'}
      className={cn(
        'shrink-0 border-b px-4 py-2 text-xs',
        isUnresolved ? 'border-destructive/20 bg-destructive/5' : 'border-status-success-border bg-status-success-background'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isUnresolved ? (
            <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
          ) : (
            <CircleCheck className="size-3.5 shrink-0 text-status-success" />
          )}
          <span className="min-w-0 truncate font-medium text-foreground">
            {isUnresolved ? t('Unresolved conflict · Resolve the conflict markers') : t('Resolved locally')}
          </span>
          {isUnresolved && (
            <span className="shrink-0 px-1 text-[11px] tabular-nums text-muted-foreground">
              {(currentIndex ?? 0) + 1} / {total}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isUnresolved ? (
            <>
              <Button type="button" size="xs" variant="outline" onClick={() => onAcceptAll('current')}>
                {t('Accept All Current')}
              </Button>
              <Button type="button" size="xs" variant="outline" onClick={() => onAcceptAll('incoming')}>
                {t('Accept All Incoming')}
              </Button>
              <NavButton label={t('Previous conflict')} onClick={() => onJump('previous')}>
                <ChevronUp className="size-3.5" />
              </NavButton>
              <NavButton label={t('Next conflict')} onClick={() => onJump('next')}>
                <ChevronDown className="size-3.5" />
              </NavButton>
            </>
          ) : (
            onMarkResolved && (
              <Button type="button" size="xs" variant="outline" onClick={onMarkResolved}>
                {t('Mark as Resolved')}
              </Button>
            )
          )}
        </div>
      </div>
      {!isUnresolved && (
        <div className="mt-1 text-muted-foreground">
          {t('No conflict markers remain. Save, then stage the file to tell Git the conflict is resolved.')}
        </div>
      )}
    </div>
  )
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
