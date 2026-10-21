import { useEffect } from 'react'
import { Plus, SquareTerminal, X } from 'lucide-react'
import type { TerminalInfo } from '@acp-harness/protocol'
import {
  closeSession,
  closeTerminal,
  createSession,
  createTerminal,
  ensureSessionLoaded
} from '@/daemon-connection'
import { selectSession, selectTerminal, useStore, type Session } from '@/session-store'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { ClaudeIcon } from '@/components/agent-icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ThreadView } from '@/components/ThreadView'
import { TerminalView } from '@/components/TerminalView'
import { cn } from '@/lib/utils'

// Tab strip classes follow Orca's tab-bar (tab-bar-surface.tsx, SortableTab.tsx, tab-width-rules.ts,
// tab-bar-static-create-menu.tsx).

const TAB_DOT: Partial<Record<Session['status'], AgentDotState>> = {
  'needs-you': 'waiting',
  working: 'working',
  error: 'failed'
}

type Tab = { kind: 'chat'; session: Session } | { kind: 'terminal'; terminal: TerminalInfo }

function tabId(tab: Tab): string {
  return tab.kind === 'chat' ? tab.session.id : tab.terminal.id
}

export function WorkspaceTabs({
  workspaceId,
  trailing,
  emptyHint
}: {
  workspaceId: string
  /** Controls drawn at the strip's right edge (the floating panel's window buttons). */
  trailing?: React.ReactNode
  emptyHint: string
}) {
  const sessions = useStore((s) => s.sessions)
  const terminals = useStore((s) => s.terminals)
  const activeId = useStore((s) => s.activeSessionByWorkspace[workspaceId])
  const tabs: Tab[] = [
    ...sessions.filter((s) => s.workspaceId === workspaceId).map((session) => ({ kind: 'chat' as const, session })),
    ...terminals
      .filter((t) => t.workspaceId === workspaceId)
      .map((terminal) => ({ kind: 'terminal' as const, terminal }))
  ].sort((a, b) => createdAt(a) - createdAt(b))
  const active = tabs.find((t) => tabId(t) === activeId) ?? tabs.at(-1) ?? null
  const activeChatId = active?.kind === 'chat' ? active.session.id : undefined

  useEffect(() => {
    if (activeChatId) void ensureSessionLoaded(activeChatId)
  }, [activeChatId])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
        <div className="terminal-tab-strip flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden">
          {tabs.map((tab) => (
            <TabItem key={tabId(tab)} tab={tab} active={active !== null && tabId(tab) === tabId(active)} />
          ))}
          <NewTabMenu workspaceId={workspaceId} />
        </div>
        {trailing}
      </div>
      {active?.kind === 'chat' && <ThreadView key={active.session.id} session={active.session} />}
      {active?.kind === 'terminal' && <TerminalView key={active.terminal.id} terminal={active.terminal} />}
      {!active && <div className="m-auto text-sm text-muted-foreground">{emptyHint}</div>}
    </div>
  )
}

function createdAt(tab: Tab): number {
  return tab.kind === 'chat' ? tab.session.createdAt : tab.terminal.createdAt
}

function NewTabMenu({ workspaceId }: { workspaceId: string }) {
  const shells = useStore((s) => s.shells)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="New tab"
          className="my-auto ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 rounded-[11px]">
        <DropdownMenuItem data-new-tab="claude" onSelect={() => void createSession(workspaceId)}>
          <ClaudeIcon size={14} />
          New Claude Chat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Terminal</DropdownMenuLabel>
        {shells.map((shell) => (
          <DropdownMenuItem
            key={shell.id}
            data-new-tab={`terminal:${shell.id}`}
            onSelect={() => void createTerminal(workspaceId, shell.id)}
          >
            <SquareTerminal className="size-4" />
            New Terminal ({shell.label})
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const title = tab.kind === 'chat' ? tab.session.title : tab.terminal.title
  const close = () => (tab.kind === 'chat' ? closeSession(tab.session.id) : closeTerminal(tab.terminal.id))
  const select = () => (tab.kind === 'chat' ? selectSession(tab.session.id) : selectTerminal(tab.terminal.id))
  const dot = tab.kind === 'chat' ? TAB_DOT[tab.session.status] : undefined

  return (
    <div
      role="tab"
      aria-selected={active}
      data-tab-id={tabId(tab)}
      data-tab-kind={tab.kind}
      onClick={select}
      onAuxClick={(e) => e.button === 1 && close()}
      className={cn(
        'group relative flex h-full w-[180px] min-w-[72px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-1.5 text-xs select-none min-[1280px]:w-[220px]',
        active
          ? 'bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))] text-foreground'
          : 'bg-card text-muted-foreground hover:text-foreground'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {dot ? (
          <AgentStateDot state={dot} size="sm" />
        ) : tab.kind === 'chat' ? (
          <ClaudeIcon size={12} />
        ) : (
          <SquareTerminal className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <button
        type="button"
        aria-label={`Close ${title}`}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
        onClick={(e) => {
          e.stopPropagation()
          close()
        }}
      >
        <X className="size-3" />
      </button>
      {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-foreground" />}
    </div>
  )
}
