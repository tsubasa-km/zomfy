import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Pin, Search, X } from 'lucide-react'
import { HARNESS_METHODS, WORKSPACE_STATUSES, type Workspace } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, findWorkspace, getState, selectWorkspace, useStore, workspaceStatus, type HostedWorkspace } from '@/session-store'
import {
  clearSelection,
  selectSingle,
  selectWithGesture,
  setBoardOpen,
  useSidebarStore,
  type StatusFilterId
} from '@/stores/sidebar-store'
import StatusIndicator from '@/components/sidebar/StatusIndicator'
import { WorkspaceStatusIcon } from '@/components/sidebar/WorkspaceStatusIcon'
import { AgentBadge, DiffStatsBadge, SyncBadge } from '@/components/sidebar/WorkspaceCardBadges'
import { DropLine, renderedOrder } from '@/components/sidebar/WorkspaceCard'
import { updateWorkspace } from '@/components/sidebar/WorkspaceMenu'
import { beginSidebarDrag, useSidebarDropTarget } from '@/components/sidebar/sidebar-drag'
import { projectLabel, reorderIds, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WorktreeStatus } from '@/lib/worktree-status'
import { cn } from '@/lib/utils'
import { keepTextUnselected } from '@/stores/list-selection'
import { t } from '@/i18n/i18n'

// Orca's WorkspaceKanbanDrawer: one lane per workspace status, cards dragged between lanes set the
// status, and a search field narrows every lane. Shown in the main area instead of a drawer.

const LANES: { id: StatusFilterId; label: string; border: string; tint: string }[] = [
  { id: 'none', label: t('No status'), border: 'border-t-muted-foreground/45', tint: 'bg-background/55' },
  ...WORKSPACE_STATUSES.map((s) => ({
    id: s.id,
    label: t(s.label),
    ...{
      todo: { border: 'border-t-muted-foreground/45', tint: 'bg-background/55' },
      'in-progress': { border: 'border-t-[#d4a300]/70', tint: 'bg-[#d4a300]/[0.04]' },
      'in-review': { border: 'border-t-[#16a34a]/70', tint: 'bg-[#16a34a]/[0.04]' },
      completed: { border: 'border-t-[#c7a594]/70', tint: 'bg-[#c7a594]/[0.04]' }
    }[s.id]
  }))
]

const CARD_STATUS: Record<ReturnType<typeof workspaceStatus>, WorktreeStatus> = {
  'needs-you': 'permission',
  working: 'working',
  error: 'failed',
  idle: 'done',
  none: 'inactive'
}

const isMac = navigator.userAgent.includes('Mac')

function boardOrder<T extends Workspace>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.sortOrder ?? 1e6) - (b.sortOrder ?? 1e6) || a.createdAt - b.createdAt
  )
}

export function WorkspaceBoard() {
  const hosts = useStore((s) => s.hosts)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const workspaces = useMemo(() => allWorkspaces({ hosts }).filter((w) => w.projectId !== null), [hosts])
  const projectName = (w: HostedWorkspace) => {
    const p = hosts[w.hostId]?.harness?.projects.find((x) => x.id === w.projectId)
    return p ? projectLabel(p) : ''
  }
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (w: HostedWorkspace) => {
    if (tokens.length === 0) return true
    const text = [workspaceLabel(w), w.branch, w.comment, projectName(w)].filter(Boolean).join('\n').toLowerCase()
    return tokens.every((t) => text.includes(t))
  }
  const visibleCount = workspaces.filter(matches).length

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && document.activeElement !== inputRef.current) setBoardOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background" data-workspace-board>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="text-sm font-semibold">{t('Workspace board')}</div>
        <div className="relative flex max-w-xs min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            aria-label={t('Search workspaces')}
            placeholder={t('Search workspaces')}
            data-board-search
            className="h-7 border-worktree-sidebar-border bg-background pr-16 pl-7 text-xs"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
              e.preventDefault()
              if (query) setQuery('')
              else setBoardOpen(false)
            }}
          />
          {query && (
            <span className="absolute right-2 text-[10px] text-muted-foreground tabular-nums">
              {visibleCount} / {workspaces.length}
            </span>
          )}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          className="ml-auto"
          aria-label={t('Close board')}
          onClick={() => setBoardOpen(false)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 auto-cols-[minmax(220px,1fr)] grid-flow-col gap-2 overflow-x-auto p-3" data-workspace-list>
        {LANES.map((lane) => {
          const all = boardOrder(workspaces.filter((w) => (w.status ?? 'none') === lane.id))
          const items = all.filter(matches)
          return <Lane key={lane.id} lane={lane} items={items} total={all.length} all={all} projectName={projectName} />
        })}
      </div>
    </div>
  )
}

