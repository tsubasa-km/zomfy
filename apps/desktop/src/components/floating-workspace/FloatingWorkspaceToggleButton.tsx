import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PanelsTopLeft } from 'lucide-react'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FloatingWorkspaceTriggerMenu } from './FloatingWorkspaceTriggerMenu'
import {
  anchorTriggerPosition,
  clampTriggerPosition,
  persistTriggerPosition,
  readInitialTriggerPosition,
  resolveTriggerPosition,
  shouldReconcileTriggerPosition,
  type TriggerPosition
} from './floating-workspace-trigger-position'

// Orca's FloatingTerminalToggleButton: a draggable launcher that stays above the open panel (a
// click then minimizes it), with an amber dot while the minimized workspace has unread activity.

const DRAG_THRESHOLD = 4

export function FloatingWorkspaceToggleButton({
  open,
  unread,
  onToggle
}: {
  open: boolean
  unread: boolean
  onToggle: () => void
}) {
  const shortcut = useShortcutLabel('floatingWorkspace.toggle')
  const showAttentionDot = !open && unread
  const initial = useRef<ReturnType<typeof readInitialTriggerPosition> | null>(null)
  initial.current ??= readInitialTriggerPosition()
  const sourceRef = useRef(initial.current.source)
  const committedRef = useRef(initial.current.committed)
  const [position, setPosition] = useState(initial.current.position)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number; moved: boolean } | null>(null)
  const stagedRef = useRef<TriggerPosition | null>(null)
  const suppressClickRef = useRef(false)

  const commit = useCallback((next: TriggerPosition) => {
    stagedRef.current = null
    const clamped = clampTriggerPosition(next)
    setPosition(clamped)
    const anchored = anchorTriggerPosition(clamped)
    if (!anchored) return
    committedRef.current = anchored
    sourceRef.current = 'user'
    persistTriggerPosition(anchored)
  }, [])

  const reconcile = useCallback(() => {
    setPosition((current) =>
      shouldReconcileTriggerPosition(sourceRef.current) ? resolveTriggerPosition(committedRef.current, sourceRef.current) : current
    )
  }, [])

  useLayoutEffect(reconcile, [reconcile])
  useEffect(() => {
    window.addEventListener('resize', reconcile)
    return () => window.removeEventListener('resize', reconcile)
  }, [reconcile])

  const label = open ? 'Minimize floating workspace' : showAttentionDot ? 'Show floating workspace, new activity' : 'Show floating workspace'

  return (
    <FloatingWorkspaceTriggerMenu currentLocation="floating-button" className="fixed z-[46]" style={{ left: position.left, top: position.top }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            // On light pages a soft shadow lifts it; near-black dark surfaces need a lighter fill and hairline ring.
            className="relative cursor-grab rounded-lg border-transparent bg-card text-foreground shadow-[0_4px_12px_rgb(0_0_0_/_0.22),0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)] hover:-translate-y-0.5 hover:bg-accent active:translate-y-0 active:cursor-grabbing dark:bg-accent dark:shadow-[0_6px_16px_rgb(0_0_0_/_0.55),0_0_0_1px_rgb(255_255_255_/_0.22)] dark:hover:bg-[color-mix(in_srgb,var(--accent)_82%,white)]"
            data-floating-workspace-trigger
            aria-label={label}
            aria-pressed={open}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: position.left, top: position.top, moved: false }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              const dx = event.clientX - drag.startX
              const dy = event.clientY - drag.startY
              if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
              drag.moved = true
              const next = clampTriggerPosition({ left: drag.left + dx, top: drag.top + dy })
              stagedRef.current = next
              setPosition(next)
            }}
            onPointerUp={(event) => {
              const drag = dragRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              suppressClickRef.current = drag.moved
              if (drag.moved && stagedRef.current) commit(stagedRef.current)
              dragRef.current = null
            }}
            onPointerCancel={() => {
              dragRef.current = null
            }}
            onClick={(event) => {
              // A drag ends with a click; it must not also toggle the panel.
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                event.preventDefault()
                return
              }
              onToggle()
            }}
          >
            <PanelsTopLeft className="size-4" />
            {showAttentionDot ? (
              <span
                aria-hidden
                data-floating-workspace-attention
                className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-amber-500 ring-2 ring-card dark:ring-accent"
              />
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={6}>
          {`${open ? 'Minimize' : 'Show'} floating workspace${shortcut ? ` (${shortcut})` : ''}`}
        </TooltipContent>
      </Tooltip>
    </FloatingWorkspaceTriggerMenu>
  )
}
