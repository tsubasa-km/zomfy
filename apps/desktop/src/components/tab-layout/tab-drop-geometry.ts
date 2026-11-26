// The pure geometry of a tab drop over a split pane, kept free of the DOM and the stores so it can
// be tested on its own. A split divides the whole pane, its right sidebar included, so the zones are
// measured on that same rectangle (docs/specs/pane-sidebars.md).

export type SplitSide = 'left' | 'right' | 'up' | 'down'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** A side band is this share of the pane's width or the body's height (Orca). */
export const EDGE_SHARE = 0.2

export function containsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.left && point.x < rect.left + rect.width && point.y >= rect.top && point.y < rect.top + rect.height
}

/**
 * Orca's resolvePaneColumnEdgeZone. `pane` is the whole pane, its right sidebar included; `body`
 * the tab body under its strip. Side bands span the pane, vertical bands only the body. Over the
 * pane's own sidebar the drop is its right edge, whatever the band.
 */
export function resolvePaneEdgeZone(pane: Rect, body: Rect, point: Point, sidebar: Rect | null = null): SplitSide | null {
  if (sidebar && containsPoint(sidebar, point)) return 'right'
  const x = point.x - pane.left
  if (x < pane.width * EDGE_SHARE) return 'left'
  if (x > pane.width * (1 - EDGE_SHARE)) return 'right'
  if (body.height <= 0) return null
  const y = point.y - body.top
  if (y < body.height * EDGE_SHARE) return 'up'
  if (y > body.height * (1 - EDGE_SHARE)) return 'down'
  return null
}

/** Where the drop hint is drawn, as a share of the whole pane: the place the new split will take. */
export function dropHintRect(zone: SplitSide | 'center'): { left: number; top: number; width: number; height: number } {
  switch (zone) {
    case 'up':
      return { left: 0, top: 0, width: 1, height: 0.5 }
    case 'down':
      return { left: 0, top: 0.5, width: 1, height: 0.5 }
    case 'left':
      return { left: 0, top: 0, width: 0.5, height: 1 }
    case 'right':
      return { left: 0.5, top: 0, width: 0.5, height: 1 }
    case 'center':
      return { left: 0, top: 0, width: 1, height: 1 }
  }
}
