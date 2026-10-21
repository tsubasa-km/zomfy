import { allWorkspaces, selectSession, useStore, type Session } from '@/session-store'
import { AgentStateDot } from '@/components/AgentStateDot'
import { ClaudeIcon } from '@/components/agent-icons'
import { SESSION_DOT } from '@/components/sidebar/WorkspaceCardBadges'

// Orca's worktree-card-compact-agent-row: one agent tab under its workspace card.
export function SessionRow({ session, showWorkspace }: { session: Session; showWorkspace?: boolean }) {
  const workspaceName = useStore((s) => allWorkspaces(s).find((w) => w.id === session.workspaceId)?.name ?? '')
  return (
    <div
      role="button"
      tabIndex={0}
      data-session-id={session.id}
      data-session-status={session.status}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 pl-[22px] text-[12px] text-muted-foreground hover:bg-worktree-sidebar-accent/60 hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation()
        selectSession(session.id)
      }}
    >
      <ClaudeIcon size={11} />
      <span className="min-w-0 flex-1 truncate">
        {showWorkspace ? `${workspaceName} · ` : ''}
        {session.title}
      </span>
      <AgentStateDot state={SESSION_DOT[session.status]} size="sm" />
    </div>
  )
}
