import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// "Open a surface", as T3 Code's empty panel has it: the things a place can show, one row each,
// with the key that opens it while the list has the focus.

export interface Surface {
  id: string
  /** The key that opens it; none for one past the keys worth remembering (a plugin's panel). */
  key?: string
  label: string
  icon: ReactNode
  open: () => void
  /** It cannot open here (no git checkout to diff). */
  unavailable?: boolean
}

export function SurfaceList({
  surfaces,
  focus = 'idle',
  title
}: {
  surfaces: Surface[]
  /**
   * When the list takes the keys as it appears: 'idle' only when nobody is typing elsewhere, 'never'
   * for one that shows under the pointer, where a stolen keystroke would open something.
   */
  focus?: 'idle' | 'never'
  title?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus === 'never') return
    const active = document.activeElement
    const scope = root.current?.closest('[data-workspace-tabs]')
    const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)
    if (!active || active === document.body || (scope?.contains(active) && !typing)) root.current?.focus({ preventScroll: true })
  }, [focus])

  return (
    // Scrolls in a short place rather than spilling out of it.
    <div
      ref={root}
      tabIndex={0}
      data-surface-list
      title={title}
      className="group/surfaces flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
        const surface = surfaces.find((s) => s.key && s.key.toLowerCase() === e.key.toLowerCase())
        if (!surface || surface.unavailable) return
        e.preventDefault()
        surface.open()
      }}
    >
      <div className="m-auto flex w-full max-w-xs flex-col gap-2 p-4">
        <p className="pb-1 text-center text-sm font-medium text-foreground">{t('Open a surface')}</p>
        <div className="flex flex-col">
          {surfaces.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={s.unavailable}
              data-surface={s.id}
              onClick={s.open}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors',
                s.unavailable ? 'cursor-default text-muted-foreground/50' : 'text-foreground hover:bg-accent'
              )}
            >
              <span className={cn('flex size-4 shrink-0 items-center justify-center', s.unavailable ? 'opacity-50' : 'text-muted-foreground')}>{s.icon}</span>
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              {s.key && (
                // The keys only work while the list has the focus, and say so by lighting up then.
                <kbd
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] font-medium opacity-40 group-focus/surfaces:opacity-100',
                    s.unavailable ? 'text-muted-foreground/40' : 'text-muted-foreground'
                  )}
                >
                  {s.key}
                </kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
