import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { ContextUsage } from '@/stores/chat-store'

// Ported from Orca's NativeChatContextUsageRing and native-chat-context-usage-summary.

const RING_SIZE = 16
const RING_STROKE = 2
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** Past this the window is nearly spent; the ring turns destructive to say so. */
const CRITICAL_PERCENTAGE = 90
const HOVER_OPEN_DELAY_MS = 150
const HOVER_CLOSE_DELAY_MS = 100

/** `18.6k`, `981.4k`, `1M`: capital M, since a lowercase one reads as minutes. */
export function formatContextTokenCount(tokens: number): string {
  const safe = Math.max(0, tokens)
  if (Math.round(safe / 100) >= 10_000) return `${trimZero((safe / 1_000_000).toFixed(1))}M`
  if (safe >= 1_000) return `${trimZero((safe / 1_000).toFixed(1))}k`
  return String(Math.round(safe))
}

function trimZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value
}

function rowPercentage(tokens: number, windowTokens: number): number {
  return windowTokens > 0 ? Math.round((tokens / windowTokens) * 1000) / 10 : 0
}

/** Card open state where only mouse hover waits; any explicit change drops a pending hover. */
function useContextCardOpen() {
  const [open, setOpenState] = useState(false)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drop = useCallback(() => {
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
  }, [])
  useEffect(() => drop, [drop])
  const setOpen = useCallback(
    (next: boolean) => {
      drop()
      setOpenState(next)
    },
    [drop]
  )
  const setOpenAfterHover = useCallback(
    (next: boolean) => {
      drop()
      pending.current = setTimeout(() => setOpen(next), next ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS)
    },
    [drop, setOpen]
  )
  return { open, setOpen, setOpenAfterHover }
}

/** Composer ring for context-window usage; hover, click, or Enter shows the breakdown. */
export function NativeChatContextUsageRing({ usage }: { usage: ContextUsage }) {
  const percentage = usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : 0
  const filled = Math.min(Math.max(percentage, 0), 100)
  const critical = percentage >= CRITICAL_PERCENTAGE
  const used = formatContextTokenCount(usage.used)
  const window = formatContextTokenCount(usage.size)
  const label = `Context ${used} of ${window} tokens, ${percentage}% used`
  const { open, setOpen, setOpenAfterHover } = useContextCardOpen()
  const rows = usage.categories
    .filter((row) => row.tokens > 0)
    .map((row) => ({ ...row, percentage: rowPercentage(row.tokens, usage.size) }))
    .sort((a, b) => b.tokens - a.tokens)
  return (
    <div
      className="flex"
      onPointerEnter={(event) => event.pointerType === 'mouse' && setOpenAfterHover(true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && setOpenAfterHover(false)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            data-native-chat-context-usage={percentage}
            className={cn(
              'flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              critical && 'text-destructive'
            )}
            // A read-only readout: clicking it must not pull focus out of the composer.
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              setOpen(true)
            }}
          >
            <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden className="-rotate-90">
              <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="currentColor" strokeWidth={RING_STROKE} className="opacity-25" />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - filled / 100)}
              />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={label}
          side="top"
          align="end"
          sideOffset={8}
          className="w-72 select-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="p-4">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-foreground">Context</span>
              <span className="text-muted-foreground tabular-nums">
                {used}/{window}
              </span>
            </div>
            <Progress value={filled} aria-label={label} className="mt-2 h-1.5" />
            {rows.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs">
                {rows.map((row, index) => (
                  <li key={`${index}:${row.name}`} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-foreground">{row.name}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{row.percentage}%</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {usage.costUsd !== null ? (
              <p className="mt-3 text-xs text-muted-foreground tabular-nums">Session cost ${usage.costUsd.toFixed(2)}</p>
            ) : null}
            {usage.estimated ? <p className="mt-3 text-2xs text-muted-foreground">Estimated from the last response.</p> : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
