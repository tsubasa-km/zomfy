import { useEffect, useRef, useState } from 'react'
import { FileDiff, Globe, Pin, PinOff, Plus, SquareTerminal } from 'lucide-react'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { BrowserTabView } from './BrowserTabView'
import { newTerminalTab, tabTitle, useWorkspaceTabs, type WorkspaceTab } from './workspace-tab-model'
import { useTabLayout } from '@/stores/tab-layout-store'
import { cn } from '@/lib/utils'

const OPEN_DELAY_MS = 250
const CLOSE_DELAY_MS = 400

type ToolTab = Extract<WorkspaceTab, { kind: 'terminal' | 'browser' }> | { kind: 'changes'; id: 'changes' }

/**
 * The project's terminals and browsers, pulled down from under a tab strip: hovering the handle opens it,
 * leaving closes it unless it is pinned or holds focus. `exclude` is the pane's own active tab.
 */
export function ToolDrawer({ workspaceId, exclude }: { workspaceId: string; exclude?: string | null }) {
  const tabs = useWorkspaceTabs(workspaceId)
  const tools = tabs.filter((t) => (t.kind === 'terminal' || t.kind === 'browser') && t.id !== exclude)
  const meta = useTabLayout((s) => s.meta)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inside = useRef(false)
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

  const items: ToolTab[] = [
    ...tools.flatMap((t): ToolTab[] => (t.kind === 'terminal' || t.kind === 'browser' ? [t] : [])),
    { kind: 'changes', id: 'changes' }
  ]
  const active = items.find((t) => t.id === activeId) ?? items[0]!
  const terminals = tools.filter((t) => t.kind === 'terminal').length
  const browsers = tools.filter((t) => t.kind === 'browser').length
  const shown = open || pinned

  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }
  // Typing in the drawer's terminal keeps it open after the pointer wanders off.
  const leave = () => {
    if (rootRef.current?.contains(document.activeElement)) return clearTimeout(timer.current)
    later(false, CLOSE_DELAY_MS)
  }

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-10 flex flex-col"
      onBlur={(e) => {
        if (!pinned && !inside.current && !rootRef.current?.contains(e.relatedTarget instanceof Node ? e.relatedTarget : null)) later(false, CLOSE_DELAY_MS)
      }}
    >
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
          <FileDiff className="size-3" />
        </div>
      </div>
      <div
        data-drawer={shown ? 'open' : 'closed'}
        onPointerEnter={() => {
          inside.current = true
          if (shown) clearTimeout(timer.current)
        }}
        onPointerLeave={() => {
          inside.current = false
          if (!pinned) leave()
        }}
        className={cn(
          'absolute inset-x-1.5 top-0 flex h-3/5 min-h-48 flex-col overflow-hidden rounded-b-lg border border-t-0 border-border bg-background shadow-lg transition-[transform,opacity] duration-150',
          shown ? 'pointer-events-auto translate-y-0 opacity-100' : 'invisible -translate-y-3 opacity-0'
        )}
      >
        <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-muted/40 px-1">
          {items.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveId(t.id)}
              className={cn(
                'flex max-w-40 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs',
                t.id === active.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/50'
              )}
            >
              {t.kind === 'terminal' ? <SquareTerminal className="size-3" /> : t.kind === 'browser' ? <Globe className="size-3" /> : <FileDiff className="size-3" />}
              <span className="truncate">{t.kind === 'changes' ? 'Changes' : tabTitle(t, meta[t.id])}</span>
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
          <button
            type="button"
            title={pinned ? 'Unpin' : 'Keep open'}
            onClick={() => {
              setPinned(!pinned)
              setOpen(true)
            }}
            className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            data-drawer-pin
          >
            {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {items.map((t) =>
            t.kind === 'changes' ? null : (
              <div key={t.id} className={cn('absolute inset-0 flex flex-col', t.id !== active.id && 'invisible')}>
                {t.kind === 'terminal' ? <TerminalTabBody tabId={t.id} terminal={t.terminal} /> : <BrowserTabView tab={t.browser} />}
              </div>
            )
          )}
          {active.kind === 'changes' && (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
              This session's changes would show here. The agent merges or opens a PR when it finishes.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
