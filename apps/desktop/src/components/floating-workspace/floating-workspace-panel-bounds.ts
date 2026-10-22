// Orca's floating-terminal-panel-bounds.ts: the panel's default, clamped and maximized rects, and the
// edge-anchored record persisted between launches so a window resize keeps it near its corner.

export const DEFAULT_PANEL_WIDTH = 920
export const DEFAULT_PANEL_HEIGHT = 560
export const MIN_PANEL_WIDTH = 420
export const MIN_PANEL_HEIGHT = 280
const MAXIMIZED_MARGIN = 12
const MAXIMIZED_BOTTOM_GAP = 36
/** The panel may touch the area under the window's title bar, never cover it. */
export const TITLEBAR_SAFE_TOP = 36
const DEFAULT_RIGHT_GAP = 24
const DEFAULT_BOTTOM_GAP = 84
const PANEL_EDGE_MARGIN = 8

const BOUNDS_STORAGE_KEY = 'acp-harness.floating-workspace.panel-bounds.v1'

export interface PanelBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface AnchoredPanelBounds {
  anchorX: 'left' | 'right'
  anchorY: 'top' | 'bottom'
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export type CommittedPanelBounds = PanelBounds | AnchoredPanelBounds
export type PanelBoundsSource = 'default' | 'user'

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), max)
}

function isAnchored(bounds: CommittedPanelBounds): bounds is AnchoredPanelBounds {
  return 'anchorX' in bounds
}

export function defaultCommittedBounds(): AnchoredPanelBounds {
  return {
    anchorX: 'right',
    anchorY: 'bottom',
    offsetX: DEFAULT_RIGHT_GAP,
    offsetY: DEFAULT_BOTTOM_GAP,
    width: DEFAULT_PANEL_WIDTH,
    height: DEFAULT_PANEL_HEIGHT
  }
}

export function defaultPanelBounds(): PanelBounds {
  const vp = viewport()
  const width = Math.min(DEFAULT_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, vp.width - 48))
  const height = Math.min(DEFAULT_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, vp.height - 96))
  return {
    left: Math.max(16, vp.width - width - DEFAULT_RIGHT_GAP),
    top: Math.max(TITLEBAR_SAFE_TOP, vp.height - height - DEFAULT_BOTTOM_GAP),
    width,
    height
  }
}

export function clampPanelBounds(bounds: PanelBounds): PanelBounds {
  const vp = viewport()
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(bounds.width, Math.max(MIN_PANEL_WIDTH, vp.width - PANEL_EDGE_MARGIN * 2)))
  const height = Math.max(
    MIN_PANEL_HEIGHT,
    Math.min(bounds.height, Math.max(MIN_PANEL_HEIGHT, vp.height - TITLEBAR_SAFE_TOP - PANEL_EDGE_MARGIN))
  )
  const maxLeft = Math.max(PANEL_EDGE_MARGIN, vp.width - width - PANEL_EDGE_MARGIN)
  const maxTop = Math.max(TITLEBAR_SAFE_TOP, vp.height - height - PANEL_EDGE_MARGIN)
  return {
    left: clamp(bounds.left, PANEL_EDGE_MARGIN, maxLeft),
    top: clamp(bounds.top, TITLEBAR_SAFE_TOP, maxTop),
    width,
    height
  }
}

export function maximizedPanelBounds(): PanelBounds {
  const vp = viewport()
  return {
    left: MAXIMIZED_MARGIN,
    top: TITLEBAR_SAFE_TOP,
    width: Math.max(MIN_PANEL_WIDTH, vp.width - MAXIMIZED_MARGIN * 2),
    height: Math.max(MIN_PANEL_HEIGHT, vp.height - TITLEBAR_SAFE_TOP - MAXIMIZED_BOTTOM_GAP)
  }
}

function hasUsableViewport(): boolean {
  const vp = viewport()
  return vp.width > PANEL_EDGE_MARGIN * 2 && vp.height > TITLEBAR_SAFE_TOP + PANEL_EDGE_MARGIN
}