function Lane({
  lane,
  items,
  total,
  all,
  projectName
}: {
  lane: (typeof LANES)[number]
  items: HostedWorkspace[]
  total: number
  all: HostedWorkspace[]
  projectName: (w: HostedWorkspace) => string
}) {
  const laneDrop = useSidebarStore((s) => s.dropTarget?.id === `lane:${lane.id}`)
  const status = lane.id === 'none' ? undefined : lane.id

  /** Status follows the lane; position follows the card it was dropped by (Orca's lane reorder). */
  function drop(workspaceId: string, targetId: string | null, position: 'before' | 'after') {
    const dragged = findWorkspace(workspaceId)
    if (!dragged) return
    if ((dragged.status ?? 'none') !== lane.id) void updateWorkspace(workspaceId, { status: status ?? null })
    const ids = all.map((w) => w.id)
    const order = targetId ? reorderIds(ids, workspaceId, targetId, position) : [...ids.filter((id) => id !== workspaceId), workspaceId]
    const sameHost = order?.filter((id) => all.find((w) => w.id === id)?.hostId === dragged.hostId || id === workspaceId)
    if (sameHost && sameHost.length > 0) {
      void harnessRequest(HARNESS_METHODS.workspacesReorder, { workspaceIds: sameHost }, dragged.hostId)
    }
  }

  const laneDropRef = useSidebarDropTarget(
    `lane:${lane.id}`,
    (item) => item.kind === 'workspace' && 'inside',
    (item) => drop(item.id, null, 'after')
  )

  return (
    <section
      ref={laneDropRef}
      className={cn(
        'relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-t-2 border-worktree-sidebar-border transition-colors',
        lane.border,
        lane.tint,
        laneDrop && 'border-worktree-sidebar-ring bg-worktree-sidebar-accent/70'
      )}
      data-board-lane={lane.id}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 py-0 pr-2 pl-3">
        <WorkspaceStatusIcon status={status} />
        <div className="min-w-0 truncate text-[12px] font-semibold text-foreground">{lane.label}</div>
        <div className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] leading-none font-medium text-muted-foreground">
          {items.length === total ? total : `${items.length} / ${total}`}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-x-hidden overflow-y-auto px-1.5 py-2">
        {items.map((w) => (
          <BoardCard key={w.id} workspace={w} projectName={projectName(w)} onDrop={(id, position) => drop(id, w.id, position)} />
        ))}
      </div>
    </section>
  )
}

function BoardCard({
  workspace,
  projectName,
  onDrop
}: {
  workspace: HostedWorkspace
  projectName: string
  onDrop: (workspaceId: string, position: 'before' | 'after') => void
}) {
  const sessions = useStore((s) => s.sessions)
  const own = useMemo(() => sessions.filter((s) => s.workspaceId === workspace.id), [sessions, workspace.id])
  const summary = useSidebarStore((s) => s.summaries[workspace.id])
  const selected = useSidebarStore((s) => s.selection.includes(workspace.id))
  const active = useStore((s) => s.activeWorkspaceId === workspace.id)
  const mark = useSidebarStore((s) => (s.dropTarget?.id === `card:${workspace.id}` ? s.dropTarget.position : null))
  // A card over itself stops there: it neither reorders nor falls through to the lane.
  const dropRef = useSidebarDropTarget(
    `card:${workspace.id}`,
    (item) => item.kind === 'workspace' && (item.id === workspace.id ? 'block' : 'order'),
    (item, position) => onDrop(item.id, position === 'before' ? 'before' : 'after')
  )

  return (
    <div
      className={cn(
        'relative cursor-pointer rounded-lg border border-worktree-sidebar-border bg-worktree-sidebar px-2.5 py-2 select-none hover:border-worktree-sidebar-ring/60',
        active && 'border-worktree-sidebar-ring'
      )}
      data-worktree-card-surface="true"
      data-worktree-card-selected={selected ? 'true' : undefined}
      data-workspace-id={workspace.id}
      data-board-card={workspace.id}
      ref={dropRef}
      onPointerDown={(e) =>
        beginSidebarDrag(
          e,
          { kind: 'workspace', id: workspace.id, hostId: workspace.hostId, projectId: workspace.projectId },
          workspaceLabel(workspace)
        )
      }
      onMouseDown={keepTextUnselected}
      onClick={(e) => {
        const toggle = isMac ? e.metaKey : e.ctrlKey
        if (toggle || e.shiftKey) {
          selectWithGesture(workspace.id, { toggle, range: e.shiftKey }, getState().activeWorkspaceId, renderedOrder(e.currentTarget))
          return
        }
        clearSelection()
        selectSingle(workspace.id)
        selectWorkspace(workspace.id)
        setBoardOpen(false)
      }}
    >
      {mark === 'before' && <DropLine edge="top" />}
      {mark === 'after' && <DropLine edge="bottom" />}
      <div className="flex min-w-0 items-center gap-1.5">
        <StatusIndicator status={CARD_STATUS[workspaceStatus(own)]} />
        <div className="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium">{workspaceLabel(workspace)}</div>
        {workspace.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label={t('Pinned')} />}
        <AgentBadge sessions={own} />
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        <span className="shrink-0 truncate font-medium">{projectName}</span>
        {workspace.branch && (
          <>
            <span className="shrink-0">·</span>
            <GitBranch className="size-3 shrink-0" />
            <span className="min-w-0 truncate font-mono">{workspace.branch}</span>
          </>
        )}
      </div>
      {!!(summary?.changedFiles || summary?.ahead || summary?.behind) && (
        <div className="mt-1 flex items-center gap-2">
          <DiffStatsBadge summary={summary} />
          <SyncBadge summary={summary} />
        </div>
      )}
      {workspace.comment && <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/90">{workspace.comment}</div>}
    </div>
  )
}
