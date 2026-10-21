import { Fragment } from 'react'
import { IS_MAC } from '@/keybindings/keybinding-chords'
import { cn } from '@/lib/utils'

// Orca's ShortcutKeyCombo: one cap per key; Windows/Linux read better with "+" between caps.

function KeyCap({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded border border-border/80 bg-secondary/70 px-1.5 py-0.5 text-xs font-medium text-muted-foreground shadow-sm',
        className
      )}
    >
      {label}
    </span>
  )
}

export function ShortcutKeyCombo({
  keys,
  className,
  keyCapClassName,
  separatorClassName
}: {
  keys: string[]
  className?: string
  keyCapClassName?: string
  separatorClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          <KeyCap label={key} className={keyCapClassName} />
          {!IS_MAC && index < keys.length - 1 ? (
            <span className={separatorClassName ?? 'mx-0.5 text-xs text-muted-foreground'}>+</span>
          ) : null}
        </Fragment>
      ))}
    </span>
  )
}
