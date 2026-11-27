export const DRAWER_EDGES = ['top', 'bottom', 'left', 'right'] as const
export type DrawerEdge = typeof DRAWER_EDGES[number]

export interface DrawerDock {
  edge: DrawerEdge
  /** Handle center as a fraction of the edge, before clamping it to fit the pane. */
  position: number
}

const SNAP_DISTANCE = 28

/** The least height (top, bottom) or width (left, right) of an open drawer, in pixels, unless the pane is smaller. */
const MIN_DEPTH = { across: 192, along: 280 }

export function drawerMinDepth(edge: DrawerEdge): number {
  return isDrawerSide(edge) ? MIN_DEPTH.along : MIN_DEPTH.across
}
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
  return Math.min(limit, Math.max(drawerMinDepth(edge), Math.round(depth + delta * direction)))
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
  // Only a pull into the pane detaches; past the edge or beyond its ends the handle keeps sliding along it.
  const inward = source === 'top' || source === 'left' ? 1 : -1
  const perpendicular = (isDrawerSide(source) ? x - start.clientX : y - start.clientY) * inward
  detached ||= perpendicular >= DETACH_DISTANCE

  let edge = source
  if (detached) {
    if (x < bounds.left - SNAP_DISTANCE || x > bounds.right + SNAP_DISTANCE ||
        y < bounds.top - SNAP_DISTANCE || y > bounds.bottom + SNAP_DISTANCE) return { dock: null, detached }
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
