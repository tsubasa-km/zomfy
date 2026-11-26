export const DRAWER_EDGES = ['top', 'bottom', 'left', 'right'] as const
export type DrawerEdge = typeof DRAWER_EDGES[number]

export interface DrawerDock {
  edge: DrawerEdge
  /** Handle center as a fraction of the edge, before clamping it to fit the pane. */
  position: number
}

const SNAP_DISTANCE = 28
const DETACH_DISTANCE = 40

export function isDrawerSide(edge: DrawerEdge): boolean {
  return edge === 'left' || edge === 'right'
}

export type DrawerPoint = Pick<PointerEvent, 'clientX' | 'clientY'>

export function drawerAlongEdge(edge: DrawerEdge, point: DrawerPoint): number {
  return isDrawerSide(edge) ? point.clientY : point.clientX
}

export function drawerResizeDepth(edge: DrawerEdge, depth: number, start: DrawerPoint, end: DrawerPoint, limit: number): number {
  const delta = isDrawerSide(edge) ? end.clientX - start.clientX : end.clientY - start.clientY
  const direction = edge === 'right' || edge === 'bottom' ? -1 : 1
  const minimum = isDrawerSide(edge) ? 280 : 192
  return Math.min(limit, Math.max(minimum, Math.round(depth + delta * direction)))
}

export function drawerDragTarget(
  bounds: Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>,
  source: DrawerEdge,
  start: DrawerPoint,
  point: DrawerPoint,
  grabOffset: number,
  detached: boolean
): { dock: DrawerDock | null; detached: boolean } {
  const { clientX: x, clientY: y } = point
  const perpendicular = isDrawerSide(source) ? x - start.clientX : y - start.clientY
  detached ||= Math.abs(perpendicular) >= DETACH_DISTANCE

  if (x < bounds.left - SNAP_DISTANCE || x > bounds.right + SNAP_DISTANCE ||
      y < bounds.top - SNAP_DISTANCE || y > bounds.bottom + SNAP_DISTANCE) return { dock: null, detached }

  let edge = source
  if (detached) {
    const distances: Record<DrawerEdge, number> = {
      top: Math.abs(y - bounds.top),
      bottom: Math.abs(y - bounds.bottom),
      left: Math.abs(x - bounds.left),
      right: Math.abs(x - bounds.right)
    }
    for (const candidate of DRAWER_EDGES) {
      if (distances[candidate] < distances[edge]) edge = candidate
    }
    if (distances[edge] > SNAP_DISTANCE) return { dock: null, detached }
  }

  const side = isDrawerSide(edge)
  const length = side ? bounds.height : bounds.width
  const along = drawerAlongEdge(edge, point) - (side ? bounds.top : bounds.left)
  const offset = edge === source ? grabOffset : 0
  const position = length > 0 ? Math.max(0, Math.min(1, (along - offset) / length)) : 0.5
  return { dock: { edge, position }, detached }
}
