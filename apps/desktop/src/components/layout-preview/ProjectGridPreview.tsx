import { useEffect, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { allProjects, allWorkspaces, getState, useStore } from '@/session-store'
import { ensureSessionLoaded } from '@/daemon-connection'
import { projectLabel, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { ThreadView } from '@/components/ThreadView'
import { ToolDrawer } from '@/components/tab-layout/ToolDrawer'
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
  // Every chat of the workspace, including ones whose tab was closed: the pane is the session list.
  const sessions = useStore((s) => s.sessions)
  const chats = sessions.filter((c) => c.workspaceId === workspaceId && !c.sideOf).sort((a, b) => b.createdAt - a.createdAt)
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
        <ToolDrawer workspaceId={workspaceId} />
      </div>
    </section>
  )
}
