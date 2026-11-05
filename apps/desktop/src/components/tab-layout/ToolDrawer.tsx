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
import { PANELS, WorkspacePanelView, useWorkspacePanels } from './workspace-panels'
import { useTabLayout } from '@/stores/tab-layout-store'
import { takeDrawerRequest, useDrawerRequest } from '@/stores/drawer-request-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

const OPEN_DELAY_MS = 250
const CLOSE_DELAY_MS = 400

/** The pull tab: a filled shape, no outline, whose sides slope in to a rounded bottom. */
function TabShape({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 112 20" aria-hidden className="absolute inset-0 size-full">
      <path d="M0 0 L7 15.5 Q8.9 20 13.5 20 H98.5 Q103.1 20 105 15.5 L112 0 Z" className={cn('transition-colors', className)} />
    </svg>
  )
}

// What each tab's drawer was left showing, so coming back to a tab finds its drawer as it was.
const remembered = new Map<string, { pinned: boolean; activeId: string | null }>()

/**
 * The project's terminals, browsers and panels (explorer, search, source control, checks, ports, side
 * chat, agent), pulled down from under a tab strip: hovering the handle opens it, leaving it closes it
 * unless pinned. `tabId` is the tab it hangs from, whose pin and choice it remembers; `exclude` is the
 * pane's own active tab. The focused pane's drawer also answers what opens a panel from elsewhere.
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
  const kept = tabId ? remembered.get(tabId) : undefined
  const [pinned, setPinned] = useState(kept?.pinned ?? false)
  const [open, setOpen] = useState(kept?.pinned ?? false)
  const [activeId, setActiveId] = useState<string | null>(kept?.activeId ?? null)
  useEffect(() => {
    if (tabId) remembered.set(tabId, { pinned, activeId })
  }, [tabId, pinned, activeId])
  const rootRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
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
  // The pull tab slides down out of the tab strip once the tab is on show, and back up under it while the drawer is out.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    // Two frames, so the tab is first laid out tucked away and the slide has somewhere to start from.
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setEntered(true))))
    return () => cancelAnimationFrame(frame)
  }, [])
  // Keys must not keep going to a terminal nobody can see.
  useEffect(() => {
    const focused = document.activeElement
    if (!shown && focused instanceof HTMLElement && rootRef.current?.contains(focused)) focused.blur()
  }, [shown])

  // Enabled plugins' panels follow the built-in ones.
  const panels = useWorkspacePanels()
  const panel = panels.find((p) => p.id === activeId)
  const activeTool = panel ? undefined : (tools.find((t) => t.id === activeId) ?? tools[0])
  const activePanel = panel?.id ?? (activeTool ? undefined : PANELS[0].id)
  const terminals = tools.filter((t) => t.kind === 'terminal').length
  const browsers = tools.filter((t) => t.kind === 'browser').length

  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }

  // A shortcut, a side chat or a checks badge asks for a panel; it stays open (pinned) until put away.
  const request = useDrawerRequest((r) => r)
  const showing = activePanel ?? activeTool?.id ?? null
  useEffect(() => {
    if (!request || !focused || request.workspaceId !== workspaceId) return
    takeDrawerRequest(request)
    clearTimeout(timer.current)
    const hide = request.action === 'hide' || (request.action === 'toggle' && shown && (!request.panel || request.panel === showing))
    if (hide) {
      setPinned(false)
      setOpen(false)
      return
    }
    if (request.panel) setActiveId(request.panel)
    setPinned(true)
    setOpen(true)
    // Only a new request acts; what the drawer shows when it arrives is read, not watched.
  }, [request, focused, workspaceId])

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-10 flex flex-col">
      {/* A pull tab hanging off the tab strip; its chevron points the way the drawer comes. */}
      <div
        className="group pointer-events-auto mx-auto flex h-5 w-32 shrink-0 justify-center overflow-hidden"
        data-drawer-handle
        title={`${terminals === 1 ? t('{n} terminal', { n: terminals }) : t('{n} terminals', { n: terminals })} · ${browsers === 1 ? t('{n} browser', { n: browsers }) : t('{n} browsers', { n: browsers })}`}
        onPointerEnter={() => later(true, OPEN_DELAY_MS)}
        // Leaving the tab for anywhere but the drawer lets an unpinned drawer close; going onto the drawer keeps it.
        onPointerLeave={() => (shown ? !pinned && later(false, CLOSE_DELAY_MS) : clearTimeout(timer.current))}
      >
        <span
          className={cn(
            'relative flex h-5 w-28 justify-center text-muted-foreground transition-[color,translate] duration-200 ease-out group-hover:text-foreground',
            (!entered || shown) && '-translate-y-full'
          )}
        >
          {/* A solid grey a step off the canvas, so the tab reads without an outline in either theme. */}
          <TabShape className="fill-[color-mix(in_srgb,var(--foreground)_9%,var(--background))] group-hover:fill-[color-mix(in_srgb,var(--foreground)_16%,var(--background))]" />
          <ChevronDown className="relative mt-0.5 size-4" />
        </span>
      </div>
      <div
        data-drawer={shown ? 'open' : 'closed'}
        onPointerEnter={() => shown && clearTimeout(timer.current)}
        onPointerLeave={() => !pinned && later(false, CLOSE_DELAY_MS)}
        // The band at the bottom holds the pin tab, so the drawer and its tab are one thing to light and leave.
        className={cn(
          'absolute inset-x-1.5 top-0 flex h-3/5 max-h-full min-h-48 flex-col pb-5 transition-[clip-path,visibility] duration-200 ease-out',
          !shown && 'invisible'
        )}
        // Unrolls from the tab strip down, and rolls back up; the sides and bottom leave room for the shadow.
        style={{ clipPath: shown ? 'inset(0 -24px -24px -24px)' : 'inset(0 -24px 100% -24px)' }}
      >
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-lg border border-t-0 border-border bg-background shadow-lg', shown && 'pointer-events-auto')}>
        <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-muted/40 px-1">
          <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
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
          <div className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-border pl-1">
            {panels.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                title={label}
                aria-label={label}
                data-drawer-panel={id}
                onClick={() => setActiveId(id)}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md',
                  id === activePanel ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
            {(activePanel || activeTool) && (
              // What is shown here moves into the tab strip (a panel as a tab of its own), and the drawer goes back up.
              <button
                type="button"
                title={t('Open as tab')}
                aria-label={t('Open as tab')}
                data-drawer-open-tab
                onClick={() => {
                  if (activePanel) openPanelTab(workspaceId, activePanel)
                  else if (activeTool) moveToTabStrip(workspaceId, activeTool.id)
                  setPinned(false)
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
        </div>
        </div>
        {/* The tab that pulled the drawer down now hangs under it and pins it open. */}
        <button
          type="button"
          title={pinned ? t('Unpin') : t('Keep open')}
          aria-label={pinned ? t('Unpin') : t('Keep open')}
          aria-pressed={pinned}
          onClick={() => {
            setPinned(!pinned)
            setOpen(true)
          }}
          className={cn(
            'group/pin absolute bottom-0 left-1/2 flex h-5 w-28 -translate-x-1/2 justify-center',
            shown && 'pointer-events-auto',
            pinned ? 'text-white' : 'text-muted-foreground hover:text-foreground'
          )}
          data-drawer-pin
        >
          <TabShape
            className={
              pinned
                ? 'fill-highlight'
                : 'fill-[color-mix(in_srgb,var(--foreground)_9%,var(--background))] group-hover/pin:fill-[color-mix(in_srgb,var(--foreground)_16%,var(--background))]'
            }
          />
          <Pin className={cn('relative mt-[3px] size-3.5', pinned && 'fill-current')} />
        </button>
      </div>
    </div>
  )
}
