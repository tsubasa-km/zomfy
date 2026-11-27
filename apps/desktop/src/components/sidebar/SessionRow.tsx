import { memo, useRef, useState } from 'react'
import { Archive, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { allProjects, allWorkspaces, getState, previewSession, selectSession, useStore, type Session } from '@/session-store'
import { AgentStateDot } from '@/components/AgentStateDot'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { sessionAgent } from '@/lib/chat-agents'
import { phaseOf, turnPhaseDot, turnPhaseLabel, type TurnPhase } from '@/lib/turn-phase'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { closeSession } from '@/daemon-connection'
import { renameChat, setChatArchived } from '@/chat-rename-archive'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { hideChats, removeTabsFromLayout, useTabLayout } from '@/stores/tab-layout-store'
import { chatSelection, gestureOf, keepTextUnselected } from '@/stores/list-selection'
import { beginSidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import { setChatPinned, toggleChatExpanded } from '@/stores/sidebar-store'
import { closePagesBesideSidebar } from '@/lib/app-pages'
import { sidebarActions } from '@/components/sidebar/ProjectActionsMenu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { ChatCardBody, ChatHoverDetails, type ChatCardInfo } from '@/components/sidebar/ChatCard'
import { useWaitingGlow } from '@/components/native-chat/composer-waiting-glow'
import '@/components/native-chat/composer-waiting-glow.css'
import { t } from '@/i18n/i18n'

const SCOPE = 'sidebar'

/** A glowing row sits on its project card: the glow's inner surface is the card's. */
const GLOW_SURFACE = { '--composer-glow-surface': 'var(--card)', '--chat-composer-border': 'var(--border)' } as React.CSSProperties

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

/** The project the chat works in; null for a quick (floating) chat, which has none. */
function chatProject(session: Session) {
  const workspace = allWorkspaces().find((w) => w.id === session.workspaceId)
  if (!workspace?.projectId) return null
  return allProjects().find((p) => p.id === workspace.projectId && p.hostId === workspace.hostId) ?? null
}

function deleteChats(sessions: Session[]): void {
  const question =
    sessions.length === 1
      ? t('Delete "{title}"? Their conversations are removed for good.', { title: sessions[0]!.title })
      : t('Delete {n} threads? Their conversations are removed for good.', { n: sessions.length })
  if (!window.confirm(question)) return
  chatSelection.reset()
  for (const s of sessions) void closeSession(s.id)
}

// Orca's worktree-card-compact-agent-row: one agent tab under its workspace card.
/**
 * Memoised: lists rebuild `card`, `drag` and `fold` on every render, so those compare by their
 * fields; a chat streaming into one row then redraws that row alone.
 */
export const SessionRow = memo(function SessionRow({
  session,
  showWorkspace,
  place,
  drag,
  showActive,
  fold,
  phase,
  child,
  muted,
  card,
  glow
}: {
  session: Session
  showWorkspace?: boolean
  /** Where the chat works when that is not the project's own checkout (its worktree's branch). */
  place?: string
  /** Dragging the row drags its workspace (onto the main area, to open it beside others). */
  drag?: DragItem
  /** Mark the chat that is open in the focused workspace (the project chat list has no card to mark). */
  showActive?: boolean
  /** A parent chat's fold: how many chats sit under it, and what of theirs lifts the row (Quiet: nothing). */
  fold?: { count: number; expanded: boolean; phase: TurnPhase }
  /** Whose turn the row is, with the chats under it; worked out from the chat alone when absent. */
  phase?: TurnPhase
  /** Drawn indented, under its parent chat. */
  child?: boolean
  /** Drawn quieter: a chat a search found under another, not one it found at the top. */
  muted?: boolean
  /** Draws the chat list's two-line row, with the rest of what is known on a hover card. */
  card?: ChatCardInfo
  /** The thread needs the person (rowGlows): the row's border glows (docs/specs/threads-under-projects.md). */
  glow?: boolean
}) {
  const glowing = useWaitingGlow(Boolean(glow))
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
  // Looked up only while the menu is open, so a row does not watch the project list.
  const project = menuOpen ? chatProject(session) : null
  const commitRename = () => {
    if (renaming === null) return
    setRenaming(null)
    void renameChat(session.id, renaming)
  }
  // The chat list's row: whose turn it is, with the chats under it, which decides its look.
  const shown = phase ?? phaseOf(session)
  const compact = Boolean(card) && shown === 'quiet'
  const working = Boolean(card) && (shown === 'working' || shown === 'background') && !child
  const foldDot = fold ? turnPhaseDot(fold.phase) : null
  const title =
    renaming !== null ? (
      <Input
        autoFocus
        data-session-rename-input
        aria-label={t('Rename thread {title}', { title: session.title })}
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
      <span className={cn('min-w-0 flex-1 truncate', card && !compact && 'text-foreground', card?.unread && 'font-semibold text-foreground')}>
        {showWorkspace ? `${workspaceName} · ` : ''}
        {session.title}
      </span>
    )
  // On the chat list's rows the count of chats under one is also what folds them, so the row's
  // start stays free for the project's badge.
  const cardFold = card && fold && (
    <button
      type="button"
      aria-label={fold.expanded ? t('Hide threads under this one') : t('Show threads under this one')}
      aria-expanded={fold.expanded}
      title={fold.count === 1 ? t('{n} thread under this one', { n: fold.count }) : t('{n} threads under this one', { n: fold.count })}
      data-chat-fold
      data-chat-children={fold.count}
      className="flex h-4 shrink-0 items-center gap-0.5 rounded-sm px-0.5 text-[10px] text-muted-foreground/80 tabular-nums hover:bg-worktree-sidebar-accent hover:text-foreground"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        toggleChatExpanded(session.id)
      }}
    >
      {fold.count}
      {!fold.expanded && foldDot && <AgentStateDot state={foldDot} size="sm" />}
      <ChevronRight className={cn('size-3 transition-transform', fold.expanded && 'rotate-90')} />
    </button>
  )
  const foldBadge = fold && !fold.expanded && (
    <span
      className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/80 tabular-nums"
      title={fold.count === 1 ? t('{n} thread under this one', { n: fold.count }) : t('{n} threads under this one', { n: fold.count })}
      data-chat-children={fold.count}
    >
      {fold.count}
      {foldDot && <AgentStateDot state={foldDot} size="sm" />}
    </span>
  )
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      {/* The card only opens for the chat list's rows, and never over a menu or a rename. */}
      <HoverCard openDelay={250} closeDelay={80} open={Boolean(card) && hovered && !menuOpen && renaming === null} onOpenChange={setHovered}>
      <ContextMenuTrigger asChild>
        <HoverCardTrigger asChild>
    <div
      role="button"
      tabIndex={0}
      data-session-id={session.id}
      data-session-status={session.status}
      data-session-phase={shown}
      data-tab-closed={tabClosed || undefined}
      data-session-selected={selected || undefined}
      data-session-open={open || undefined}
      data-session-archived={session.archived || undefined}
      data-session-child={child || undefined}
      data-session-muted={muted || undefined}
      data-waiting-glow={glowing}
      style={glowing ? GLOW_SURFACE : undefined}
      title={!card && session.archived ? t('Archived: click to open it') : undefined}
      className={cn(
        'group/chat relative flex min-w-0 cursor-pointer rounded-md pr-1 text-muted-foreground hover:bg-worktree-sidebar-accent/60 hover:text-foreground',
        card ? cn('gap-2 pr-2 text-[13px]', compact ? 'items-center py-1' : 'items-start py-1.5') : 'items-center gap-1.5 py-0.5 text-[12px]',
        card ? (child ? 'pl-7' : 'pl-2') : child ? 'pl-[34px]' : 'pl-[22px]',
        // A chat at work stands out as a card of its own, as T3 Code's does.
        working && 'my-0.5 border border-border bg-card shadow-xs hover:bg-card',
        glowing && 'my-0.5 border border-border text-foreground',
        !card && session.archived && renaming === null && 'opacity-60',
        muted && 'opacity-60 hover:opacity-100',
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
        closePagesBesideSidebar()
        // One click looks at the chat; a second one keeps its tab, as in an editor's file tree.
        if (card && e.detail < 2) previewSession(session.id)
        else selectSession(session.id)
      }}
    >
      {fold && !card && (
        <button
          type="button"
          aria-label={fold.expanded ? t('Hide threads under this one') : t('Show threads under this one')}
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
      {card ? (
        <>
          <ChatCardBody
            session={session}
            card={card}
            phase={shown}
            title={title}
            trailing={cardFold}
            busy={renaming !== null}
            compact={compact}
          />
        </>
      ) : (
        <>
          <TuiAgentIcon agent={sessionAgent(session)} size={11} />
          {title}
          {session.archived && renaming === null && (
            <Archive className="size-3 shrink-0 text-muted-foreground/70" aria-label={t('Archived')} data-session-archived-tag />
          )}
          {place && (
            <span className="max-w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground/80" title={place} data-session-place>
              {place}
            </span>
          )}
          {foldBadge}
          <AgentStateDot state={turnPhaseDot(shown, session.status) ?? 'idle'} size="sm" title={turnPhaseLabel(shown, session.status)} />
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
              {t('Open {n} threads', { n: targets().length })}
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
                {t('Archive {n} threads', { n: targets().length })}
              </ContextMenuItem>
            ) : (
              <ContextMenuItem data-chat-action="unarchive-selected" onSelect={() => archiveAll(false)}>
                {t('Unarchive {n} threads', { n: targets().length })}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" data-chat-action="delete-selected" onSelect={() => deleteChats(targets())}>
              {t('Delete {n} threads…', { n: targets().length })}
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
            {project && sidebarActions() && (
              <ContextMenuItem data-chat-action="project-settings" onSelect={() => sidebarActions()?.projectSettings(project)}>
                {t('Project Settings…')}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => deleteChats([session])}>
              {t('Delete thread…')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}, sameRowProps)

function sameRowProps<P extends object>(a: P, b: P): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof P)[])
  for (const key of keys) {
    const x = a[key]
    const y = b[key]
    if (x === y) continue
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null || Array.isArray(x) || Array.isArray(y)) return false
    const fields = new Set([...Object.keys(x), ...Object.keys(y)])
    for (const field of fields) if ((x as Record<string, unknown>)[field] !== (y as Record<string, unknown>)[field]) return false
  }
  return true
}
