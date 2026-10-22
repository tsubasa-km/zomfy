import { useState } from 'react'
import { AppWindow, GitBranch, MoreHorizontal, Pin } from 'lucide-react'
import type { Workspace } from '@acp-harness/protocol'
import { getState, selectWorkspace, workspaceStatus, useStore, type HostId, type Session } from '@/session-store'
import {
  selectSingle,
  selectWithGesture,
  useSidebarStore,
  clearSelection,
  setBoardOpen,
  type CardProperty
} from '@/stores/sidebar-store'
import StatusIndicator from '@/components/sidebar/StatusIndicator'
import { setTasks } from '@/stores/tasks-store'
import { WorkspaceStatusIcon } from '@/components/sidebar/WorkspaceStatusIcon'
import { WorkspaceMenuItems, updateWorkspace } from '@/components/sidebar/WorkspaceMenu'
import { AgentBadge, DiffStatsBadge, ReviewBadge, SyncBadge } from '@/components/sidebar/WorkspaceCardBadges'
import { SessionRow } from '@/components/sidebar/SessionRow'
import { beginSidebarDrag, useSidebarDropTarget, type DragItem } from '@/components/sidebar/sidebar-drag'
import { workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { WorktreeStatus } from '@/lib/worktree-status'
import { cn } from '@/lib/utils'

// Markup follows Orca's worktree-card-surface / worktree-card-header / worktree-card-meta-row, with the
// compact layout folding agent rows into a badge (worktree-card-compact-agents).

const CARD_STATUS: Record<ReturnType<typeof workspaceStatus>, WorktreeStatus> = {
  'needs-you': 'permission',
  working: 'working',
  error: 'failed',
  idle: 'done',
  none: 'inactive'
}

const isMac = navigator.userAgent.includes('Mac')

export interface WorkspaceDropHandlers {
  /** What a drag over this card may do: reorder among siblings, also nest under it, or nothing. */
  accept: (item: DragItem) => false | 'order' | 'order-or-nest'
  onDrop: (item: DragItem, position: 'before' | 'after' | 'inside') => void
}

export function WorkspaceCard({
  workspace,
  hostId,
  projectName,
  sessions,
  active,
  depth = 0,
  drop,
  onUpdate,
  onDelete,
  onNewChild,
  hostBadge
}: {
  workspace: Workspace
  hostId: HostId
  /** The host's short name when the card sits in a project merged across hosts. */
  hostBadge?: string
  projectName?: string
  sessions: Session[]
  active: boolean
  depth?: number
  drop?: WorkspaceDropHandlers
  onUpdate: () => void
  onDelete: () => void
  onNewChild?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const sessionUnread = useStore((s) => sessions.some((x) => s.unread[x.id]))
  const compact = useSidebarStore((s) => s.cardLayout === 'compact')
  const props = useSidebarStore((s) => s.cardProperties)
  const summary = useSidebarStore((s) => s.summaries[workspace.id])
  const selected = useSidebarStore((s) => s.selection.includes(workspace.id))
  const dropMark = useSidebarStore((s) => (s.dropTarget?.id === workspace.id ? s.dropTarget.position : null))
  const unread = !!workspace.unread || sessionUnread
  const title = workspaceLabel(workspace)
  const poppedOut = useStore((s) => s.poppedOut.includes(workspace.id))
  const show = (p: CardProperty) => props.includes(p)
  const dropRef = useSidebarDropTarget(workspace.id, drop?.accept ?? null, (item, position) => drop?.onDrop(item, position))

  const badges = (
    <>
      {show('changes') && <DiffStatsBadge summary={summary} />}
      {show('sync') && <SyncBadge summary={summary} />}
      {/* The branch's PR/MR rides with the branch property. */}
      {show('branch') && <ReviewBadge workspaceId={workspace.id} showNumber={!compact} />}
    </>
  )

  return (
    <div
      className={cn(
        'group/card relative ml-1 flex cursor-pointer flex-col rounded-lg border border-transparent pr-1.5 outline-none transition-[background-color,border-color,opacity,box-shadow] duration-200 select-none',
        compact ? 'py-1' : 'pt-1.25 pb-1.5',
        !active && 'worktree-sidebar-card-hover',
        dropMark === 'inside' && 'border-worktree-sidebar-ring'
      )}
      style={depth > 0 ? { marginLeft: 4 + depth * 14 } : undefined}
      data-worktree-card-surface="true"
      data-worktree-card-active={active ? 'primary' : undefined}
      data-worktree-card-selected={selected ? 'true' : undefined}
      data-workspace-id={workspace.id}
      data-depth={depth}
      ref={dropRef}
      onPointerDown={(e) => beginSidebarDrag(e, { kind: 'workspace', id: workspace.id, hostId, projectId: workspace.projectId }, title)}
      onClick={(e) => {
        const toggle = isMac ? e.metaKey : e.ctrlKey
        if (toggle || e.shiftKey) {
          selectWithGesture(workspace.id, { toggle, range: e.shiftKey }, getState().activeWorkspaceId, renderedOrder(e.currentTarget))
          return
        }
        selectSingle(workspace.id)
        selectWorkspace(workspace.id)
        setBoardOpen(false)
        setTasks({ open: false })
        if (workspace.unread) void updateWorkspace(workspace.id, { unread: false })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!selected) clearSelection()
        setMenuOpen(true)
      }}
      title={workspace.path}
    >
      {dropMark === 'before' && <DropLine edge="top" />}
      {dropMark === 'after' && <DropLine edge="bottom" />}
      <div className="flex min-w-0 items-center justify-between gap-2 pl-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <StatusIndicator status={CARD_STATUS[workspaceStatus(sessions)]} />
          <div className={cn('min-w-0 truncate text-[13px] leading-5', unread && 'font-semibold')}>{title}</div>
          {workspace.pinned && <Pin className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Pinned" />}
          {hostBadge && (
            <span className="shrink-0 rounded border border-worktree-sidebar-border px-1 text-[10px] leading-4 text-muted-foreground" data-workspace-host={hostId}>
              {hostBadge}
            </span>
          )}
          {poppedOut && <AppWindow className="size-3 shrink-0 text-muted-foreground" aria-label="Open in its own window" />}
          {unread && <span className="size-1.5 shrink-0 rounded-full bg-agent-question" aria-label="Unread" />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {compact && badges}
          {compact && show('agents') && <AgentBadge sessions={sessions} />}
          {workspace.status && <WorkspaceStatusIcon status={workspace.status} className="size-3" />}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Workspace actions for ${title}`}
                className={cn(
                  'flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground',
                  menuOpen ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56" onClick={(e) => e.stopPropagation()}>
              <WorkspaceMenuItems
                workspace={workspace}
                hostId={hostId}
                unread={unread}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onNewChild={onNewChild}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {!compact && ((show('branch') && (workspace.branch || projectName)) || summary) && (
        <div className="mt-0.5 flex min-w-0 items-center gap-1 pl-[22px] text-[11px] text-muted-foreground">
          {show('branch') && projectName && <span className="shrink-0 truncate font-medium">{projectName}</span>}
          {show('branch') && projectName && workspace.branch && <span className="shrink-0">·</span>}
          {show('branch') && workspace.branch && (
            <>
              <GitBranch className="size-3 shrink-0" />
              <span className="min-w-0 truncate font-mono">{workspace.branch}</span>
            </>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">{badges}</span>
        </div>
      )}
      {!compact && show('notes') && workspace.comment && (
        <div className="mt-0.5 line-clamp-2 pl-[22px] text-[11px] text-muted-foreground/90" data-workspace-comment>
          {workspace.comment}
        </div>
      )}
      {!compact && show('agents') && sessions.length > 0 && (
        <div className="mt-1 space-y-px">
          {/* The project's Lead heads its workspace's chats. */}
          {[...sessions.filter((s) => s.role === 'lead'), ...sessions.filter((s) => s.role !== 'lead')].map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Card ids in drawn order within the list (sidebar or board) holding `card`. */
export function renderedOrder(card: Element): string[] {
  const root = card.closest('[data-workspace-list]') ?? document
  return [...root.querySelectorAll<HTMLElement>('[data-worktree-card-surface][data-workspace-id]')].map(
    (el) => el.dataset.workspaceId!
  )
}

export function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute right-1 left-1 z-10 h-0.5 rounded-full bg-worktree-sidebar-ring',
        edge === 'top' ? '-top-px' : '-bottom-px'
      )}
    />
  )
}
