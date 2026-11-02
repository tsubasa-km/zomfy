import { useEffect, useRef, useState } from 'react'
import { Bot, Files, GitCompare, Globe, ListChecks, MessagesSquare, Pin, Plug, Plus, Search, SquareTerminal } from 'lucide-react'
import { allWorkspaces, useStore } from '@/session-store'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { FileExplorer } from '@/components/right-sidebar/FileExplorer'
import { SearchPanel } from '@/components/right-sidebar/SearchPanel'
import { SourceControl } from '@/components/right-sidebar/SourceControl'
import { ChecksPanel } from '@/components/right-sidebar/checks/ChecksPanel'
import { PortsPanel } from '@/components/right-sidebar/PortsPanel'
import { SideChatPanel } from '@/components/right-sidebar/SideChatPanel'
import { AgentPanel } from '@/components/right-sidebar/AgentPanel'
import { PluginPanel } from '@/components/right-sidebar/PluginPanel'
import { useActivePluginPanels } from '@/plugins/plugin-registry'
import { resolvePluginPanelIcon } from '@/plugins/plugin-panel-icons'
import { addBrowserTab } from '@/stores/browser-tab-store'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { BrowserTabView } from './BrowserTabView'
import { newTerminalTab, tabTitle, useWorkspaceTabs, type WorkspaceTab } from './workspace-tab-model'
import { useTabLayout } from '@/stores/tab-layout-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

const OPEN_DELAY_MS = 250
const CLOSE_DELAY_MS = 400

// The right sidebar's panels, in its order.
const PANELS = [
  { id: 'panel:explorer', label: t('Explorer'), icon: Files },
  { id: 'panel:search', label: t('Search'), icon: Search },
  { id: 'panel:source-control', label: t('Source Control'), icon: GitCompare },
  { id: 'panel:checks', label: t('Checks'), icon: ListChecks },
  { id: 'panel:ports', label: t('Ports'), icon: Plug },
  { id: 'panel:side-chat', label: t('Side chat'), icon: MessagesSquare },
  { id: 'panel:agent', label: t('Agent'), icon: Bot }
] as const

function PanelBody({ id, workspaceId }: { id: string; workspaceId: string }) {
  const name = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.name ?? '')
  switch (id) {
    case 'panel:explorer':
      return <FileExplorer workspaceId={workspaceId} rootName={name} />
    case 'panel:search':
      return <SearchPanel workspaceId={workspaceId} />
    case 'panel:source-control':
      return <SourceControl workspaceId={workspaceId} />
    case 'panel:checks':
      return <ChecksPanel workspaceId={workspaceId} />
    case 'panel:ports':
      return <PortsPanel workspaceId={workspaceId} />
    case 'panel:side-chat':
      return <SideChatPanel workspaceId={workspaceId} />
    case 'panel:agent':
      return <AgentPanel workspaceId={workspaceId} />
    default:
      return null
  }
}

/** The pull tab's outline: sides slope in to a rounded bottom, the top open onto the edge it hangs from. */
function TabShape({ className }: { className?: string }) {
  return (
    <svg width="44" height="16" viewBox="0 0 44 16" aria-hidden className="absolute inset-0">
      <path d="M0.5 0 L6 12.6 Q7.3 15.5 10.4 15.5 H33.6 Q36.7 15.5 38 12.6 L43.5 0" className={cn('transition-colors', className)} />
    </svg>
  )
}

/**
 * The project's terminals, browsers and the right sidebar's panels, pulled down from under a tab strip:
 * hovering the handle opens it, leaving it closes it unless pinned. `exclude` is the pane's own active tab.
 */
