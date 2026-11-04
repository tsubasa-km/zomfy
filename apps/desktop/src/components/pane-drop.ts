import { getState, placePane, selectWorkspace, swapPanePlaces } from '@/session-store'
import { createPointerDragChannel, type DragPoint } from '@/lib/pointer-drag'
import type { PaneSide } from '@/lib/pane-tree'
import { t } from '@/i18n/i18n'

// Where a workspace lands in the main area: on an edge of a pane it splits beside it, in its middle
// it takes that pane's place. Shared by sidebar drags, pane headers dragged within the window, and a
// pop-out window dropped back onto this one.

/** A pane dragged by its header. */
export interface PaneDragItem {
  workspaceId: string
}

export const paneDrag = createPointerDragChannel<PaneDragItem>()

export interface PaneDropZone {
  /** The pane under the point; null when the main area shows nothing yet. */
  target: string | null
  side: PaneSide | 'center'
  /** Where to draw the hint, in the main area's own coordinates. */
  hint: { left: number; top: number; width: number; height: number; label: string | null }
}

/** An edge zone is this far into the pane, as a share of its size. */
const EDGE = 0.25

export function paneDropZone(point: DragPoint, main: HTMLElement): PaneDropZone {
  const bounds = main.getBoundingClientRect()
  const panes = [...main.querySelectorAll<HTMLElement>('[data-workspace-column]')]
  const shown = panes.length > 0 ? panes : [main]
  // The pane under the pointer, or the nearest one when it is over a divider.
  const distance = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return Math.hypot(Math.max(r.left - point.x, 0, point.x - r.right), Math.max(r.top - point.y, 0, point.y - r.bottom))
  }
  const pane = shown.reduce((best, el) => (distance(el) < distance(best) ? el : best), shown[0]!)
  const target = pane.dataset.workspaceColumn ?? getState().activeWorkspaceId
  const r = pane.getBoundingClientRect()
  const left = r.left - bounds.left
  const top = r.top - bounds.top
  const fx = (point.x - r.left) / Math.max(1, r.width)
  const fy = (point.y - r.top) / Math.max(1, r.height)
  const edges: [PaneSide, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy]
  ]
  const [nearest, depth] = edges.reduce((a, b) => (b[1] < a[1] ? b : a))
  const side = target && depth < EDGE ? nearest : 'center'
  const label = t('Open beside')
  const hint =
    side === 'center'
      ? { left, top, width: r.width, height: r.height, label: null }
      : side === 'left'
        ? { left, top, width: r.width / 2, height: r.height, label }
        : side === 'right'
          ? { left: left + r.width / 2, top, width: r.width / 2, height: r.height, label }
          : side === 'top'
            ? { left, top, width: r.width, height: r.height / 2, label }
            : { left, top: top + r.height / 2, width: r.width, height: r.height / 2, label }
  return { target, side, hint }
}

/** Shows `workspaceId` where `zone` says: beside the pane, or in its place (trading places when it already has one). */
export function applyPaneDrop(workspaceId: string, zone: PaneDropZone): void {
  const { target, side } = zone
  if (!target || target === workspaceId) return selectWorkspace(workspaceId)
  if (side !== 'center') return placePane(workspaceId, target, side)
  if (getState().columns.includes(workspaceId)) return swapPanePlaces(workspaceId, target)
  // Taking over: the target is focused first, so the newcomer replaces that pane.
  selectWorkspace(target)
  selectWorkspace(workspaceId)
}

/** A workspace handed back from its own window, dropped at a point of this window's main area. */
export function dropPaneAt(workspaceId: string, point: DragPoint): boolean {
  const main = document.querySelector<HTMLElement>('[data-workspace-main]')
  if (!main) return false
  const r = main.getBoundingClientRect()
  if (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom) return false
  applyPaneDrop(workspaceId, paneDropZone(point, main))
  return true
}
