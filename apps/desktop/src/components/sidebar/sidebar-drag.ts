import type React from 'react'
import type { HostId } from '@/session-store'
import { setDropTarget, type DropTarget } from '@/stores/sidebar-store'

// Native drag and drop for the sidebar and board (Orca's worktree-sidebar-drag / workspace-status-drag-data).
// dataTransfer cannot be read during dragover, so the dragged item is also kept here.

export interface DragItem {
  kind: 'workspace' | 'project'
  id: string
  hostId: HostId
  projectId: string | null
}

const DRAG_TYPE = 'application/x-acp-harness-item'
let current: DragItem | null = null

export function startDrag(e: React.DragEvent, item: DragItem): void {
  current = item
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item))
  e.stopPropagation()
}

export function currentDrag(): DragItem | null {
  return current
}

export function endDrag(): void {
  current = null
  setDropTarget(null)
}

/** Top or bottom half; with `inside`, the middle third nests (Orca's lineage drop). */
export function dropPosition(e: React.DragEvent, inside = false): DropTarget['position'] {
  const rect = e.currentTarget.getBoundingClientRect()
  const y = (e.clientY - rect.top) / Math.max(1, rect.height)
  if (inside && y > 1 / 3 && y < 2 / 3) return 'inside'
  return y < 0.5 ? 'before' : 'after'
}

/** Accepts the drag when `accept` says so and marks where it would land. */
export function handleDragOver(
  e: React.DragEvent,
  targetId: string,
  accept: (item: DragItem) => false | 'order' | 'order-or-nest'
): void {
  const item = current
  const verdict = item ? accept(item) : false
  if (!verdict) return
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  setDropTarget({ id: targetId, position: dropPosition(e, verdict === 'order-or-nest') })
}
