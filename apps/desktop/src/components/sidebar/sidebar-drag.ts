import { createElement, type ReactNode } from 'react'
import type { HostId } from '@/session-store'
import { DragChip } from '@/components/PointerDragLayer'
import { createPointerDragChannel, type DragPoint } from '@/lib/pointer-drag'
import { setDropTarget, type DropTarget } from '@/stores/sidebar-store'

// Pointer drag and drop for the sidebar and board (Orca's worktree-sidebar-drag /
// workspace-status-drag-data); the board shares the channel, so sidebar cards drop into lanes.

export interface DragItem {
  kind: 'workspace' | 'project'
  id: string
  hostId: HostId
  projectId: string | null
}

export const sidebarDrag = createPointerDragChannel<DragItem>()

export function beginSidebarDrag(event: React.PointerEvent<HTMLElement>, item: DragItem, label: string, icon?: ReactNode): void {
  sidebarDrag.begin(event, {
    payload: () => item,
    preview: createElement(DragChip, { label, icon }),
    onEnd: () => setDropTarget(null)
  })
}

/** Top or bottom half; with `inside`, the middle third nests (Orca's lineage drop). */
export function dropPosition(rect: DOMRect, point: DragPoint, inside = false): DropTarget['position'] {
  const y = (point.y - rect.top) / Math.max(1, rect.height)
  if (inside && y > 1 / 3 && y < 2 / 3) return 'inside'
  return y < 0.5 ? 'before' : 'after'
}

/**
 * What a drag over a target may do: reorder before/after it, also nest under it, land inside it
 * (groups, status headers, lanes), or stop here without a drop (a card over itself).
 */
export type DropVerdict = false | 'order' | 'order-or-nest' | 'inside' | 'block'

/** Registers a sidebar drop target that marks where the item would land and drops it there. */
export function useSidebarDropTarget(
  targetId: string,
  accept: ((item: DragItem) => DropVerdict) | null,
  onDrop: (item: DragItem, position: DropTarget['position']) => void
): (element: HTMLElement | null) => void {
  const position = (verdict: DropVerdict, element: HTMLElement, point: DragPoint) =>
    verdict === 'inside' ? 'inside' : dropPosition(element.getBoundingClientRect(), point, verdict === 'order-or-nest')
  return sidebarDrag.useDropTarget(
    accept && {
      accepts: (item) => accept(item) !== false,
      over: (item, { point, element }) => {
        const verdict = accept(item)
        setDropTarget(verdict && verdict !== 'block' ? { id: targetId, position: position(verdict, element, point) } : null)
      },
      leave: () => setDropTarget(null),
      drop: (item, { point, element }) => {
        const verdict = accept(item)
        if (verdict && verdict !== 'block') onDrop(item, position(verdict, element, point))
      }
    }
  )
}
