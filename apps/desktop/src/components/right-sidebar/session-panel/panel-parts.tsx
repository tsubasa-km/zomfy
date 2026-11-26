import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// The session panel's pieces: a titled section, a thin meter and a list that opens on click.

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border px-3 py-3">
      <div className="flex min-h-6 items-center gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        <div className="ml-auto flex items-center gap-1">{aside}</div>
      </div>
      {children}
    </section>
  )
}

/**
 * A meter is grey while there is room, so colour appears only when it means something: amber past
 * `warn` percent, red past `danger`. (The accent orange read as a warning at any level.)
 */
export function meterTone(percent: number, warn = 80, danger = 95): string {
  return percent >= danger ? 'bg-destructive' : percent >= warn ? 'bg-status-warning' : 'bg-muted-foreground/55'
}

export function Meter({ percent, className }: { percent: number; className?: string }) {
  const filled = Math.min(100, Math.max(0, percent))
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full', meterTone(filled))} style={{ width: `${filled}%` }} />
    </div>
  )
}

/** A heading row that shows its list when clicked. */
export function Disclosure({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded py-0.5 text-left text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="tabular-nums">{count}</span>
      </button>
      {open && <div className="mt-1 max-h-64 overflow-y-auto pl-4">{children}</div>}
    </div>
  )
}
