import type { Workspace } from '@acp-harness/protocol'
import { selectWorkspace, type HostId, type Session } from '@/session-store'
import { SessionRow } from '@/components/sidebar/SessionRow'
import { workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { cn } from '@/lib/utils'

// A project as a list of its chats: where each one works (its worktree) is a small tag on the row,
// not a card of its own. Chats that need the person, then working ones, come first.

/** A worktree's short name: its branch without the owner prefix ("user/fix-x" → "fix-x"). */
function placeOf(w: Workspace): string {
  return (w.branch ?? workspaceLabel(w)).split('/').pop()!
}

const RANK: Record<Session['status'], number> = { 'needs-you': 0, error: 1, working: 2, idle: 3 }

export function projectChats(workspaces: Workspace[], sessions: Session[]): Session[] {
  const ids = new Set(workspaces.map((w) => w.id))
  return sessions
    .filter((s) => ids.has(s.workspaceId) && !s.sideOf)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.createdAt - a.createdAt)
}

export function ProjectChatList({
  workspaces,
  sessions,
  activeWorkspaceId,
  hostOf
}: {
  workspaces: Workspace[]
  sessions: Session[]
  activeWorkspaceId: string | null
  hostOf: (workspace: Workspace) => HostId
}) {
  const byId = new Map(workspaces.map((w) => [w.id, w]))
  const chats = projectChats(workspaces, sessions)
  // A worktree with no chat yet still needs a way in.
  const empty = workspaces.filter((w) => !chats.some((s) => s.workspaceId === w.id))
  return (
    <div className="space-y-px pr-1" data-project-chats>
      {chats.map((s) => {
        const w = byId.get(s.workspaceId)
        return (
          <SessionRow
            key={s.id}
            session={s}
            showActive
            place={w && !w.isPrimary ? placeOf(w) : undefined}
            drag={w ? { kind: 'workspace', id: w.id, hostId: hostOf(w), projectId: w.projectId } : undefined}
          />
        )
      })}
      {empty.map((w) => (
        <button
          key={w.id}
          type="button"
          data-empty-workspace={w.id}
          onClick={() => selectWorkspace(w.id)}
          className={cn(
            'flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 pl-[22px] text-left text-[12px] text-muted-foreground/70 hover:bg-worktree-sidebar-accent/60 hover:text-foreground',
            w.id === activeWorkspaceId && 'text-foreground'
          )}
        >
          <span className="min-w-0 flex-1 truncate italic">No chats yet</span>
          {!w.isPrimary && <span className="max-w-24 shrink-0 truncate font-mono text-[10px]">{placeOf(w)}</span>}
        </button>
      ))}
    </div>
  )
}
