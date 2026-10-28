import { Fragment, useCallback, useRef, useState } from 'react'
import { AppWindow, X } from 'lucide-react'
import {
  allProjects,
  allWorkspaces,
  closeColumn,
  getState,
  openInColumn,
  selectWorkspace,
  setColumnWidths,
  useStore
} from '@/session-store'
import { sidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { QuickStart } from '@/components/QuickStart'
import { Button } from '@/components/ui/button'
import { canPopOutWorkspace, popOutWorkspace } from '@/lib/workspace-window'
import type { DragPoint } from '@/lib/pointer-drag'
import { cn } from '@/lib/utils'

// The main area: one workspace, or several from any project side by side, each with its own tab layout.
// Two sit as columns; from three on they fill a two-row grid in order. Dragging a workspace from the
// sidebar onto a pane's left or right quarter opens it beside that pane; onto its middle, it takes it over.

const EMPTY_HINT = 'No tabs yet. Use + in the tab bar to start Claude in this workspace.'
const MIN_COLUMN_PX = 280
const MIN_ROW_PX = 160

export function WorkspaceMain() {
  const active = useStore((s) => s.activeWorkspaceId)
  const columns = useStore((s) => s.columns)
  const showColumns = active !== null && columns.length > 1 && columns.includes(active)
  const [hint, setHint] = useState<{ left: number; top: number; width: number; height: number; label: string | null } | null>(null)

  const dropAt = useCallback((item: DragItem, point: DragPoint, container: HTMLElement) => {
    const bounds = container.getBoundingClientRect()
    const { activeWorkspaceId, columns: current } = getState()
    const shown = current.length > 1 && activeWorkspaceId && current.includes(activeWorkspaceId) ? current : []
    const ids = shown.length > 0 ? shown : activeWorkspaceId ? [activeWorkspaceId] : []
    const elements = shown.length > 0 ? [...container.querySelectorAll<HTMLElement>('[data-workspace-column]')] : [container]
    // The pane under the pointer, or the nearest one when it is over a divider.
    const distance = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return Math.hypot(Math.max(r.left - point.x, 0, point.x - r.right), Math.max(r.top - point.y, 0, point.y - r.bottom))
    }
    const index = elements.reduce((best, el, i) => (distance(el) < distance(elements[best]!) ? i : best), 0)
    const rect = (elements[index] ?? container).getBoundingClientRect()
    const fraction = (point.x - rect.left) / Math.max(1, rect.width)
    const side = ids.length === 0 ? 'replace' : fraction < 0.25 ? 'before' : fraction > 0.75 ? 'after' : 'replace'
    const left = rect.left - bounds.left
    const top = rect.top - bounds.top
    const at = side === 'after' ? index + 1 : index
    return {
      hint:
        side === 'replace'
          ? { left, top, width: rect.width, height: rect.height, label: null }
          : { left: side === 'before' ? left : left + rect.width / 2, top, width: rect.width / 2, height: rect.height, label: 'Open beside' },
      apply: () => {
        if (side === 'replace') {
          if (ids[index]) selectWorkspace(ids[index]!)
          selectWorkspace(item.id)
          return
        }
        // openInColumn takes the workspace out of its old place first, which shifts later indexes.
        const from = ids.indexOf(item.id)
        openInColumn(item.id, from !== -1 && from < at ? at - 1 : at)
      }
    }
  }, [])

  const dropRef = sidebarDrag.useDropTarget({
    accepts: (item) => item.kind === 'workspace' && !getState().poppedOut.includes(item.id),
    over: (item, { point, element }) => setHint(dropAt(item, point, element).hint),
    leave: () => setHint(null),
    drop: (item, { point, element }) => {
      setHint(null)
      dropAt(item, point, element).apply()
    }
  })

  return (
    <div ref={dropRef} className="relative flex min-w-0 flex-1" data-workspace-main>
      {showColumns ? (
        <Columns columns={columns} active={active} />
      ) : active ? (
        <WorkspaceTabs key={active} workspaceId={active} emptyHint={EMPTY_HINT} />
      ) : (
        <QuickStart />
      )}
      {hint && (
        <div aria-hidden className="tab-drop-overlay" style={{ top: hint.top, height: hint.height, left: hint.left, width: hint.width }}>
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

function Columns({ columns, active }: { columns: string[]; active: string }) {
  const widths = useStore((s) => s.columnWidths)
  // Two panes sit side by side; more fill two rows, the top one taking the extra pane.
  const split = columns.length > 2 ? Math.ceil(columns.length / 2) : columns.length
  const rows = [columns.slice(0, split), columns.slice(split)].filter((row) => row.length > 0)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {rows.map((row, r) => (
        <Fragment key={r}>
          {r > 0 && <RowDivider />}
          <div data-workspace-row={r} className="flex min-h-0 min-w-0 flex-col" style={{ flex: '1 1 0%' }}>
            <div className="flex min-h-0 min-w-0 flex-1">
              {row.map((id, index) => (
                <Fragment key={id}>
                  {index > 0 && <ColumnDivider leftId={row[index - 1]!} rightId={id} />}
                  <div
                    data-workspace-column={id}
                    className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                    style={{ flex: `${widths[id] ?? 1} 1 0%` }}
                    onPointerDownCapture={() => {
                      if (getState().activeWorkspaceId !== id) selectWorkspace(id)
                    }}
                    onFocusCapture={() => {
                      if (getState().activeWorkspaceId !== id) selectWorkspace(id)
                    }}
                  >
                    <ColumnHeader workspaceId={id} focused={id === active} />
                    <WorkspaceTabs workspaceId={id} emptyHint={EMPTY_HINT} />
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** Resizes the grid's two rows for as long as the window lives; the split is not stored. */
function RowDivider() {
  const [dragging, setDragging] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = handleRef.current
    const top = handle?.previousElementSibling
    const bottom = handle?.nextElementSibling
    if (!handle || !(top instanceof HTMLElement) || !(bottom instanceof HTMLElement)) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    const startTop = top.getBoundingClientRect().height
    const total = startTop + bottom.getBoundingClientRect().height
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId) return
      const px = Math.min(total - MIN_ROW_PX, Math.max(MIN_ROW_PX, startTop + move.clientY - event.clientY))
      top.style.flex = `${px} 1 0%`
      bottom.style.flex = `${total - px} 1 0%`
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', cleanup)
      handle.removeEventListener('pointercancel', cleanup)
      handle.removeEventListener('lostpointercapture', cleanup)
      setDragging(false)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', cleanup)
    handle.addEventListener('pointercancel', cleanup)
    handle.addEventListener('lostpointercapture', cleanup)
  }

  return (
    <div
      ref={handleRef}
      data-row-divider
      className={`tab-group-split-resize-handle is-horizontal${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
    />
  )
}

function ColumnHeader({ workspaceId, focused }: { workspaceId: string; focused: boolean }) {
  // Strings, not objects: the store hands out fresh workspace objects on every read.
  const title = useStore((s) => {
    const workspace = allWorkspaces(s).find((w) => w.id === workspaceId)
    if (!workspace) return ''
    const project = allProjects(s.hosts).find((p) => p.id === workspace.projectId)
    return project ? projectLabel(project) : workspace.scratch ? 'Quick chat' : workspace.name
  })
  const detail = useStore((s) => {
    const workspace = allWorkspaces(s).find((w) => w.id === workspaceId)
    if (!workspace || !workspace.projectId) return ''
    const name = workspace.displayName ?? workspace.name
    return workspace.branch && workspace.branch !== name ? `${name} · ${workspace.branch}` : name
  })
  return (
    <div
      data-column-header
      data-focused={focused || undefined}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 border-t-2 border-b border-b-border pr-1 pl-2.5 text-xs',
        focused ? 'border-t-primary' : 'border-t-transparent'
      )}
    >
      <span className={cn('shrink-0 font-medium', focused ? 'text-foreground' : 'text-muted-foreground')}>{title}</span>
      {detail && detail !== title && <span className="min-w-0 truncate text-muted-foreground">{detail}</span>}
      <div className="ml-auto flex shrink-0 items-center">
        {canPopOutWorkspace() && (
          <Button size="icon-xs" variant="ghost" aria-label="Open in new window" onClick={() => void popOutWorkspace(workspaceId)}>
            <AppWindow className="size-3.5" />
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" aria-label="Close column" onClick={() => closeColumn(workspaceId)}>
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

/** Resizes the two columns beside it; styles move during the drag and the store hears the end. */
function ColumnDivider({ leftId, rightId }: { leftId: string; rightId: string }) {
  const [dragging, setDragging] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = handleRef.current
    const left = handle?.previousElementSibling
    const right = handle?.nextElementSibling
    if (!handle || !(left instanceof HTMLElement) || !(right instanceof HTMLElement)) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    const widths = getState().columnWidths
    const grow = (widths[leftId] ?? 1) + (widths[rightId] ?? 1)
    const startLeft = left.getBoundingClientRect().width
    const total = startLeft + right.getBoundingClientRect().width
    let next: number | null = null
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId) return
      const px = Math.min(total - MIN_COLUMN_PX, Math.max(MIN_COLUMN_PX, startLeft + move.clientX - event.clientX))
      next = (grow * px) / total
      left.style.flex = `${next} 1 0%`
      right.style.flex = `${grow - next} 1 0%`
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', cleanup)
      handle.removeEventListener('pointercancel', cleanup)
      handle.removeEventListener('lostpointercapture', cleanup)
      setDragging(false)
      if (next !== null) setColumnWidths({ [leftId]: next, [rightId]: grow - next })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', cleanup)
    handle.addEventListener('pointercancel', cleanup)
    handle.addEventListener('lostpointercapture', cleanup)
  }

  return (
    <div
      ref={handleRef}
      data-column-divider
      className={`tab-group-split-resize-handle is-vertical${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
    />
  )
}
