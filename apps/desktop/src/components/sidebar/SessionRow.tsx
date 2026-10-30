import { useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { allWorkspaces, getState, selectSession, useStore, type Session } from '@/session-store'
import { AgentStateDot } from '@/components/AgentStateDot'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { sessionAgent } from '@/lib/chat-agents'
import { SESSION_DOT } from '@/components/sidebar/WorkspaceCardBadges'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { closeSession } from '@/daemon-connection'
import { renameChat, setChatArchived } from '@/chat-rename-archive'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { hideChats, removeTabsFromLayout, useTabLayout } from '@/stores/tab-layout-store'
import { chatSelection, gestureOf, keepTextUnselected } from '@/stores/list-selection'
import { beginSidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import { toggleChatExpanded } from '@/stores/sidebar-store'

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
  showActive,
  fold,
  child
}: {
  session: Session
  showWorkspace?: boolean
  /** Where the chat works when that is not the project's own checkout (its worktree's branch). */
  place?: string
  /** Dragging the row drags its workspace (onto the main area, to open it beside others). */
  drag?: DragItem
  /** Mark the chat that is open in the focused workspace (the project chat list has no card to mark). */
  showActive?: boolean
  /** A parent chat's fold: how many chats sit under it, and the most pressing of their states. */
  fold?: { count: number; expanded: boolean; status: Session['status'] }
  /** Drawn indented, under its parent chat. */
  child?: boolean
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
  const archiveAll = (archived: boolean) => {
    for (const s of targets()) void setChatArchived(s.id, archived)
    chatSelection.reset()
  }
  const [renaming, setRenaming] = useState<string | null>(null)
  const renameAfterClose = useRef(false)
  const commitRename = () => {
    if (renaming === null) return
    setRenaming(null)
    void renameChat(session.id, renaming)
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
      data-session-archived={session.archived || undefined}
      data-session-child={child || undefined}
      title={session.archived ? 'Archived: click to open it' : tabClosed ? 'Tab closed: click to open it again' : undefined}
      className={cn(
        'relative flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 text-[12px] text-muted-foreground hover:bg-worktree-sidebar-accent/60 hover:text-foreground',
        child ? 'pl-[36px]' : 'pl-[22px]',
        (tabClosed || session.archived) && renaming === null && 'opacity-60',
        selected && 'bg-worktree-sidebar-accent text-foreground opacity-100',
        open && 'bg-worktree-sidebar-accent/70 text-foreground opacity-100'
      )}
      // The workspace card around it has its own menu; this row's is the one meant.
      onContextMenu={(e) => e.stopPropagation()}
      onPointerDown={drag && renaming === null ? (e) => beginSidebarDrag(e, drag, session.title) : undefined}
      onMouseDown={keepTextUnselected}
      onClick={(e) => {
        e.stopPropagation()
        if (renaming !== null) return
        const gesture = gestureOf(e)
        if (gesture) {
          chatSelection.gesture(SCOPE, session.id, gesture, openChatId(), renderedChats(e.currentTarget))
          return
        }
        chatSelection.reset(SCOPE, session.id)
        selectSession(session.id)
      }}
    >
      {fold && (
        <button
          type="button"
          aria-label={fold.expanded ? 'Hide chats under this one' : 'Show chats under this one'}
          aria-expanded={fold.expanded}
          data-chat-fold
          className="absolute left-[5px] flex size-4 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-worktree-sidebar-accent hover:text-foreground"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            toggleChatExpanded(session.id)
          }}
        >
          <ChevronRight className={cn('size-3 transition-transform', fold.expanded && 'rotate-90')} />
        </button>
      )}
      <TuiAgentIcon agent={sessionAgent(session)} size={11} />
      {renaming !== null ? (
        <Input
          autoFocus
          data-session-rename-input
          aria-label={`Rename chat ${session.title}`}
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (isImeOwnedKeyboardEvent(e)) return
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setRenaming(null)
            }
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-5 min-w-0 flex-1 px-1 py-0 text-xs"
          spellCheck={false}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          {showWorkspace ? `${workspaceName} · ` : ''}
          {session.title}
        </span>
      )}
      {session.archived && renaming === null && (
        <span className="shrink-0 text-[10px] text-muted-foreground/80" data-session-archived-tag>
          Archived
        </span>
      )}
      {place && (
        <span className="max-w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground/80" title={place} data-session-place>
          {place}
        </span>
      )}
      {fold && !fold.expanded && (
        <span
          className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/80 tabular-nums"
          title={`${fold.count} chat${fold.count === 1 ? '' : 's'} under this one`}
          data-chat-children={fold.count}
        >
          {fold.count}
          {fold.status !== 'idle' && <AgentStateDot state={SESSION_DOT[fold.status]} size="sm" />}
        </span>
      )}
      <AgentStateDot state={SESSION_DOT[session.status]} size="sm" />
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          if (!renameAfterClose.current) return
          renameAfterClose.current = false
          // Why: opening the input in onSelect lets the closing menu take focus back and blur it.
          event.preventDefault()
          setRenaming(session.title)
        }}
      >
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
            {targets().some((s) => !s.archived) ? (
              <ContextMenuItem data-chat-action="archive-selected" onSelect={() => archiveAll(true)}>
                Archive {targets().length} chats
              </ContextMenuItem>
            ) : (
              <ContextMenuItem data-chat-action="unarchive-selected" onSelect={() => archiveAll(false)}>
                Unarchive {targets().length} chats
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" data-chat-action="delete-selected" onSelect={() => deleteChats(targets())}>
              Delete {targets().length} chats…
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => selectSession(session.id)}>Open</ContextMenuItem>
            <ContextMenuItem data-chat-action="rename" onSelect={() => (renameAfterClose.current = true)}>
              Rename…
            </ContextMenuItem>
            <ContextMenuItem
              data-chat-action={session.archived ? 'unarchive' : 'archive'}
              onSelect={() => void setChatArchived(session.id, !session.archived)}
            >
              {session.archived ? 'Unarchive' : 'Archive'}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => deleteChats([session])}>
              Delete chat…
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
