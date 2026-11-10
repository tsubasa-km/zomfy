import { Fragment, useRef, useState } from 'react'
import { AppWindow, X } from 'lucide-react'
import { allProjects, allWorkspaces, closeColumn, getState, selectWorkspace, setPaneSizes, useStore } from '@/session-store'
import { sidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { QuickStart } from '@/components/QuickStart'
import { PaneSidebar } from '@/components/tab-layout/PaneSidebar'
import { PaneMenu } from '@/components/PaneMenu'
import { DragChip } from '@/components/PointerDragLayer'
import { Button } from '@/components/ui/button'
import { canPopOutWorkspace, popOutWorkspace } from '@/lib/workspace-window'
import { isLeaf, type PaneNode } from '@/lib/pane-tree'
import { applyPaneDrop, paneDrag, paneDropZone, type PaneDropZone } from '@/components/pane-drop'
import type { DragPoint } from '@/lib/pointer-drag'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The main area: one workspace, or several from any project laid out as a tree of rows and columns
// (lib/pane-tree), each pane with its own tab layout. A workspace dragged from the sidebar, or a pane
// dragged by its header, lands on an edge of a pane to split beside it, or in its middle to take its
// place. A header dropped outside the window opens that workspace in a window of its own.

const EMPTY_HINT = t('No tabs yet. Start one here, or find more under + in the tab bar.')
const MIN_PANE_PX = 160

/** The workspace a sidebar drag opens: a chat's or workspace's own, or a project's main checkout. */
function draggedWorkspace(item: DragItem): string | null {
  const id =
    item.kind === 'workspace'
      ? item.id
      : (allWorkspaces().find((w) => w.hostId === item.hostId && w.projectId === item.id && w.isPrimary)?.id ?? null)
  return id && !getState().poppedOut.includes(id) ? id : null
}

export function WorkspaceMain() {
  const active = useStore((s) => s.activeWorkspaceId)
  const tree = useStore((s) => s.paneTree)
  const showPanes = active !== null && tree !== null && !isLeaf(tree)
  const [hint, setHint] = useState<PaneDropZone['hint'] | null>(null)

  // Both kinds of drag land the same way; only what is dragged differs.
  const target = <T,>(workspaceOf: (item: T) => string | null) => ({
    accepts: (item: T) => workspaceOf(item) !== null,
    over: (_item: T, { point, element }: { point: DragPoint; element: HTMLElement }) => setHint(paneDropZone(point, element).hint),
    leave: () => setHint(null),
    drop: (item: T, { point, element }: { point: DragPoint; element: HTMLElement }) => {
      setHint(null)
      const workspaceId = workspaceOf(item)
      if (workspaceId) applyPaneDrop(workspaceId, paneDropZone(point, element))
    }
  })
  const sidebarRef = sidebarDrag.useDropTarget(target(draggedWorkspace))
  const paneRef = paneDrag.useDropTarget(target((item) => item.workspaceId))

  return (
    <div
      ref={(element) => {
        sidebarRef(element)
        paneRef(element)
      }}
      className="relative flex min-w-0 flex-1"
      data-workspace-main
    >
      {showPanes ? (
        <PaneView node={tree} path={[]} active={active} />
      ) : active ? (
        <WorkspacePane key={active} workspaceId={active} focused={false} single />
      ) : (
        <QuickStart />
      )}
      {hint && (
        <div aria-hidden className="tab-drop-overlay" style={hint}>
          {hint.label && (
            <span className="tab-drop-overlay__label pointer-events-none absolute bottom-2 left-2 rounded-sm px-1.5 py-0.5 font-medium">
              {hint.label}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** A split lays its children out in a row or a column with dividers between; a leaf is one workspace's pane. */
function PaneView({ node, path, active }: { node: PaneNode; path: number[]; active: string }) {
  if (isLeaf(node)) {
    const id = node.leaf
    return (
      <div
        data-workspace-column={id}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        onPointerDownCapture={() => {
          if (getState().activeWorkspaceId !== id) selectWorkspace(id)
        }}
        onFocusCapture={() => {
          if (getState().activeWorkspaceId !== id) selectWorkspace(id)
        }}
      >
        <WorkspacePane workspaceId={id} focused={id === active} />
      </div>
    )
  }
  const row = node.split === 'row'
  return (
    <div data-pane-split={node.split} className={cn('flex min-h-0 min-w-0 flex-1', row ? 'flex-row' : 'flex-col')}>
      {node.children.map((child, index) => (
        <Fragment key={isLeaf(child) ? child.leaf : `split-${index}`}>
          {index > 0 && <SplitDivider path={path} index={index} direction={node.split} sizes={node.sizes} />}
          <div className="flex min-h-0 min-w-0" style={{ flex: `${node.sizes[index] ?? 1} 1 0%` }}>
            <PaneView node={child} path={[...path, index]} active={active} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** One workspace's pane: its name bar over its tabs, and its own sidebar on the right, full height, when open. */
function WorkspacePane({ workspaceId, focused, single = false }: { workspaceId: string; focused: boolean; single?: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PaneHeader workspaceId={workspaceId} focused={focused} single={single} />
        <WorkspaceTabs workspaceId={workspaceId} emptyHint={EMPTY_HINT} />
      </div>
      <PaneSidebar workspaceId={workspaceId} focused={focused} />
    </div>
  )
}

/** A pane's project (or quick chat) name, and its workspace and branch when they say more. */
export function usePaneTitle(workspaceId: string): { title: string; detail: string } {
  // Strings, not objects: the store hands out fresh workspace objects on every read.
  const title = useStore((s) => {
    const workspace = allWorkspaces(s).find((w) => w.id === workspaceId)
    if (!workspace) return ''
    const project = allProjects(s.hosts).find((p) => p.id === workspace.projectId)
    return project ? projectLabel(project) : workspace.scratch ? t('Quick chat') : workspace.name
  })
  const detail = useStore((s) => {
    const workspace = allWorkspaces(s).find((w) => w.id === workspaceId)
    if (!workspace || !workspace.projectId) return ''
    const name = workspace.displayName ?? workspace.name
    return workspace.branch && workspace.branch !== name ? `${name} · ${workspace.branch}` : name
  })
  return { title, detail: detail !== title ? detail : '' }
}

/** The workspace's name; drag it to move the pane, or out of the window to give it a window of its own. */
export function PaneHeader({ workspaceId, focused, single = false }: { workspaceId: string; focused: boolean; single?: boolean }) {
  const { title, detail } = usePaneTitle(workspaceId)
  return (
    <div
      data-column-header
      data-focused={focused || undefined}
      title={t('Drag to move this pane; drop it outside the window to open it in a window of its own')}
      className={cn(
        'flex h-7 shrink-0 cursor-grab items-center gap-1.5 border-t-2 border-b border-b-border pr-1 pl-2.5 text-xs select-none active:cursor-grabbing',
        focused ? 'border-t-highlight' : 'border-t-transparent'
      )}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest('button')) return
        paneDrag.begin(event, {
          payload: () => ({ workspaceId }),
          preview: <DragChip label={title} icon={<AppWindow className="size-3.5" />} />,
          onDropOutside: canPopOutWorkspace() ? (_item, screen) => void popOutWorkspace(workspaceId, screen) : undefined
        })
      }}
    >
      <span className={cn('shrink-0 font-medium', focused ? 'text-foreground' : 'text-muted-foreground')}>{title}</span>
      {detail && <span className="min-w-0 truncate text-muted-foreground">{detail}</span>}
      <PaneMenu workspaceId={workspaceId} />
      <div className="ml-auto flex shrink-0 items-center">
        {!single && (
          <Button size="icon-xs" variant="ghost" aria-label={t('Close column')} onClick={() => closeColumn(workspaceId)}>
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

/** Resizes the two children beside it; styles move during the drag and the store hears the end. */
function SplitDivider({ path, index, direction, sizes }: { path: number[]; index: number; direction: 'row' | 'column'; sizes: number[] }) {
  const [dragging, setDragging] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)
  const row = direction === 'row'

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = handleRef.current
    const before = handle?.previousElementSibling
    const after = handle?.nextElementSibling
    if (!handle || !(before instanceof HTMLElement) || !(after instanceof HTMLElement)) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    const grow = (sizes[index - 1] ?? 1) + (sizes[index] ?? 1)
    const measure = (el: HTMLElement) => (row ? el.getBoundingClientRect().width : el.getBoundingClientRect().height)
    const start = measure(before)
    const total = start + measure(after)
    let next: number | null = null
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId) return
      const delta = row ? move.clientX - event.clientX : move.clientY - event.clientY
      const px = Math.min(total - MIN_PANE_PX, Math.max(MIN_PANE_PX, start + delta))
      next = (grow * px) / total
      before.style.flex = `${next} 1 0%`
      after.style.flex = `${grow - next} 1 0%`
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', cleanup)
      handle.removeEventListener('pointercancel', cleanup)
      handle.removeEventListener('lostpointercapture', cleanup)
      setDragging(false)
      if (next === null) return
      const resized = [...sizes]
      resized[index - 1] = next
      resized[index] = grow - next
      setPaneSizes(path, resized)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', cleanup)
    handle.addEventListener('pointercancel', cleanup)
    handle.addEventListener('lostpointercapture', cleanup)
  }

  return (
    <div
      ref={handleRef}
      data-pane-divider={direction}
      className={`tab-group-split-resize-handle ${row ? 'is-vertical' : 'is-horizontal'}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
    />
  )
}