export function ToolDrawer({ workspaceId, exclude }: { workspaceId: string; exclude?: string | null }) {
  const tabs = useWorkspaceTabs(workspaceId)
  const tools = tabs.flatMap((t): Extract<WorkspaceTab, { kind: 'terminal' | 'browser' }>[] =>
    (t.kind === 'terminal' || t.kind === 'browser') && t.id !== exclude ? [t] : []
  )
  const meta = useTabLayout((s) => s.meta)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
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
  // Keys must not keep going to a terminal nobody can see.
  useEffect(() => {
    const focused = document.activeElement
    if (!shown && focused instanceof HTMLElement && rootRef.current?.contains(focused)) focused.blur()
  }, [shown])

  // Enabled plugins' panels follow the built-in ones, as in the right sidebar.
  const plugins = useActivePluginPanels()
  const pluginPanels = plugins.map((p) => ({ id: `plugin:${p.tab}`, label: `${p.title} · ${p.pluginName}`, icon: resolvePluginPanelIcon(p.icon) }))
  const activePlugin = plugins.find((p) => `plugin:${p.tab}` === activeId)
  const panel = [...PANELS, ...pluginPanels].find((p) => p.id === activeId)
  const activeTool = panel ? undefined : (tools.find((t) => t.id === activeId) ?? tools[0])
  const activePanel = panel?.id ?? (activeTool ? undefined : PANELS[0].id)
  const terminals = tools.filter((t) => t.kind === 'terminal').length
  const browsers = tools.filter((t) => t.kind === 'browser').length

  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-10 flex flex-col">
      {/* A small pull tab hanging off the tab strip, its arrow pointing the way the drawer comes. */}
      <div
        className="group pointer-events-auto mx-auto flex h-4 w-24 shrink-0 justify-center"
        data-drawer-handle
        title={`${terminals === 1 ? t('{n} terminal', { n: terminals }) : t('{n} terminals', { n: terminals })} · ${browsers === 1 ? t('{n} browser', { n: browsers }) : t('{n} browsers', { n: browsers })}`}
        onPointerEnter={() => later(true, OPEN_DELAY_MS)}
        onPointerLeave={() => !shown && clearTimeout(timer.current)}
      >
        <span className={cn('relative flex h-4 w-11 justify-center text-muted-foreground/60 transition-[color,opacity] group-hover:text-foreground/80', shown && 'opacity-0')}>
          <TabShape className="fill-muted stroke-border group-hover:fill-accent" />
          <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden className="relative mt-[5px]">
            <path d="M0.5 0 H7.5 L4 4.5 Z" fill="currentColor" />
          </svg>
        </span>
      </div>
      <div
        data-drawer={shown ? 'open' : 'closed'}
        onPointerEnter={() => shown && clearTimeout(timer.current)}
        onPointerLeave={() => !pinned && later(false, CLOSE_DELAY_MS)}
        // The band at the bottom holds the pin tab, so the drawer and its tab are one thing to light and leave.
        className={cn(
          'absolute inset-x-1.5 top-0 flex h-3/5 min-h-48 flex-col pb-4 transition-[clip-path,visibility] duration-200 ease-out',
          !shown && 'invisible'
        )}
        // Unrolls from the tab strip down, and rolls back up; the sides and bottom leave room for the shadow.
        style={{ clipPath: shown ? 'inset(0 -24px -24px -24px)' : 'inset(0 -24px 100% -24px)' }}
      >
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-lg border border-t-0 border-border bg-background shadow-lg', shown && 'pointer-events-auto')}>
        <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-muted/40 px-1">
          <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setActiveId(t.id)
                  // A clicked terminal takes the keys; one shown by hovering leaves them where they were.
                  if (t.kind === 'terminal')
                    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-drawer-tool="${t.id}"] .xterm-helper-textarea`)?.focus())
                }}
                className={cn(
                  'flex max-w-40 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs',
                  t.id === activeTool?.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                {t.kind === 'terminal' ? <SquareTerminal className="size-3" /> : <Globe className="size-3" />}
                <span className="truncate">{tabTitle(t, meta[t.id])}</span>
              </button>
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
              {/* Opened here, they stay out of the pane's tab: the drawer brings them to the front. */}
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => void newTerminalTab(workspaceId, undefined, { select: false })}>
                  <SquareTerminal className="size-3.5" />
                  {t('Terminal')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addBrowserTab(workspaceId)}>
                  <Globe className="size-3.5" />
                  {t('Browser')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-border pl-1">
            {[...PANELS, ...pluginPanels].map(({ id, label, icon: Icon }) => (
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
              {activePlugin ? (
                <PluginPanel key={`${activePlugin.tab}:${workspaceId}`} panel={activePlugin} workspaceId={workspaceId} />
              ) : (
                <PanelBody key={`${activePanel}:${workspaceId}`} id={activePanel} workspaceId={workspaceId} />
              )}
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
            'group/pin absolute bottom-[1px] left-1/2 flex h-4 w-11 -translate-x-1/2 justify-center',
            shown && 'pointer-events-auto',
            pinned ? 'text-white' : 'text-muted-foreground/70 hover:text-foreground'
          )}
          data-drawer-pin
        >
          <TabShape className={pinned ? 'fill-highlight stroke-highlight' : 'fill-background stroke-border group-hover/pin:fill-accent'} />
          <Pin className={cn('relative mt-[3px] size-2.5', pinned && 'fill-current')} />
        </button>
      </div>
    </div>
  )
}
