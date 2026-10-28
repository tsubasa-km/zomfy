import { cn } from '@/lib/utils'
import { allWorkspaces, getState, selectSession, useStore, type Session } from '@/session-store'
import { AgentStateDot } from '@/components/AgentStateDot'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { sessionAgent } from '@/lib/chat-agents'
import { SESSION_DOT } from '@/components/sidebar/WorkspaceCardBadges'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { closeSession } from '@/daemon-connection'
import { hideChats, removeTabsFromLayout, useTabLayout } from '@/stores/tab-layout-store'
import { chatSelection, gestureOf } from '@/stores/list-selection'
import { beginSidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'

const SCOPE = 'sidebar'

/** Chat rows as the sidebar draws them, for Shift ranges; a chat listed twice counts once. */
function renderedChats(row: Element): string[] {
  const root = row.closest('aside, nav') ?? document
  return [...new Set([...root.querySelectorAll<HTMLElement>('[data-session-id]')].map((el) => el.dataset.sessionId!))]
}

/** The chat open in front, which joins the first Ctrl-click's selection. */
function openChatId(): string | null {
  const { activeWorkspaceId, activeSessionByWorkspace } = getState()
  return activeWorkspaceId ? (activeSessionByWorkspace[activeWorkspaceId] ?? null) : null
}

/** Takes the chats' tabs away; the chats stay in the sidebar, as a tab's close does. */
function closeChatTabs(ids: string[]): void {
  const sessions = getState().sessions.filter((s) => ids.includes(s.id))
  for (const workspaceId of new Set(sessions.map((s) => s.workspaceId))) {
    removeTabsFromLayout(workspaceId, sessions.filter((s) => s.workspaceId === workspaceId).map((s) => s.id))
  }
  hideChats(ids)
}

function deleteChats(sessions: Session[]): void {
  const what = sessions.length === 1 ? `"${sessions[0]!.title}"` : `${sessions.length} chats`
  if (!window.confirm(`Delete ${what}? Their conversations are removed for good.`)) return
  chatSelection.reset()
  for (const s of sessions) void closeSession(s.id)
}

// Orca's worktree-card-compact-agent-row: one agent tab under its workspace card.
export function SessionRow({
  session,
  showWorkspace,
  place,
  drag,
  showActive
}: {
  session: Session
  showWorkspace?: boolean
  /** Where the chat works when that is not the project's own checkout (its worktree's branch). */
  place?: string
  /** Dragging the row drags its workspace (onto the main area, to open it beside others). */
  drag?: DragItem
  /** Mark the chat that is open in the focused workspace (the project chat list has no card to mark). */
  showActive?: boolean
}) {
  const open = useStore((s) => Boolean(showActive) && s.activeWorkspaceId === session.workspaceId && s.activeSessionByWorkspace[session.workspaceId] === session.id)
  const workspaceName = useStore((s) => allWorkspaces(s).find((w) => w.id === session.workspaceId)?.name ?? '')
  // A chat whose tab was closed is still here; clicking it brings the tab back.
  const tabClosed = useTabLayout((s) => Boolean(s.hidden[session.id]))
  const selected = chatSelection.use((s) => s.scope === SCOPE && s.ids.length > 1 && s.ids.includes(session.id))
  const targets = () => {
    const ids = chatSelection.targets(session.id)
    return getState().sessions.filter((s) => ids.includes(s.id))
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div
      role="button"
      tabIndex={0}
      data-session-id={session.id}
      data-session-status={session.status}
      data-tab-closed={tabClosed || undefined}
      data-session-selected={selected || undefined}
      data-session-open={open || undefined}
      title={tabClosed ? 'Tab closed: click to open it again' : undefined}
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 pl-[22px] text-[12px] text-muted-foreground hover:bg-worktree-sidebar-accent/60 hover:text-foreground',
        tabClosed && 'opacity-60',
        selected && 'bg-worktree-sidebar-accent text-foreground opacity-100',
        open && 'bg-worktree-sidebar-accent/70 text-foreground opacity-100'
      )}
      // The workspace card around it has its own menu; this row's is the one meant.
      onContextMenu={(e) => e.stopPropagation()}
      onPointerDown={drag ? (e) => beginSidebarDrag(e, drag, session.title) : undefined}
      onClick={(e) => {
        e.stopPropagation()
        const gesture = gestureOf(e)
        if (gesture) {
          chatSelection.gesture(SCOPE, session.id, gesture, openChatId(), renderedChats(e.currentTarget))
          return
        }
        chatSelection.reset(SCOPE, session.id)
        selectSession(session.id)
      }}
    >
      <TuiAgentIcon agent={sessionAgent(session)} size={11} />
      <span className="min-w-0 flex-1 truncate">
        {showWorkspace ? `${workspaceName} · ` : ''}
        {session.title}
      </span>
      {place && (
        <span className="max-w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground/80" title={place} data-session-place>
          {place}
        </span>
      )}
      <AgentStateDot state={SESSION_DOT[session.status]} size="sm" />
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {selected ? (
          <>
            <ContextMenuItem data-chat-action="open-selected" onSelect={() => targets().forEach((s) => selectSession(s.id))}>
              Open {targets().length} chats
            </ContextMenuItem>
            <ContextMenuItem
              data-chat-action="close-selected"
              onSelect={() => {
                closeChatTabs(targets().map((s) => s.id))
                chatSelection.reset()
              }}
            >
              Close {targets().length} tabs
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" data-chat-action="delete-selected" onSelect={() => deleteChats(targets())}>
              Delete {targets().length} chats…
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => selectSession(session.id)}>Open</ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => deleteChats([session])}>
              Delete chat…
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