function canAnchor(): boolean {
  const vp = viewport()
  return vp.width >= MIN_PANEL_WIDTH + PANEL_EDGE_MARGIN * 2 && vp.height >= MIN_PANEL_HEIGHT + TITLEBAR_SAFE_TOP + PANEL_EDGE_MARGIN
}

function resolveCommitted(bounds: CommittedPanelBounds): PanelBounds {
  if (!isAnchored(bounds)) return bounds
  const vp = viewport()
  return {
    left: bounds.anchorX === 'left' ? bounds.offsetX : vp.width - bounds.width - bounds.offsetX,
    top: bounds.anchorY === 'top' ? bounds.offsetY : vp.height - bounds.height - bounds.offsetY,
    width: bounds.width,
    height: bounds.height
  }
}

/** Anchors to the nearer horizontal and vertical edges, so resizing the window keeps the gap. */
export function anchorPanelBounds(bounds: PanelBounds): AnchoredPanelBounds | null {
  if (!canAnchor()) return null
  const vp = viewport()
  const anchorX = bounds.left + bounds.width / 2 <= vp.width / 2 ? 'left' : 'right'
  const anchorY = bounds.top + bounds.height / 2 <= vp.height / 2 ? 'top' : 'bottom'
  return {
    anchorX,
    anchorY,
    offsetX: anchorX === 'left' ? bounds.left : vp.width - bounds.left - bounds.width,
    offsetY: anchorY === 'top' ? bounds.top : vp.height - bounds.top - bounds.height,
    width: bounds.width,
    height: bounds.height
  }
}

/** A startup-sized viewport must not clamp a saved position before the window has its real size. */
export function shouldReconcileBounds(source: PanelBoundsSource): boolean {
  return source === 'default' || hasUsableViewport()
}

export function resolvePanelBounds(bounds: CommittedPanelBounds, source: PanelBoundsSource): PanelBounds {
  return source === 'default' ? defaultPanelBounds() : clampPanelBounds(resolveCommitted(bounds))
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function readPersistedPanelBounds(): CommittedPanelBounds | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BOUNDS_STORAGE_KEY) ?? 'null')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const r: Record<string, unknown> = { ...parsed }
    if (!finite(r.width) || !finite(r.height)) return null
    if ((r.anchorX === 'left' || r.anchorX === 'right') && (r.anchorY === 'top' || r.anchorY === 'bottom') && finite(r.offsetX) && finite(r.offsetY)) {
      return { anchorX: r.anchorX, anchorY: r.anchorY, offsetX: r.offsetX, offsetY: r.offsetY, width: r.width, height: r.height }
    }
    return finite(r.left) && finite(r.top) ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
  } catch {
    return null
  }
}

export function persistPanelBounds(bounds: CommittedPanelBounds): void {
  try {
    localStorage.setItem(BOUNDS_STORAGE_KEY, JSON.stringify(bounds))
  } catch {
    // Storage can be unavailable; the panel then keeps its rect for this session only.
  }
}

export interface InitialPanelBounds {
  committed: CommittedPanelBounds
  rendered: PanelBounds
  source: PanelBoundsSource
}

export function readInitialPanelBounds(maximized: boolean): InitialPanelBounds {
  const persisted = readPersistedPanelBounds()
  const committed = persisted ?? defaultCommittedBounds()
  const source: PanelBoundsSource = persisted ? 'user' : 'default'
  // Keep the committed rect as the restore target while the first paint is maximized.
  if (maximized && hasUsableViewport()) return { committed, rendered: maximizedPanelBounds(), source }
  if (!persisted) return { committed, rendered: defaultPanelBounds(), source }
  return {
    committed,
    rendered: shouldReconcileBounds('user') ? resolvePanelBounds(persisted, 'user') : resolveCommitted(persisted),
    source
  }
}
