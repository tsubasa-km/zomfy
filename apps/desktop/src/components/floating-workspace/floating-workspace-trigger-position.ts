// Orca's floating-terminal-trigger-position.ts: the floating toggle's default spot, drag clamp and the
// edge-anchored position persisted between launches.

const TRIGGER_SIZE = 36
const DEFAULT_RIGHT_GAP = 24
const DEFAULT_BOTTOM_GAP = 72
const DRAG_MARGIN = 8
const TITLEBAR_SAFE_TOP = 36

const POSITION_STORAGE_KEY = 'acp-harness.floating-workspace.trigger-position.v1'

export interface TriggerPosition {
  left: number
  top: number
}

interface AnchoredTriggerPosition {
  anchorX: 'left' | 'right'
  anchorY: 'top' | 'bottom'
  offsetX: number
  offsetY: number
}

export type CommittedTriggerPosition = TriggerPosition | AnchoredTriggerPosition
export type TriggerPositionSource = 'default' | 'user'

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function defaultCommittedTriggerPosition(): AnchoredTriggerPosition {
  return { anchorX: 'right', anchorY: 'bottom', offsetX: DEFAULT_RIGHT_GAP, offsetY: DEFAULT_BOTTOM_GAP }
}

export function clampTriggerPosition(position: TriggerPosition): TriggerPosition {
  const vp = viewport()
  const maxLeft = Math.max(DRAG_MARGIN, vp.width - TRIGGER_SIZE - DRAG_MARGIN)
  const maxTop = Math.max(TITLEBAR_SAFE_TOP, vp.height - TRIGGER_SIZE - DRAG_MARGIN)
  return {
    left: Math.min(Math.max(DRAG_MARGIN, position.left), maxLeft),
    top: Math.min(Math.max(TITLEBAR_SAFE_TOP, position.top), maxTop)
  }
}

function hasUsableViewport(): boolean {
  const vp = viewport()
  return vp.width >= TRIGGER_SIZE + DRAG_MARGIN * 2 && vp.height >= TRIGGER_SIZE + TITLEBAR_SAFE_TOP + DRAG_MARGIN
}

function resolveCommitted(position: CommittedTriggerPosition): TriggerPosition {
  if (!('anchorX' in position)) return position
  const vp = viewport()
  return {
    left: position.anchorX === 'left' ? position.offsetX : vp.width - TRIGGER_SIZE - position.offsetX,
    top: position.anchorY === 'top' ? position.offsetY : vp.height - TRIGGER_SIZE - position.offsetY
  }
}

export function anchorTriggerPosition(position: TriggerPosition): AnchoredTriggerPosition | null {
  if (!hasUsableViewport()) return null
  const vp = viewport()
  const anchorX = position.left + TRIGGER_SIZE / 2 <= vp.width / 2 ? 'left' : 'right'
  const anchorY = position.top + TRIGGER_SIZE / 2 <= vp.height / 2 ? 'top' : 'bottom'
  return {
    anchorX,
    anchorY,
    offsetX: anchorX === 'left' ? position.left : vp.width - position.left - TRIGGER_SIZE,
    offsetY: anchorY === 'top' ? position.top : vp.height - position.top - TRIGGER_SIZE
  }
}

export function shouldReconcileTriggerPosition(source: TriggerPositionSource): boolean {
  return source === 'default' || hasUsableViewport()
}

export function resolveTriggerPosition(position: CommittedTriggerPosition, source: TriggerPositionSource): TriggerPosition {
  return clampTriggerPosition(resolveCommitted(source === 'default' ? defaultCommittedTriggerPosition() : position))
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readPersisted(): CommittedTriggerPosition | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) ?? 'null')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const r: Record<string, unknown> = { ...parsed }
    if ((r.anchorX === 'left' || r.anchorX === 'right') && (r.anchorY === 'top' || r.anchorY === 'bottom') && finite(r.offsetX) && finite(r.offsetY)) {
      return { anchorX: r.anchorX, anchorY: r.anchorY, offsetX: r.offsetX, offsetY: r.offsetY }
    }
    return finite(r.left) && finite(r.top) ? { left: r.left, top: r.top } : null
  } catch {
    return null
  }
}

export function persistTriggerPosition(position: CommittedTriggerPosition): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position))
  } catch {
    // Storage can be unavailable; the toggle then keeps its spot for this session only.
  }
}

export function readInitialTriggerPosition(): { committed: CommittedTriggerPosition; position: TriggerPosition; source: TriggerPositionSource } {
  const persisted = readPersisted()
  if (!persisted) {
    const committed = defaultCommittedTriggerPosition()
    return { committed, position: resolveTriggerPosition(committed, 'default'), source: 'default' }
  }
  return {
    committed: persisted,
    position: shouldReconcileTriggerPosition('user') ? resolveTriggerPosition(persisted, 'user') : resolveCommitted(persisted),
    source: 'user'
  }
}
