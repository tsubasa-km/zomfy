import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Globe, Pin, Plus, SquareArrowOutUpRight, SquareTerminal, X } from 'lucide-react'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { BrowserTabView } from './BrowserTabView'
import {
  closeWorkspaceTabs,
  moveToTabStrip,
  newDrawerBrowser,
  newTerminalTab,
  openPanelTab,
  tabTitle,
  useWorkspaceTabs,
  type WorkspaceTab
} from './workspace-tab-model'
import { WorkspacePanelView, useWorkspacePanels } from './workspace-panels'
import { SurfaceList, type Surface } from './SurfaceList'
import { allWorkspaces, useStore } from '@/session-store'
import { setDrawerDepth, setDrawerDock, useDrawerDepth, useDrawerDock } from '@/stores/drawer-dock-store'
import { drawerAlongEdge, drawerDragTarget, drawerMinDepth, drawerResizeDepth, isDrawerSide, type DrawerDock, type DrawerEdge, type DrawerPoint } from './drawer-docking'
import { DrawerMemory, modeChangeUnpins } from './drawer-memory'
import './tool-drawer.css'
import { useTabLayout } from '@/stores/tab-layout-store'
import { getSetting, useSetting } from '@/stores/settings-store'
import { takeDrawerRequest, useDrawerRequest } from '@/stores/drawer-request-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Short enough to feel like pulling a tab, long enough that crossing the handle on the way to a tab opens nothing.
const OPEN_DELAY_MS = 120
const CLOSE_DELAY_MS = 400

/** The pull tab: a filled shape, no outline, whose sides slope in to a rounded bottom. */
function TabShape({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 112 20" preserveAspectRatio="none" aria-hidden className="absolute inset-0 size-full">
      <path d="M0 0 L7 15.5 Q8.9 20 13.5 20 H98.5 Q103.1 20 105 15.5 L112 0 Z" className={cn('transition-colors', className)} />
    </svg>
  )
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])'

/** The first control in the drawer's surface, or its inner handle when the surface has none. */
function firstFocusable(drawer: HTMLElement): HTMLElement | null {
  return drawer.querySelector<HTMLElement>(`.tool-drawer__surface :is(${FOCUSABLE})`) ?? drawer.querySelector<HTMLElement>('.tool-drawer__tab--inner')
}

const OPPOSITE_EDGE: Record<DrawerEdge, DrawerEdge> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const HANDLE_FILL = 'fill-[color-mix(in_srgb,var(--foreground)_9%,var(--background))]'

interface DockDrag {
  handle: HTMLButtonElement
  pointerId: number
  start: DrawerPoint
  edge: DrawerEdge
  offset: number
  detached: boolean
  moved: boolean
}

interface DockPreview {
  dock: DrawerDock | null
  x: number
  y: number
}

const remembered = new DrawerMemory()

/** The keys of the drawer's list of surfaces, by panel id: T3 Code's where it has the same surface. */
const PANEL_KEYS: Record<string, string> = {
  'panel:explorer': 'F',
  'panel:search': '/',
  'panel:source-control': 'D',
  'panel:checks': 'P',
  'panel:side-chat': 'S'
}
/** Panels about a git checkout, which a plain folder cannot show. */
const GIT_PANELS = new Set(['panel:source-control', 'panel:checks'])

/**
 * The project's terminals, browsers and panels (explorer, search, source control, checks, ports, side
 * chat, agent). The handle opens it on hover or click, depending on the setting. The drawer
 * remembers its pin and choice for `tabId`. The focused pane also answers requests from elsewhere.
 */
