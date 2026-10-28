import { useEffect, useRef, useState } from 'react'
import { Bot, Files, GitCompare, Globe, ListChecks, MessagesSquare, Pin, PinOff, Plug, Plus, Search, SquareTerminal } from 'lucide-react'
import { allWorkspaces, useStore } from '@/session-store'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { FileExplorer } from '@/components/right-sidebar/FileExplorer'
import { SearchPanel } from '@/components/right-sidebar/SearchPanel'
import { SourceControl } from '@/components/right-sidebar/SourceControl'
import { ChecksPanel } from '@/components/right-sidebar/checks/ChecksPanel'
import { PortsPanel } from '@/components/right-sidebar/PortsPanel'
import { SideChatPanel } from '@/components/right-sidebar/SideChatPanel'
import { AgentPanel } from '@/components/right-sidebar/AgentPanel'
import { BrowserTabView } from './BrowserTabView'
import { newTerminalTab, tabTitle, useWorkspaceTabs, type WorkspaceTab } from './workspace-tab-model'
import { useTabLayout } from '@/stores/tab-layout-store'
import { cn } from '@/lib/utils'

const OPEN_DELAY_MS = 250
const CLOSE_DELAY_MS = 400

// The right sidebar's panels, in its order.
const PANELS = [
  { id: 'panel:explorer', label: 'Explorer', icon: Files },
  { id: 'panel:search', label: 'Search', icon: Search },
  { id: 'panel:source-control', label: 'Source Control', icon: GitCompare },
  { id: 'panel:checks', label: 'Checks', icon: ListChecks },
  { id: 'panel:ports', label: 'Ports', icon: Plug },
  { id: 'panel:side-chat', label: 'Side chat', icon: MessagesSquare },
  { id: 'panel:agent', label: 'Agent', icon: Bot }
] as const

type PanelId = (typeof PANELS)[number]['id']

function PanelBody({ id, workspaceId }: { id: PanelId; workspaceId: string }) {
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
  }
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

  const panel = PANELS.find((p) => p.id === activeId)
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
      <div
        className="pointer-events-auto flex h-4 shrink-0 justify-center"
        data-drawer-handle
        onPointerEnter={() => later(true, OPEN_DELAY_MS)}
        onPointerLeave={() => !shown && clearTimeout(timer.current)}
      >
        <div
          className={cn(
            'flex h-4 items-center gap-2 rounded-b-md border border-t-0 border-border bg-muted px-2 text-xs leading-none text-muted-foreground transition-opacity',
            shown && 'opacity-0'
          )}
        >
          <span className="flex items-center gap-0.5">
            <SquareTerminal className="size-3" />
            {terminals}
          </span>
          <span className="flex items-center gap-0.5">
            <Globe className="size-3" />
            {browsers}
          </span>
          <Files className="size-3" />
        </div>
      </div>
      <div
        data-drawer={shown ? 'open' : 'closed'}
        onPointerEnter={() => shown && clearTimeout(timer.current)}
        onPointerLeave={() => !pinned && later(false, CLOSE_DELAY_MS)}
        className={cn(
          'absolute inset-x-1.5 top-0 flex h-3/5 min-h-48 flex-col overflow-hidden rounded-b-lg border border-t-0 border-border bg-background shadow-lg transition-[transform,opacity] duration-150',
          shown ? 'pointer-events-auto translate-y-0 opacity-100' : 'invisible -translate-y-3 opacity-0'
        )}
      >
        <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-muted/40 px-1">
          <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                className={cn(
                  'flex max-w-40 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs',
                  t.id === activeTool?.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                {t.kind === 'terminal' ? <SquareTerminal className="size-3" /> : <Globe className="size-3" />}
                <span className="truncate">{tabTitle(t, meta[t.id])}</span>
              </button>
            ))}
            <button
              type="button"
              title="New terminal"
              onClick={() => void newTerminalTab(workspaceId)}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-border pl-1">
            {PANELS.map(({ id, label, icon: Icon }) => (
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
            <button
              type="button"
              title={pinned ? 'Unpin' : 'Keep open'}
              onClick={() => {
                setPinned(!pinned)
                setOpen(true)
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              data-drawer-pin
            >
              {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {tools.map((t) => (
            <div key={t.id} className={cn('absolute inset-0 flex flex-col', t.id !== activeTool?.id && 'invisible')}>
              {t.kind === 'terminal' ? <TerminalTabBody tabId={t.id} terminal={t.terminal} /> : <BrowserTabView tab={t.browser} />}
            </div>
          ))}
          {activePanel && (
            <div className="absolute inset-0 flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
              <PanelBody key={`${activePanel}:${workspaceId}`} id={activePanel} workspaceId={workspaceId} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
