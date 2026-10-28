import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileDiff, Globe, Pin, PinOff, Plus, SquareTerminal, X } from 'lucide-react'
import { allProjects, allWorkspaces, getState, useStore } from '@/session-store'
import { ensureSessionLoaded } from '@/daemon-connection'
import { projectLabel, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { ThreadView } from '@/components/ThreadView'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { BrowserTabView } from '@/components/tab-layout/BrowserTabView'
import { newTerminalTab, tabTitle, useWorkspaceTabs, type WorkspaceTab } from '@/components/tab-layout/workspace-tab-model'
import { useTabLayout } from '@/stores/tab-layout-store'
import { createExternalStore } from '@/stores/external-store'
import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// A trial of the layout being considered: one app-wide grid of chats from different projects, each pane
// with a drawer under its tab strip that holds the project's terminals and browsers. Data is unchanged.

const PANES = 4
const OPEN_DELAY_MS = 250
const CLOSE_DELAY_MS = 400

const preview = createExternalStore<{ open: boolean; panes: (string | null)[] }>({ open: false, panes: [] })
export const useProjectGridPreview = () => preview.use((s) => s.open)

/** Busiest workspace of each project first, so the grid starts with four different projects. */
function initialPanes(): (string | null)[] {
  const s = getState()
  const chats = new Map<string, number>()
  for (const session of s.sessions) chats.set(session.workspaceId, (chats.get(session.workspaceId) ?? 0) + 1)
  const ranked = allWorkspaces(s)
    .filter((w) => w.projectId && (chats.get(w.id) ?? 0) > 0)
    .sort((a, b) => (chats.get(b.id) ?? 0) - (chats.get(a.id) ?? 0))
  const picked: string[] = []
  const projects = new Set<string>()
  for (const w of ranked) {
    if (projects.has(w.projectId!)) continue
    projects.add(w.projectId!)
    picked.push(w.id)
  }
  for (const w of ranked) if (picked.length < PANES && !picked.includes(w.id)) picked.push(w.id)
  return Array.from({ length: PANES }, (_, i) => picked[i] ?? null)
}

export function toggleProjectGridPreview(): void {
  const { open, panes } = preview.get()
  preview.set({ open: !open, panes: !open && panes.length === 0 ? initialPanes() : panes })
}

function setPane(index: number, workspaceId: string): void {
  preview.update((s) => ({ ...s, panes: s.panes.map((id, i) => (i === index ? workspaceId : id)) }))
}

export function installProjectGridPreview(): void {
  registerKeybindingDefinitions([
    {
      id: 'layoutPreview.projectGrid',
      title: 'Try Multi-Project Layout (Preview)',
      group: 'Global',
      keywords: ['layout', 'grid', 'split', 'projects', 'preview', 'drawer'],
      defaultBindings: []
    }
  ])
  registerCommandHandler('layoutPreview.projectGrid', () => toggleProjectGridPreview())
}

export function ProjectGridPreview() {
  const panes = preview.use((s) => s.panes)
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-project-grid-preview>
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span>Multi-project layout · preview</span>
        <span className="text-muted-foreground/70">Hover just under a tab bar to pull down the project's terminals and browsers.</span>
        <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={toggleProjectGridPreview}>
          <X className="size-3.5" />
          Exit preview
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-px bg-border">
        {panes.map((workspaceId, index) => (
          <PreviewPane key={index} index={index} workspaceId={workspaceId} />
        ))}
      </div>
    </div>
  )
}

function WorkspacePicker({ index, current }: { index: number; current: string | null }) {
  const options = useStore((s) => {
    const projects = new Map(allProjects(s.hosts).map((p) => [p.id, projectLabel(p)]))
    return JSON.stringify(
      allWorkspaces(s)
        .filter((w) => w.projectId)
        .map((w) => ({ id: w.id, project: projects.get(w.projectId!) ?? '', name: workspaceLabel(w), branch: w.branch }))
    )
  })
  const list: { id: string; project: string; name: string; branch: string | null }[] = JSON.parse(options)
  const here = list.find((w) => w.id === current)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-accent/50"
          data-preview-picker
        >
          <span className="max-w-32 truncate">{here ? here.project : 'Pick a project'}</span>
          {here?.branch && <span className="max-w-24 truncate font-normal text-muted-foreground">{here.branch}</span>}
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>Show in this pane</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {list.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => setPane(index, w.id)}>
            <span className="truncate">{w.project}</span>
            <span className="truncate text-muted-foreground">{w.branch ?? w.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PreviewPane({ index, workspaceId }: { index: number; workspaceId: string | null }) {
  if (!workspaceId) {
    return (
      <section className="flex min-h-0 min-w-0 flex-col bg-background">
        <header className="flex h-9 shrink-0 items-center border-b border-border px-1.5">
          <WorkspacePicker index={index} current={null} />
        </header>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Empty pane</div>
      </section>
    )
  }
  return <WorkspacePane index={index} workspaceId={workspaceId} />
}

function WorkspacePane({ index, workspaceId }: { index: number; workspaceId: string }) {
  const tabs = useWorkspaceTabs(workspaceId)
  // Every chat of the workspace, including ones whose tab was closed: the pane is the session list.
  const sessions = useStore((s) => s.sessions)
  const chats = sessions.filter((c) => c.workspaceId === workspaceId && !c.sideOf).sort((a, b) => b.createdAt - a.createdAt)
  const tools = tabs.filter((t) => t.kind === 'terminal' || t.kind === 'browser')
  const [chatId, setChatId] = useState<string | null>(null)
  const chat = chats.find((c) => c.id === chatId) ?? chats[0]
  useEffect(() => {
    if (chat) void ensureSessionLoaded(chat.id)
  }, [chat?.id])
  return (
    <section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" data-preview-pane={index}>
      <header className="flex h-9 shrink-0 items-center gap-0.5 overflow-hidden border-b border-border px-1.5">
        <WorkspacePicker index={index} current={workspaceId} />
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
          {chats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChatId(c.id)}
              className={cn(
                'max-w-40 shrink-0 truncate rounded-md px-2 py-1 text-xs',
                c.id === chat?.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
              )}
            >
              {c.title || 'Chat'}
            </button>
          ))}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {chat ? (
          <ThreadView key={chat.id} session={chat} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No chats in this workspace</div>
        )}
        <ToolDrawer workspaceId={workspaceId} tools={tools} />
      </div>
    </section>
  )
}

type ToolTab = Extract<WorkspaceTab, { kind: 'terminal' | 'browser' }> | { kind: 'changes'; id: 'changes' }

function ToolDrawer({ workspaceId, tools }: { workspaceId: string; tools: WorkspaceTab[] }) {
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
