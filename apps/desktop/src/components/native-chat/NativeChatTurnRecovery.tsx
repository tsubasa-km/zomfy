import { useEffect, useId, useState } from 'react'
import { CircleAlert, Hourglass, Play, RotateCw } from 'lucide-react'
import type { AutoResumeState, TurnResumeKind } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n/i18n'

// Picking a chat back up: Continue on a reply that was stopped (Orca's NativeChatInterruptedContinue),
// Retry on a failed turn, and the usage-limit banner with Resume and the daemon's automatic resume.

/** Continue, on the row that says the reply was stopped: the one action that picks it back up. */
export function NativeChatInterruptedContinueButton({ onContinue }: { onContinue: () => void }) {
  const explanationId = useId()
  const explanation = t('Continue, and the agent first checks whether its last step finished.')
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" size="xs" data-native-chat-continue aria-describedby={explanationId} onClick={onContinue}>
            <Play />
            {t('Continue')}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {explanation}
        </TooltipContent>
      </Tooltip>
      <span id={explanationId} className="sr-only">
        {explanation}
      </span>
    </>
  )
}

export function NativeChatRetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Button type="button" size="xs" variant="outline" data-native-chat-retry onClick={onRetry}>
      <RotateCw />
      {t('Retry')}
    </Button>
  )
}

const RESUMED_LABELS: Record<TurnResumeKind, string> = {
  continue: t('Continued'),
  retry: t('Retried'),
  resume: t('Resumed after the usage limit'),
  auto: t('Resumed automatically after the usage limit reset'),
  moved: t('Continued in the new workspace')
}

/** A recovery prompt is not something the user typed, so it reads as a divider, not a bubble. */
export function NativeChatResumedDivider({ kind }: { kind: TurnResumeKind }) {
  return (
    <div role="separator" data-native-chat-resumed={kind} className="flex items-center gap-3 py-1 text-xs text-chat-foreground-faint">
      <span className="h-px flex-1 bg-border" />
      <span>{RESUMED_LABELS[kind]}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (hours >= 24) return t('{d}d {h}h', { d: Math.floor(hours / 24), h: hours % 24 })
  return hours > 0 ? t('{h}h {m}m', { h: hours, m: pad(minutes) }) : `${minutes}:${pad(seconds)}`
}

function formatClock(at: number, now: number): string {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return date.toDateString() === new Date(now).toDateString()
    ? time
    : `${date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`
}

/**
 * Above the composer while the chat is stopped by a Claude usage limit. The automatic resume is
 * scheduled and run by the daemon, so it happens with this window closed; this only shows it.
 */
export function NativeChatUsageLimitBanner({
  resetsAt,
  autoResume,
  onResume,
  onAutoResumeChange
}: {
  /** From the failed turn; null when the limit gave no reset time. */
  resetsAt: number | null
  autoResume: AutoResumeState | null
  onResume: () => void
  onAutoResumeChange: (enabled: boolean) => void
}) {
  const now = useNow(true)
  const switchId = useId()
  const status = autoResume
    ? autoResume.fireAt > now
      ? autoResume.resetKnown
        ? t('Resuming automatically in {time}', { time: formatCountdown(autoResume.fireAt - now) })
        : t('Reset time unknown: trying again in {time} (every 15–60 min)', { time: formatCountdown(autoResume.fireAt - now) })
      : t('Resuming…')
    : resetsAt !== null
      ? resetsAt > now
        ? t('Resets at {clock} (in {time})', { clock: formatClock(resetsAt, now), time: formatCountdown(resetsAt - now) })
        : t('The limit should have reset by now')
      : t('Claude did not say when the limit resets')
  return (
    <div className="shrink-0 bg-chat-canvas" data-native-chat-usage-limit>
      <div className="mx-auto w-full max-w-(--chat-content-max-width) px-3 pt-2 pb-1 sm:px-4">
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-input bg-card px-4 py-3 shadow-xs">
          <div className="flex items-start gap-2">
            {autoResume ? (
              <Hourglass className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{t('Claude usage limit reached')}</p>
              <p className="text-xs text-muted-foreground tabular-nums" data-native-chat-usage-limit-status>
                {status}
              </p>
            </div>
            <Button type="button" size="xs" data-native-chat-resume onClick={onResume}>
              <Play />
              {t('Resume')}
            </Button>
          </div>
          <label htmlFor={switchId} className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
            <Switch
              id={switchId}
              data-native-chat-auto-resume
              checked={autoResume !== null}
              onCheckedChange={onAutoResumeChange}
            />
            {t('Resume automatically when the limit resets')}
          </label>
        </div>
      </div>
    </div>
  )
}
