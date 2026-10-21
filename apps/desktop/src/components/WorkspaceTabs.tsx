import { Plus, X } from 'lucide-react'
import { closeSession, createSession } from '@/daemon-connection'
import { selectSession, useStore, type Session } from '@/session-store'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { ClaudeIcon } from '@/components/agent-icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ThreadView } from '@/components/ThreadView'
import { cn } from '@/lib/utils'

// Tab strip classes follow Orca's tab-bar (tab-bar-surface.tsx, SortableTab.tsx, tab-width-rules.ts).

const TAB_DOT: Partial<Record<Session['status'], AgentDotState>> = {
  'needs-you': 'waiting',
  working: 'working',
  error: 'failed'
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
  const sessions = useStore((s) => s.sessions).filter((s) => s.workspaceId === workspaceId)
  const activeId = useStore((s) => s.activeSessionByWorkspace[workspaceId])
  const active = sessions.find((s) => s.id === activeId) ?? sessions.at(-1) ?? null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
        <div className="terminal-tab-strip flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden">
          {sessions.map((session) => (
            <SessionTab key={session.id} session={session} active={session.id === active?.id} />
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="New Claude tab"
                className="my-auto ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                onClick={() => void createSession(workspaceId)}
              >
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New Claude tab</TooltipContent>
          </Tooltip>
        </div>
        {trailing}
      </div>
      {active ? (
        <ThreadView key={active.id} session={active} />
      ) : (
        <div className="m-auto text-sm text-muted-foreground">{emptyHint}</div>
      )}
    </div>
  )
}

function SessionTab({ session, active }: { session: Session; active: boolean }) {
  const dot = TAB_DOT[session.status]
  return (
    <div
      role="tab"
      aria-selected={active}
      data-tab-session-id={session.id}
      onClick={() => selectSession(session.id)}
      onAuxClick={(e) => e.button === 1 && closeSession(session.id)}
      className={cn(
        'group relative flex h-full w-[180px] min-w-[72px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-1.5 text-xs select-none min-[1280px]:w-[220px]',
        active
          ? 'bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))] text-foreground'
          : 'bg-card text-muted-foreground hover:text-foreground'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {dot ? <AgentStateDot state={dot} size="sm" /> : <ClaudeIcon size={12} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{session.title}</span>
      <button
        type="button"
        aria-label={`Close ${session.title}`}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
        onClick={(e) => {
          e.stopPropagation()
          closeSession(session.id)
        }}
      >
        <X className="size-3" />
      </button>
      {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-foreground" />}
    </div>
  )
}