export function ToolDrawer({
  workspaceId,
  tabId,
  exclude,
  focused = false
}: {
  workspaceId: string
  tabId?: string
  exclude?: string | null
  focused?: boolean
}) {
  // Its own terminals and browsers: opened here, or moved here from the tab strip. The strip's stay there.
  const tabs = useWorkspaceTabs(workspaceId, 'drawer')
  const tools = tabs.flatMap((t): Extract<WorkspaceTab, { kind: 'terminal' | 'browser' }>[] =>
    (t.kind === 'terminal' || t.kind === 'browser') && t.id !== exclude ? [t] : []
  )
  const meta = useTabLayout((s) => s.meta)
  const openAction = useSetting('drawerOpenAction')
  const openOnClick = openAction === 'click'
  const kept = remembered.recall(tabId)
  // The tab's hover-mode pin: kept through click mode, which shows no pin.
  const [hoverPinned, setPinned] = useState(kept?.pinned ?? false)
  const pinned = !openOnClick && hoverPinned
  const [open, setOpen] = useState(pinned)
  const [activeId, setActiveId] = useState<string | null>(kept?.activeId ?? null)
  useEffect(() => {
    remembered.remember(tabId, { pinned: hoverPinned, activeId })
  }, [tabId, hoverPinned, activeId])
  const rootRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const dock = useDrawerDock()
  const side = isDrawerSide(dock.edge)
  const depth = useDrawerDepth(dock.edge)
  const drag = useRef<DockDrag | null>(null)
  const ignorePointerClick = useRef(false)
  const [preview, setPreview] = useState<DockPreview | null>(null)
  const resizing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Entering click mode unpins the active drawer only; other tabs keep their pins for hover mode.
  const lastAction = useRef(openAction)
  useEffect(() => {
    if (modeChangeUnpins(lastAction.current, openAction, focused)) setPinned(false)
    lastAction.current = openAction
    return () => clearTimeout(timer.current)
  }, [openAction])
  // A terminal or browser opened from here comes to the front.
  const known = useRef<Set<string> | null>(null)
  const toolIds = tools.map((t) => t.id).join(',')
  useEffect(() => {
    const ids = toolIds ? toolIds.split(',') : []
    const added = known.current ? ids.find((id) => !known.current!.has(id)) : undefined
    if (added) setActiveId(added)
    known.current = new Set(ids)
  }, [toolIds])

  const shown = open || pinned
  const handleRef = useRef<HTMLButtonElement>(null)
  // Opened from the keyboard, the drawer takes the focus its now hidden handle had.
  const focusOnOpen = useRef(false)
  useEffect(() => {
    const drawer = drawerRef.current
    if (shown) {
      if (!focusOnOpen.current || !drawer) return
      focusOnOpen.current = false
      const frame = requestAnimationFrame(() => firstFocusable(drawer)?.focus({ preventScroll: true }))
      return () => cancelAnimationFrame(frame)
    }
    // Keys must not keep going to a terminal nobody can see: they go back to the handle.
    const focused = document.activeElement
    if (focused instanceof HTMLElement && drawer?.contains(focused)) {
      focused.blur()
      handleRef.current?.focus({ preventScroll: true })
    }
  }, [shown])

  // Enabled plugins' panels follow the built-in ones.
  const panels = useWorkspacePanels()
  const panel = panels.find((p) => p.id === activeId)
  const activeTool = panel ? undefined : (tools.find((t) => t.id === activeId) ?? tools[0])
  const activePanel = panel?.id
  const git = useStore((s) => Boolean(allWorkspaces(s).find((w) => w.id === workspaceId)?.branch))
  // Nothing open here yet: the drawer offers its surfaces instead of guessing one.
  const surfaces: Surface[] = [
    {
      id: 'terminal',
      key: 'T',
      label: t('Terminal'),
      icon: <SquareTerminal className="size-4" />,
      open: () => void newTerminalTab(workspaceId, undefined, { select: false, drawer: true })
    },
    { id: 'browser', key: 'B', label: t('Browser'), icon: <Globe className="size-4" />, open: () => newDrawerBrowser(workspaceId) },
    ...panels.map(({ id, label, icon: Icon }) => ({
      id,
      key: PANEL_KEYS[id],
      label,
      icon: <Icon className="size-4" />,
      open: () => setActiveId(id),
      unavailable: GIT_PANELS.has(id) && !git
    }))
  ]
  const terminals = tools.filter((t) => t.kind === 'terminal').length
  const browsers = tools.filter((t) => t.kind === 'browser').length

  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current)
    if (getSetting('drawerOpenAction') === 'click' || drag.current || resizing.current) return
    timer.current = setTimeout(() => setOpen(next), ms)
  }

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || resizing.current || drag.current) return
    const handle = event.currentTarget
    const rect = handle.getBoundingClientRect()
    const center = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    const start = { clientX: event.clientX, clientY: event.clientY }
    ignorePointerClick.current = false
    clearTimeout(timer.current)
    handle.setPointerCapture(event.pointerId)
    drag.current = {
      handle,
      pointerId: event.pointerId,
      start,
      edge: dock.edge,
      offset: drawerAlongEdge(dock.edge, start) - drawerAlongEdge(dock.edge, center),
      detached: false,
      moved: false
    }
  }

  const updateDrag = (event: React.PointerEvent<HTMLButtonElement>): DockPreview | null => {
    const active = drag.current
    const bounds = rootRef.current?.getBoundingClientRect()
    if (!active || active.pointerId !== event.pointerId || !bounds) return null
    const { clientX, clientY } = event
    if (!active.moved && Math.hypot(clientX - active.start.clientX, clientY - active.start.clientY) < 5) return null
    active.moved = true
    const target = drawerDragTarget(bounds, active.edge, active.start, event, active.offset, active.detached)
    active.detached = target.detached
    return { dock: target.dock, x: clientX - bounds.left, y: clientY - bounds.top }
  }

  const finishDrag = (target: DrawerDock | null = null) => {
    const active = drag.current
    if (!active) return
    drag.current = null
    ignorePointerClick.current = active.moved
    if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId)
    setPreview(null)
    if (target) setDrawerDock(target)
  }

  useEffect(() => {
    if (!openOnClick) {
      finishDrag()
      return
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return
      event.preventDefault()
      event.stopPropagation()
      finishDrag()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [openOnClick])

  const dragEvents = {
    onPointerDown: startDrag,
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const next = updateDrag(event)
      if (next) setPreview(next)
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      const next = updateDrag(event)
      finishDrag(next?.dock)
    },
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId === event.pointerId) finishDrag()
    },
    onLostPointerCapture: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId === event.pointerId) finishDrag()
    }
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drawer = drawerRef.current
    const root = rootRef.current
    const handle = event.currentTarget
    if (!drawer || !root || !event.isPrimary || event.button !== 0 || drag.current || resizing.current) return
    event.preventDefault()
    const pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    resizing.current = true
    clearTimeout(timer.current)
    const start = { clientX: event.clientX, clientY: event.clientY }
    const rect = drawer.getBoundingClientRect()
    const startDepth = side ? rect.width : rect.height
    let next = startDepth
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return
      const bounds = root.getBoundingClientRect()
      next = drawerResizeDepth(dock.edge, startDepth, start, move, side ? bounds.width : bounds.height)
      drawer.style.setProperty('--drawer-live-depth', `${next}px`)
    }
    const finish = (end: PointerEvent) => {
      if (end.pointerId !== pointerId) return
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      handle.removeEventListener('lostpointercapture', finish)
      resizing.current = false
      if (end.type === 'pointerup') onMove(end)
      drawer.style.removeProperty('--drawer-live-depth')
      if (end.type === 'pointerup' && next !== startDepth) setDrawerDepth(dock.edge, next)
      if (!pinned && !drawer.matches(':hover')) later(false, CLOSE_DELAY_MS)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
    handle.addEventListener('lostpointercapture', finish)
  }

  // A shortcut, side chat or checks badge opens a panel and pins it in hover mode.
  const request = useDrawerRequest((r) => r)
  const showing = activePanel ?? activeTool?.id ?? null
  useEffect(() => {
    if (!request || !focused || request.workspaceId !== workspaceId) return
    takeDrawerRequest(request)
    clearTimeout(timer.current)
    const hide = request.action === 'hide' || (request.action === 'toggle' && shown && (!request.panel || request.panel === showing))
    if (hide) {
      if (!openOnClick) setPinned(false)
      setOpen(false)
      return
    }
    if (request.panel) setActiveId(request.panel)
    if (!openOnClick) setPinned(true)
    setOpen(true)
    // Only a new request acts; what the drawer shows when it arrives is read, not watched.
  }, [request, focused, workspaceId])

  const positionStyle = { '--drawer-position': `${dock.position * 100}%`, '--drawer-min-depth': `${drawerMinDepth(dock.edge)}px` } as React.CSSProperties
  const countTitle = `${terminals === 1 ? t('{n} terminal', { n: terminals }) : t('{n} terminals', { n: terminals })} · ${browsers === 1 ? t('{n} browser', { n: browsers }) : t('{n} browsers', { n: browsers })}`
  const handleCursor = openOnClick ? 'cursor-grab' : 'cursor-pointer'
  const innerHandleLabel = openOnClick ? t('Close the tool drawer') : pinned ? t('Unpin') : t('Keep open')
  return (
    <div ref={rootRef} style={positionStyle} className="tool-drawer pointer-events-none absolute inset-0 z-10 [container-type:size] [--tab-bottom-inset:0px] [--tab-left-inset:0px] [--tab-right-inset:0px] [--tab-top-inset:0px]">
      <button
        type="button"
        className={cn('tool-drawer__tab group text-muted-foreground hover:text-foreground', shown ? 'invisible' : 'pointer-events-auto', handleCursor, preview && 'opacity-0')}
        data-drawer-handle
        data-edge={dock.edge}
        ref={handleRef}
        aria-label={t('Open the tool drawer')}
        aria-expanded={shown}
        title={countTitle}
        {...(openOnClick ? dragEvents : undefined)}
        onPointerEnter={openOnClick ? undefined : () => later(true, OPEN_DELAY_MS)}
        onPointerLeave={() => {
          if (!drag.current && !shown) clearTimeout(timer.current)
        }}
        onClick={(event) => {
          if (event.detail && ignorePointerClick.current) return
          focusOnOpen.current = event.detail === 0
          setOpen(true)
        }}
      >
        <span className="tool-drawer__tab-art">
          <TabShape className={cn(HANDLE_FILL, 'group-hover:fill-[color-mix(in_srgb,var(--foreground)_16%,var(--background))]')} />
          <ChevronDown className="relative size-4" />
        </span>
      </button>
      <div
        ref={drawerRef}
        data-drawer={shown ? 'open' : 'closed'}
        data-edge={dock.edge}
        onPointerEnter={openOnClick ? undefined : () => shown && clearTimeout(timer.current)}
        onPointerLeave={openOnClick || pinned ? undefined : () => later(false, CLOSE_DELAY_MS)}
        className={cn('tool-drawer__shell', !shown && 'invisible')}
        style={depth === undefined ? undefined : { '--drawer-depth': `${depth}px` } as React.CSSProperties}
      >
        <div className={cn('tool-drawer__surface flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-background shadow-lg', shown && 'pointer-events-auto')}>
          <div className="tool-drawer__toolbar shrink-0 gap-0.5 border-b border-border bg-muted/40 px-1">
            <div className="tool-drawer__tools">
              <div className="scrollbar-sleek flex min-w-0 items-center gap-0.5 overflow-x-auto">
                {tools.map((tool) => (
                  <div
                    key={tool.id}
                    data-drawer-tool-tab={tool.id}
                    className={cn(
                      'group/tool flex max-w-40 shrink-0 items-center rounded-md text-xs',
                      tool.id === activeTool?.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/50'
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-1 py-1 pl-2"
                      onClick={() => {
                        setActiveId(tool.id)
                        // A clicked terminal takes the keys; one shown by hovering leaves them where they were.
                        if (tool.kind === 'terminal')
                          requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-drawer-tool="${tool.id}"] .xterm-helper-textarea`)?.focus())
                      }}
                    >
                      {tool.kind === 'terminal' ? <SquareTerminal className="size-3" /> : <Globe className="size-3" />}
                      <span className="truncate">{tabTitle(tool, meta[tool.id])}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={tool.kind === 'terminal' ? t('Close terminal') : t('Close browser')}
                      title={tool.kind === 'terminal' ? t('Close terminal') : t('Close browser')}
                      className="mr-0.5 ml-0.5 flex size-4 items-center justify-center rounded-sm opacity-0 group-hover/tool:opacity-100 hover:bg-accent"
                      onClick={() => closeWorkspaceTabs(workspaceId, [tool])}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={t('New terminal or browser')}
                    data-drawer-new
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                {/* Opened here, they belong to the drawer, not the tab strip, and come to its front. */}
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => void newTerminalTab(workspaceId, undefined, { select: false, drawer: true })}>
                    <SquareTerminal className="size-3.5" />
                    {t('Terminal')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => newDrawerBrowser(workspaceId)}>
                    <Globe className="size-3.5" />
                    {t('Browser')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="tool-drawer__panels gap-0.5 border-l border-border pl-1">
              {panels.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  data-drawer-panel={id}
                  // A second click puts the panel away, back to the terminals or the list of surfaces.
                  onClick={() => setActiveId(id === activePanel ? null : id)}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md',
                    id === activePanel ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
              {(activePanel || activeTool) && (
                // What is shown here moves into the tab strip (a panel as a tab of its own), and the drawer closes.
                <button
                  type="button"
                  title={t('Open as tab')}
                  aria-label={t('Open as tab')}
                  data-drawer-open-tab
                  onClick={() => {
                    if (activePanel) openPanelTab(workspaceId, activePanel)
                    else if (activeTool) moveToTabStrip(workspaceId, activeTool.id)
                    if (!openOnClick) setPinned(false)
                    setOpen(false)
                  }}
                  className="ml-0.5 flex size-6 items-center justify-center rounded-md border-l border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                >
                  <SquareArrowOutUpRight className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            {tools.map((t) => (
              <div key={t.id} data-drawer-tool={t.id} className={cn('absolute inset-0 flex flex-col', t.id !== activeTool?.id && 'invisible')}>
                {t.kind === 'terminal' ? <TerminalTabBody tabId={t.id} terminal={t.terminal} /> : <BrowserTabView tab={t.browser} />}
              </div>
            ))}
            {activePanel && (
              <div className="absolute inset-0 flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
                <WorkspacePanelView key={activePanel} id={activePanel} workspaceId={workspaceId} />
              </div>
            )}
            {!activePanel && !activeTool && shown && (
              // It shows under the pointer while the person may be typing elsewhere, so it takes the keys only when clicked.
              <div className="absolute inset-0 flex flex-col" data-drawer-surfaces>
                <SurfaceList surfaces={surfaces} focus="never" />
              </div>
            )}
          </div>
        </div>
        <div
          role="separator"
          aria-orientation={side ? 'vertical' : 'horizontal'}
          aria-label={t('Resize tool drawer')}
          title={side ? t('Drag to change the width · double-click to reset') : t('Drag to change the height · double-click to reset')}
          data-drawer-resize
          data-edge={dock.edge}
          className={cn('tool-drawer__resize group/resize', shown && 'pointer-events-auto')}
          onPointerDown={startResize}
          onDoubleClick={() => setDrawerDepth(dock.edge)}
        >
          <span className="rounded-full bg-transparent transition-colors group-hover/resize:bg-highlight/60 group-active/resize:bg-highlight" />
        </div>
        <button
          type="button"
          title={innerHandleLabel}
          aria-label={innerHandleLabel}
          aria-expanded={openOnClick ? shown : undefined}
          aria-pressed={openOnClick ? undefined : pinned}
          {...(openOnClick ? dragEvents : undefined)}
          onClick={(event) => {
            if (openOnClick) {
              if (event.detail && ignorePointerClick.current) return
              setOpen(false)
            } else {
              setPinned(!pinned)
              setOpen(true)
            }
          }}
          className={cn(
            'tool-drawer__tab tool-drawer__tab--inner group/inner',
            shown && 'pointer-events-auto',
            handleCursor,
            preview && 'opacity-0',
            pinned ? 'text-white' : 'text-muted-foreground hover:text-foreground'
          )}
          data-edge={OPPOSITE_EDGE[dock.edge]}
          data-drawer-pin={openOnClick ? undefined : true}
          data-drawer-close={openOnClick ? true : undefined}
        >
          <span className="tool-drawer__tab-art">
            <TabShape className={pinned ? 'fill-highlight' : cn(HANDLE_FILL, 'group-hover/inner:fill-[color-mix(in_srgb,var(--foreground)_16%,var(--background))]')} />
            {openOnClick
              ? <ChevronDown className="relative size-4 rotate-180" />
              : <Pin className={cn('tool-drawer__pin-icon relative size-3.5', pinned && 'fill-current')} />}
          </span>
        </button>
      </div>
      {preview && (
        <div aria-hidden className="absolute inset-0 z-20" data-drawer-drag-preview>
          {preview.dock && <div className="tool-drawer__target" data-edge={preview.dock.edge} />}
          <div
            className={cn('tool-drawer__tab text-white', !preview.dock && 'tool-drawer__tab--floating')}
            data-edge={preview.dock?.edge}
            style={preview.dock
              ? { '--drawer-position': `${preview.dock.position * 100}%` } as React.CSSProperties
              : { left: preview.x, top: preview.y }}
          >
            <span className="tool-drawer__tab-art">
              <TabShape className="fill-highlight" />
              <ChevronDown className="relative size-4" />
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
