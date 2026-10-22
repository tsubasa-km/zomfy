import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { allWorkspaces, floatingWorkspaceId, getState, setFloating, useStore } from '@/session-store'
import { useCommandHandler } from '@/keybindings/keybinding-registry'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { useWorkspaceTabs } from '@/components/tab-layout/workspace-tab-model'
import { FloatingWorkspaceToggleButton } from '@/components/floating-workspace/FloatingWorkspaceToggleButton'
import { FloatingWorkspaceWindowControls } from '@/components/floating-workspace/FloatingWorkspaceWindowControls'
import { useFloatingWorkspaceTrigger } from '@/components/floating-workspace/use-floating-workspace-trigger'
import { FloatingWorkspaceResizeHandles } from '@/components/floating-workspace/FloatingWorkspaceResizeHandles'
import {
  anchorPanelBounds,
  clampPanelBounds,
  maximizedPanelBounds,
  persistPanelBounds,
  readInitialPanelBounds,
  resolvePanelBounds,
  shouldReconcileBounds,
  type PanelBounds
} from '@/components/floating-workspace/floating-workspace-panel-bounds'
import { cn } from '@/lib/utils'

// Orca's floating workspace (floating-terminal/*, app-shell/use-floating-workspace-panel.ts): a panel
// dragged by its tab row, resized from any edge, maximized from its controls or a double-click, and
// kept mounted while minimized once it holds tabs so its terminals keep their screens.

/** Chrome inside the title row that a press must reach instead of moving the panel. */
const NO_DRAG_SELECTOR = 'button,input,textarea,select,[role="menuitem"],[data-tab-id],[data-floating-workspace-no-drag]'

/** Only a tab row touching the panel's top edge is its title bar; split panes lower down are not. */
function isTitlebarTarget(panel: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest(NO_DRAG_SELECTOR)) return false
  const strip = target.closest('[data-tab-group-strip-id]')
  if (!strip || !panel.contains(strip)) return false
  return strip.getBoundingClientRect().top - panel.getBoundingClientRect().top < 4
}

