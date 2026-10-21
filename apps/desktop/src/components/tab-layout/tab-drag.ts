import { useSyncExternalStore } from 'react'

// dataTransfer is unreadable during dragover, so the dragged tab is kept here.
export interface DraggedTab {
  workspaceId: string
  tabId: string
  groupId: string
}

export const TAB_DRAG_MIME = 'application/x-acp-harness-tab'

let dragged: DraggedTab | null = null
const listeners = new Set<() => void>()

function publish(next: DraggedTab | null): void {
  dragged = next
  for (const listener of listeners) listener()
}

export function startTabDrag(event: React.DragEvent, tab: DraggedTab): void {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(TAB_DRAG_MIME, tab.tabId)
  // Deferred: changing the DOM inside dragstart (body overlays) cancels the drag in Chromium.
  setTimeout(() => publish(tab), 0)
  // A tab that moves mid-drag unmounts its source element, which then never sees dragend.
  const finish = () => setTimeout(endTabDrag, 0)
  window.addEventListener('dragend', finish, { once: true, capture: true })
  window.addEventListener('drop', finish, { once: true, capture: true })
}

export function endTabDrag(): void {
  if (dragged) publish(null)
}

export function draggedTab(): DraggedTab | null {
  return dragged
}

export function useDraggedTab(): DraggedTab | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => dragged
  )
}

export type DropZone = 'left' | 'right' | 'up' | 'down' | 'center'

/** Orca's resolveDropZone (tab-group/tab-drop-zone.ts): a centre merge zone, sides biased left/right. */
export function resolveDropZone(rect: DOMRect, point: { x: number; y: number }): DropZone {
  const x = point.x - rect.left
  const y = point.y - rect.top
  const edgeX = rect.width * 0.1
  const edgeY = rect.height * 0.1
  if (x > edgeX && x < rect.width - edgeX && y > edgeY && y < rect.height - edgeY) return 'center'
  const third = rect.width / 3
  if (x < third) return 'left'
  if (x > third * 2) return 'right'
  return y < rect.height / 2 ? 'up' : 'down'
}
