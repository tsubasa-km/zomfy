import { useState } from 'react'
import { ChevronDown, CircleCheck, CircleDashed, CircleX, ExternalLink, LoaderCircle } from 'lucide-react'
import type { HostedCheck } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CHECK_COLOR, CHECK_ICON, checkDuration, checkStatusLabel, openExternal } from './review-presentation'
import { t } from '@/i18n/i18n'

// Orca's checks-panel/checks-list.tsx: a collapsible pass/fail/pending summary over the check rows.

const FAILED = new Set(['failure', 'cancelled', 'timed_out', 'action_required'])

/** Failing first, then running, then the rest, so what needs attention sits on top. */
function rank(check: HostedCheck): number {
  const c = check.conclusion ?? 'pending'
  return FAILED.has(c) ? 0 : c === 'pending' ? 1 : c === 'success' ? 3 : 2
}

export function ChecksList({
  checks,
  loading,
  error
}: {
  checks: HostedCheck[] | null
  loading: boolean
  error: string | null
}) {
  const [expanded, setExpanded] = useState(true)
  const list = [...(checks ?? [])].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const count = (test: (c: string) => boolean) => list.filter((c) => test(c.conclusion ?? 'pending')).length
  const passing = count((c) => c === 'success')
  const failing = count((c) => FAILED.has(c))
  const pending = count((c) => c === 'pending')
  const neutral = list.length - passing - failing - pending

  return (
    <div data-checks-list>
      {list.length > 0 && (
        <button
          type="button"
          className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-[10px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-checks-summary
        >
          <ChevronDown className={cn('size-3 shrink-0 transition-transform', !expanded && '-rotate-90')} />
          {passing > 0 && (
            <span className="flex items-center gap-1">
              <CircleCheck className="size-3 text-emerald-500" />
              {t('{n} passing', { n: passing })}
            </span>
          )}
          {failing > 0 && (
            <span className="flex items-center gap-1">
              <CircleX className="size-3 text-rose-500" />
              {t('{n} failing', { n: failing })}
            </span>
          )}
          {pending > 0 && (
            <span className="flex items-center gap-1">
              <LoaderCircle className="size-3 text-amber-500" />
              {t('{n} pending', { n: pending })}
            </span>
          )}
          {neutral > 0 && (
            <span className="flex items-center gap-1">
              <CircleDashed className="size-3 text-muted-foreground" />
              {t('{n} skipped', { n: neutral })}
            </span>
          )}
          <span className="flex-1" />
          {loading && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
        </button>
      )}

      {loading && list.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 && error ? (
        <div role="alert" className="px-4 py-8 text-[11px] break-words text-destructive">
          {error}
        </div>
      ) : list.length === 0 ? (
        <div className="px-4 py-8 text-[11px] text-muted-foreground">{checks ? t('No checks configured') : ''}</div>
      ) : !expanded ? null : (
        <div className="border-b border-border py-1">
          {list.map((check, index) => {
            const conclusion = check.conclusion ?? 'pending'
            const Icon = CHECK_ICON[conclusion] ?? CircleDashed
            const duration = checkDuration(check)
            return (
              <div
                key={`${check.name}:${index}`}
                className="group/check-row flex min-w-0 items-center gap-2 px-3 py-1.5 transition-colors hover:bg-accent/40"
                data-check-row={conclusion}
              >
                <Icon
                  className={cn('size-3.5 shrink-0', CHECK_COLOR[conclusion] ?? 'text-muted-foreground', conclusion === 'pending' && 'animate-spin')}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={check.group ? `${check.group} / ${check.name}` : check.name}>
                  {check.name}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {duration ? `${duration} · ` : ''}
                    {checkStatusLabel(check)}
                  </span>
                  {check.url && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-6 text-muted-foreground hover:text-foreground"
                          aria-label={t('Open check details')}
                          onClick={() => openExternal(check.url!)}
                        >
                          <ExternalLink className="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" sideOffset={4}>
                        {t('Open check details')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
