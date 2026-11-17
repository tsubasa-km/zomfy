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
import { setChatPinned, toggleChatExpanded } from '@/stores/sidebar-store'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { ChatCardBody, ChatHoverDetails, type ChatCardInfo } from '@/components/sidebar/ChatCard'
import { t } from '@/i18n/i18n'

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
  const question =
    sessions.length === 1
      ? t('Delete "{title}"? Their conversations are removed for good.', { title: sessions[0]!.title })
      : t('Delete {n} chats? Their conversations are removed for good.', { n: sessions.length })
  if (!window.confirm(question)) return
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
  child,
  card
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
  /** Draws the chat list's two-line row, with the rest of what is known on a hover card. */
  card?: ChatCardInfo
}) {
  const open = useStore((s) => Boolean(showActive) && s.activeWorkspaceId === session.workspaceId && s.activeSessionByWorkspace[session.workspaceId] === session.id)
  const workspaceName = useStore((s) => allWorkspaces(s).find((w) => w.id === session.workspaceId)?.name ?? '')
  // Most chats have no tab at any moment; clicking one opens it.
  const tabClosed = useTabLayout((s) => !s.open[session.id])
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
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const renameAfterClose = useRef(false)
  const commitRename = () => {
    if (renaming === null) return
    setRenaming(null)
    void renameChat(session.id, renaming)
  }
  const title =
    renaming !== null ? (
      <Input
        autoFocus
        data-session-rename-input
        aria-label={t('Rename chat {title}', { title: session.title })}
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
      <span className={cn('min-w-0 flex-1 truncate', card && 'text-foreground/90', card?.unread && 'font-semibold text-foreground')}>
        {showWorkspace ? `${workspaceName} · ` : ''}
        {session.title}
      </span>
    )
  const foldBadge = fold && !fold.expanded && (
    <span
      className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/80 tabular-nums"
      title={fold.count === 1 ? t('{n} chat under this one', { n: fold.count }) : t('{n} chats under this one', { n: fold.count })}
      data-chat-children={fold.count}
    >
      {fold.count}
      {fold.status !== 'idle' && <AgentStateDot state={SESSION_DOT[fold.status]} size="sm" />}
    </span>
  )
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      {/* The card only opens for the chat list's rows, and never over a menu or a rename. */}
      <HoverCard openDelay={500} closeDelay={80} open={Boolean(card) && hovered && !menuOpen && renaming === null} onOpenChange={setHovered}>
      <ContextMenuTrigger asChild>
        <HoverCardTrigger asChild>
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
      title={!card && session.archived ? t('Archived: click to open it') : undefined}
      className={cn(
        'group/chat relative flex min-w-0 cursor-pointer rounded-md pr-1 text-muted-foreground hover:bg-worktree-sidebar-accent/60 hover:text-foreground',
        card ? 'items-start gap-2 py-1.5 text-[13px]' : 'items-center gap-1.5 py-0.5 text-[12px]',
        child ? 'pl-[36px]' : 'pl-[22px]',
        !card && session.archived && renaming === null && 'opacity-60',
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
          aria-label={fold.expanded ? t('Hide chats under this one') : t('Show chats under this one')}
          aria-expanded={fold.expanded}
          data-chat-fold
          className={cn(
            'absolute left-[5px] flex size-4 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-worktree-sidebar-accent hover:text-foreground',
            card && 'top-2'
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            toggleChatExpanded(session.id)
          }}
        >
          <ChevronRight className={cn('size-3 transition-transform', fold.expanded && 'rotate-90')} />
        </button>
      )}
      {card ? (
        <>
          <span className="mt-[3px] flex shrink-0">
            <TuiAgentIcon agent={sessionAgent(session)} size={14} />
          </span>
          <ChatCardBody
            session={session}
            card={card}
            status={fold && fold.status !== 'idle' && session.status === 'idle' ? fold.status : session.status}
            title={title}
            trailing={foldBadge}
            busy={renaming !== null}
          />
        </>
      ) : (
        <>
          <TuiAgentIcon agent={sessionAgent(session)} size={11} />
          {title}
          {session.archived && renaming === null && (
            <span className="shrink-0 text-[10px] text-muted-foreground/80" data-session-archived-tag>
              {t('Archived')}
            </span>
          )}
          {place && (
            <span className="max-w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground/80" title={place} data-session-place>
              {place}
            </span>
          )}
          {foldBadge}
          <AgentStateDot state={SESSION_DOT[session.status]} size="sm" />
        </>
      )}
    </div>
        </HoverCardTrigger>
      </ContextMenuTrigger>
      {card && (
        <HoverCardContent side="right" align="start" sideOffset={8} className="w-72 p-3 text-xs">
          <ChatHoverDetails session={session} card={card} childCount={fold?.count ?? 0} />
        </HoverCardContent>
      )}
      </HoverCard>
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
              {t('Open {n} chats', { n: targets().length })}
            </ContextMenuItem>
            <ContextMenuItem
              data-chat-action="close-selected"
              onSelect={() => {
                closeChatTabs(targets().map((s) => s.id))
                chatSelection.reset()
              }}
            >
              {t('Close {n} tabs', { n: targets().length })}
            </ContextMenuItem>
            {targets().some((s) => !s.archived) ? (
              <ContextMenuItem data-chat-action="archive-selected" onSelect={() => archiveAll(true)}>
                {t('Archive {n} chats', { n: targets().length })}
              </ContextMenuItem>
            ) : (
              <ContextMenuItem data-chat-action="unarchive-selected" onSelect={() => archiveAll(false)}>
                {t('Unarchive {n} chats', { n: targets().length })}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" data-chat-action="delete-selected" onSelect={() => deleteChats(targets())}>
              {t('Delete {n} chats…', { n: targets().length })}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => selectSession(session.id)}>{t('Open')}</ContextMenuItem>
            <ContextMenuItem data-chat-action="rename" onSelect={() => (renameAfterClose.current = true)}>
              {t('Rename…')}
            </ContextMenuItem>
            {card && !session.archived && (
              <ContextMenuItem data-chat-action={card.pinned ? 'unpin' : 'pin'} onSelect={() => setChatPinned(session.id, !card.pinned)}>
                {card.pinned ? t('Unpin') : t('Pin to the top')}
              </ContextMenuItem>
            )}
            <ContextMenuItem
              data-chat-action={session.archived ? 'unarchive' : 'archive'}
              onSelect={() => void setChatArchived(session.id, !session.archived)}
            >
              {session.archived ? t('Unarchive') : t('Archive')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => deleteChats([session])}>
              {t('Delete chat…')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