function FloatingWorkspacePanel({ workspaceId, open, maximized }: { workspaceId: string; open: boolean; maximized: boolean }) {
  const path = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.path ?? '')
  const initial = useRef<ReturnType<typeof readInitialPanelBounds> | null>(null)
  initial.current ??= readInitialPanelBounds(maximized)
  const committedRef = useRef(initial.current.committed)
  const sourceRef = useRef(initial.current.source)
  const stagedRef = useRef<PanelBounds | null>(null)
  const [bounds, setBounds] = useState(initial.current.rendered)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; bounds: PanelBounds; moved: boolean } | null>(null)

  const previewBounds = useCallback((next: PanelBounds) => {
    const clamped = clampPanelBounds(next)
    stagedRef.current = clamped
    setBounds(clamped)
  }, [])

  const commitBounds = useCallback(() => {
    const staged = stagedRef.current
    if (!staged) return
    stagedRef.current = null
    const clamped = clampPanelBounds(staged)
    setBounds(clamped)
    const anchored = anchorPanelBounds(clamped)
    if (!anchored) return
    committedRef.current = anchored
    sourceRef.current = 'user'
    persistPanelBounds(anchored)
  }, [])

  const reconcile = useCallback(() => {
    if (maximized) return setBounds(maximizedPanelBounds())
    setBounds((current) => (shouldReconcileBounds(sourceRef.current) ? resolvePanelBounds(committedRef.current, sourceRef.current) : current))
  }, [maximized])

  useLayoutEffect(reconcile, [reconcile])
  useEffect(() => {
    window.addEventListener('resize', reconcile)
    return () => window.removeEventListener('resize', reconcile)
  }, [reconcile])

  const toggleMaximized = () => setFloating({ maximized: !maximized })

  return (
    // Above notification cards, below the z-50 dialog layer. The shadow sits on the outer shell and
    // the border on an inner one; both on one rounded node made corners look stubby.
    <div
      role="dialog"
      aria-label="Floating workspace"
      aria-hidden={!open}
      data-floating-workspace
      data-maximized={maximized ? 'true' : 'false'}
      tabIndex={-1}
      className={cn(
        'fixed z-[45] flex min-h-[280px] min-w-[420px] rounded-lg bg-transparent text-card-foreground shadow-[0_4px_12px_rgba(0,0,0,0.16),0_24px_64px_rgba(0,0,0,0.32)] outline-none dark:shadow-[0_8px_20px_rgba(0,0,0,0.35),0_28px_72px_rgba(0,0,0,0.58)]',
        open ? 'opacity-100' : 'pointer-events-none invisible opacity-0'
      )}
      style={{ visibility: open ? 'visible' : 'hidden', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
      onPointerDown={(event) => {
        if (maximized || event.button !== 0 || !isTitlebarTarget(event.currentTarget, event.target)) return
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, bounds, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (dx === 0 && dy === 0) return
        drag.moved = true
        previewBounds({ ...drag.bounds, left: drag.bounds.left + dx, top: drag.bounds.top + dy })
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        if (drag.moved) commitBounds()
        dragRef.current = null
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
      onDoubleClick={(event) => {
        // The press captured the pointer to the panel, so the target is read from the point instead.
        const hit = document.elementFromPoint(event.clientX, event.clientY)
        if (event.button !== 0 || !isTitlebarTarget(event.currentTarget, hit)) return
        event.preventDefault()
        toggleMaximized()
      }}
    >
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-black/14 bg-card dark:border-white/14">
        <WorkspaceTabs
          workspaceId={workspaceId}
          emptyHint={`Floating workspace in ${path}. Use + to start Claude here.`}
          trailing={
            <FloatingWorkspaceWindowControls
              workspaceId={workspaceId}
              maximized={maximized}
              onToggleMaximized={toggleMaximized}
              onMinimize={() => setFloating({ open: false })}
            />
          }
        />
      </div>
      {!maximized && <FloatingWorkspaceResizeHandles bounds={bounds} onPreviewBounds={previewBounds} onCommitBounds={commitBounds} />}
    </div>
  )
}

export function FloatingWorkspace() {
  const floatingId = useStore((s) => floatingWorkspaceId(s))
  const { open, maximized } = useStore((s) => s.floating)
  const unread = useStore((s) => s.sessions.some((x) => x.workspaceId === floatingId && (x.status === 'needs-you' || s.unread[x.id] === true)))
  const tabCount = useWorkspaceTabs(floatingId ?? '').length
  const trigger = useFloatingWorkspaceTrigger()
  const available = trigger.enabled && floatingId !== null

  // Minimizing hands focus back to whatever the user was in before opening the panel.
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const panel = document.querySelector('[data-floating-workspace]')
    if (open) {
      const active = document.activeElement
      if (active instanceof HTMLElement && !panel?.contains(active) && !active.closest('[data-floating-workspace-toggle]')) {
        returnFocus.current = active
      }
      return
    }
    const target = returnFocus.current
    returnFocus.current = null
    if (target && document.contains(target) && (panel?.contains(document.activeElement) ?? false)) {
      requestAnimationFrame(() => target.focus({ preventScroll: true }))
    }
  }, [open])

  useEffect(() => {
    if (!trigger.enabled && getState().floating.open) setFloating({ open: false })
  }, [trigger.enabled])

  // Orca's floatingWorkspace.maximize opens the panel maximized when it is minimized.
  useCommandHandler(
    'floatingWorkspace.maximize',
    () => {
      const current = getState().floating
      setFloating(current.open ? { maximized: !current.maximized } : { open: true, maximized: true })
    },
    available
  )
  useCommandHandler(
    'floatingWorkspace.minimize',
    () => {
      if (!getState().floating.open) return false
      setFloating({ open: false })
    },
    available
  )

  if (!available) return null
  return (
    <>
      {(open || tabCount > 0) && <FloatingWorkspacePanel workspaceId={floatingId} open={open} maximized={maximized} />}
      {trigger.floatingButton && <FloatingWorkspaceToggleButton open={open} unread={unread} onToggle={() => setFloating({ open: !open })} />}
    </>
  )
}
