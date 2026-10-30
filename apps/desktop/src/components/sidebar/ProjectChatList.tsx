import { Fragment, type ComponentProps } from 'react'
import type { Workspace } from '@acp-harness/protocol'
import { selectWorkspace, type HostId, type Session } from '@/session-store'
import { SessionRow } from '@/components/sidebar/SessionRow'
import { workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { useSidebarStore } from '@/stores/sidebar-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// A project as a list of its chats: where each one works (its worktree) is a small tag on the row,
// not a card of its own. Chats that need the person, then working ones, come first. A workflow's
// step chats and a side chat sit folded under the chat they work for, one level deep.

/** A worktree's short name: its branch without the owner prefix ("user/fix-x" → "fix-x"). */
function placeOf(w: Workspace): string {
  return (w.branch ?? workspaceLabel(w)).split('/').pop()!
}

const RANK: Record<Session['status'], number> = { 'needs-you': 0, error: 1, working: 2, idle: 3 }

/** The chat a chat is listed under: a side chat's main chat, a workflow step's starting chat. */
export function parentOf(session: Session): string | undefined {
  return session.parentId ?? session.sideOf
}

/** The most pressing of the chats' states. */
export function mostPressing(sessions: Session[]): Session['status'] {
  return sessions.reduce<Session['status']>((top, s) => (RANK[s.status] < RANK[top] ? s.status : top), 'idle')
}

/** The project's top-level chats, each with the chats under it; a chat whose parent is not listed stands on its own. */
export function projectChatTree(workspaces: Workspace[], sessions: Session[]): { chat: Session; children: Session[] }[] {
  const ids = new Set(workspaces.map((w) => w.id))
  const listed = sessions.filter((s) => ids.has(s.workspaceId))
  const byId = new Map(listed.map((s) => [s.id, s]))
  // The listed chat at the top of a chat's parents; a chat deeper than one level joins that one too.
  const rootOf = (s: Session): Session => {
    const seen = new Set([s.id])
    let at = s
    for (let up = byId.get(parentOf(at) ?? ''); up && !seen.has(up.id); up = byId.get(parentOf(at) ?? '')) {
      seen.add(up.id)
      at = up
    }
    return at
  }
  const roots = new Map(listed.map((s) => [s.id, rootOf(s)]))
  const top = listed.filter((s) => roots.get(s.id) === s && !s.sideOf)
  // Children read in the order they were started: a workflow's steps, then its helpers.
  const tree = top.map((chat) => ({
    chat,
    children: listed.filter((s) => s !== chat && roots.get(s.id) === chat).sort((a, b) => a.createdAt - b.createdAt)
  }))
  // A child that needs the person lifts its parent with it.
  const rank = (node: (typeof tree)[number]) => RANK[mostPressing([node.chat, ...node.children])]
  return tree.sort((a, b) => rank(a) - rank(b) || b.chat.createdAt - a.chat.createdAt)
}

/** How many chats the project lists at the top level. */
export function projectChats(workspaces: Workspace[], sessions: Session[]): Session[] {
  return projectChatTree(workspaces, sessions).map((node) => node.chat)
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
  const tree = projectChatTree(workspaces, sessions)
  const expanded = useSidebarStore((s) => s.expandedChats)
  // A worktree with no chat yet still needs a way in.
  const empty = workspaces.filter((w) => !tree.some((n) => [n.chat, ...n.children].some((s) => s.workspaceId === w.id)))
  const row = (s: Session, extra: Partial<ComponentProps<typeof SessionRow>> = {}) => {
    const w = byId.get(s.workspaceId)
    return (
      <SessionRow
        key={s.id}
        session={s}
        showActive
        place={w && !w.isPrimary ? placeOf(w) : undefined}
        drag={w ? { kind: 'workspace', id: w.id, hostId: hostOf(w), projectId: w.projectId } : undefined}
        {...extra}
      />
    )
  }
  return (
    <div className="space-y-px pr-1" data-project-chats>
      {tree.map(({ chat, children }) => {
        const open = expanded.includes(chat.id)
        return (
          <Fragment key={chat.id}>
            {row(chat, children.length > 0 ? { fold: { count: children.length, expanded: open, status: mostPressing(children) } } : {})}
            {open && children.map((child) => row(child, { child: true }))}
          </Fragment>
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
          <span className="min-w-0 flex-1 truncate italic">{t('No chats yet')}</span>
          {!w.isPrimary && <span className="max-w-24 shrink-0 truncate font-mono text-[10px]">{placeOf(w)}</span>}
        </button>
      ))}
    </div>
  )
}
