import { useSyncExternalStore } from 'react'
import { createPointerDragChannel, type DragPoint } from '@/lib/pointer-drag'
import { CHAT_COMPOSER_DROP_SELECTOR, chatComposerDropTarget } from '@/lib/chat-composer-drop'
import { layoutFor, type LayoutNode, type SplitSide } from '@/stores/tab-layout-store'
import type { WorkspaceTab } from './workspace-tab-model'

// Tab drags (Orca's useTabDragSplit, tab-insertion.ts, tab-drop-zone.ts,
// tab-group-panel-split-target.ts), on pointer events.

export interface DraggedTab {
  workspaceId: string
  tabId: string
  groupId: string
  kind: WorkspaceTab['kind']
}

/** Tab activation waits for the click, so ordinary jitter must not start a drag (Orca). */
export const TAB_DRAG_ACTIVATION_DISTANCE_PX = 12

// A composer inside a pane is the innermost target there, so it wins over the pane's split zones.
export const tabDrag = createPointerDragChannel<DraggedTab>([
  {
    selector: CHAT_COMPOSER_DROP_SELECTOR,
    target: chatComposerDropTarget<DraggedTab>('harness:tab-drop', ({ workspaceId, tabId, kind }) => [{ workspaceId, tabId, kind }])
  }
])

export type DropZone = SplitSide | 'center'

export interface InsertionMark {
  tabId: string
  side: 'before' | 'after'
}

export type TabDropTarget =
  | { kind: 'insert'; groupId: string; index: number; mark: InsertionMark | null }
  | { kind: 'split'; groupId: string; side: SplitSide }
  | { kind: 'move'; groupId: string }
  /** Over the dragged tab itself, or a pane where the drop changes nothing. */
  | { kind: 'none' }

let insertion: InsertionMark | null = null
const insertionListeners = new Set<() => void>()

export function setInsertionMark(next: InsertionMark | null): void {
  if (insertion?.tabId === next?.tabId && insertion?.side === next?.side) return
  insertion = next
  for (const listener of insertionListeners) listener()
}

export function useInsertionMark(tabId: string): InsertionMark['side'] | null {
  return useSyncExternalStore(
    (listener) => {
      insertionListeners.add(listener)
      return () => insertionListeners.delete(listener)
    },
    () => (insertion?.tabId === tabId ? insertion.side : null)
  )
}

type Rect = { left: number; top: number; width: number; height: number }

/** Orca's resolvePaneColumnEdgeZone: side bands span the panel, vertical bands only the body. */
export function resolvePaneEdgeZone(panel: Rect, body: Rect, point: DragPoint): SplitSide | null {
  const x = point.x - panel.left
  if (x < panel.width * 0.2) return 'left'
  if (x > panel.width * 0.8) return 'right'
  if (body.height <= 0) return null
  const y = point.y - body.top
  if (y < body.height * 0.2) return 'up'
  if (y > body.height * 0.8) return 'down'
  return null
}

function directSiblingOnSide(node: Extract<LayoutNode, { type: 'split' }>, groupId: string, side: SplitSide): string | null {
  const { first, second, direction } = node
  if (first.type === 'leaf' && first.groupId === groupId && second.type === 'leaf') {
    if ((direction === 'horizontal' && side === 'right') || (direction === 'vertical' && side === 'down')) return second.groupId
  }
  if (second.type === 'leaf' && second.groupId === groupId && first.type === 'leaf') {
    if ((direction === 'horizontal' && side === 'left') || (direction === 'vertical' && side === 'up')) return first.groupId
  }
  return null
}

function siblingOnSide(node: LayoutNode, groupId: string, side: SplitSide): string | null {
  if (node.type === 'leaf') return null
  return directSiblingOnSide(node, groupId, side) ?? siblingOnSide(node.first, groupId, side) ?? siblingOnSide(node.second, groupId, side)
}

/** Orca's isPaneColumnSplitDropNoOp: the split would rebuild the layout it started from. */
export function isSplitDropNoOp(
  root: LayoutNode,
  sourceGroupId: string,
  sourceTabCount: number,
  targetGroupId: string,
  side: SplitSide
): boolean {
  if (sourceGroupId === targetGroupId) return sourceTabCount <= 1
  return sourceTabCount === 1 && siblingOnSide(root, targetGroupId, side) === sourceGroupId
}

function visibleTabs(strip: Element): HTMLElement[] {
  const list = strip.querySelector('[role="tablist"]')?.getBoundingClientRect()
  return [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')].filter((tab) => {
    const rect = tab.getBoundingClientRect()
    return !list || (rect.right > list.left && rect.left < list.right)
  })
}

/** Where a tab dropped at `point` over `panel` (a TabGroupPane root) would go. */
export function resolveTabDropTarget(drag: DraggedTab, groupId: string, panel: HTMLElement, point: DragPoint): TabDropTarget {
  const layout = layoutFor(drag.workspaceId)
  const order = layout.groups[groupId]?.tabOrder ?? []
  const strip = panel.querySelector('[data-tab-group-strip-id]')
  const body = panel.querySelector('[data-tab-group-body-id]')
  if (!strip || !body) return { kind: 'none' }

  // The strip is for reordering only; splits open from the body's edges (Orca).
  if (point.y < strip.getBoundingClientRect().bottom) {
    const tabs = visibleTabs(strip)
    if (tabs.length === 0) return { kind: 'insert', groupId, index: order.length, mark: null }
    // Orca's closest-centre collision: the tab nearest the pointer along the strip.
    const distance = (tab: HTMLElement) => {
      const rect = tab.getBoundingClientRect()
      return point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0
    }
    const hovered = tabs.reduce((best, tab) => (distance(tab) < distance(best) ? tab : best))
    const hoveredId = hovered.dataset.tabId ?? ''
    if (hoveredId === drag.tabId) return { kind: 'none' }
    const rect = hovered.getBoundingClientRect()
    const after = point.x >= rect.left + rect.width / 2
    const at = order.indexOf(hoveredId)
    const index = at === -1 ? order.length : at + (after ? 1 : 0)
    // Orca's resolveTabIndicatorEdges: "after this tab" is drawn as "before the next one".
    const next = after ? tabs[tabs.indexOf(hovered) + 1]?.dataset.tabId : undefined
    const mark: InsertionMark = next ? { tabId: next, side: 'before' } : { tabId: hoveredId, side: after ? 'after' : 'before' }
    return { kind: 'insert', groupId, index, mark }
  }

  const sourceCount = layout.groups[drag.groupId]?.tabOrder.length ?? 0
  const side = resolvePaneEdgeZone(panel.getBoundingClientRect(), body.getBoundingClientRect(), point)
  if (side && !isSplitDropNoOp(layout.root, drag.groupId, sourceCount, groupId, side)) return { kind: 'split', groupId, side }
  // A no-op edge falls back to the pane body, as Orca's pane-body droppable does.
  return drag.groupId === groupId ? { kind: 'none' } : { kind: 'move', groupId }
}
