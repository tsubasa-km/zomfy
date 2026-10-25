import { Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { allWorkspaces, selectSession, useStore, type Session } from '@/session-store'
import { AgentStateDot } from '@/components/AgentStateDot'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { sessionAgent } from '@/lib/chat-agents'
import { SESSION_DOT } from '@/components/sidebar/WorkspaceCardBadges'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { closeSession } from '@/daemon-connection'
import { useTabLayout } from '@/stores/tab-layout-store'

// Orca's worktree-card-compact-agent-row: one agent tab under its workspace card.
export function SessionRow({ session, showWorkspace }: { session: Session; showWorkspace?: boolean }) {
  const workspaceName = useStore((s) => allWorkspaces(s).find((w) => w.id === session.workspaceId)?.name ?? '')
  // A chat whose tab was closed is still here; clicking it brings the tab back.
  const tabClosed = useTabLayout((s) => Boolean(s.hidden[session.id]))
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div
      role="button"
      tabIndex={0}
      data-session-id={session.id}
      data-session-status={session.status}
      data-tab-closed={tabClosed || undefined}
      title={tabClosed ? 'Tab closed: click to open it again' : undefined}
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 pl-[22px] text-[12px] text-muted-foreground hover:bg-worktree-sidebar-accent/60 hover:text-foreground',
        tabClosed && 'opacity-60'
      )}
      onClick={(e) => {
        e.stopPropagation()
        selectSession(session.id)
      }}
    >
      {session.role === 'lead' ? (
        <Crown className="size-[11px] shrink-0 text-amber-500" aria-label="Project lead" />
      ) : (
        <TuiAgentIcon agent={sessionAgent(session)} size={11} />
      )}
      <span className="min-w-0 flex-1 truncate">
        {showWorkspace ? `${workspaceName} · ` : ''}
        {session.title}
      </span>
      <AgentStateDot state={SESSION_DOT[session.status]} size="sm" />
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => selectSession(session.id)}>Open</ContextMenuItem>
        {session.role !== 'lead' && (
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              if (window.confirm(`Delete "${session.title}"? Its conversation is removed for good.`)) closeSession(session.id)
            }}
          >
            Delete chat…
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
