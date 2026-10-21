import { useCallback, useEffect, useRef, useState } from 'react'
import { setSplitRatio, type LayoutNode } from '@/stores/tab-layout-store'

// Orca's TabGroupSplitNodeTree: recursive flex splits with a draggable seam between the halves.

const MIN_RATIO = 0.15
const MAX_RATIO = 0.85

function ResizeHandle({
  direction,
  onRatioChange
}: {
  direction: 'horizontal' | 'vertical'
  onRatioChange: (ratio: number) => void
}) {
  const isHorizontal = direction === 'horizontal'
  const [dragging, setDragging] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanupRef.current?.(), [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (cleanupRef.current) return
      const handle = event.currentTarget
      const container = handle.parentElement
      const firstPane = handle.previousElementSibling
      const secondPane = handle.nextElementSibling
      if (!container || !(firstPane instanceof HTMLElement) || !(secondPane instanceof HTMLElement)) return
      setDragging(true)
      handle.setPointerCapture(event.pointerId)
      const rect = container.getBoundingClientRect()
      let dragged: number | null = null

      // Style writes during the drag; the store hears only the final ratio (Orca STA-3328).
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== event.pointerId) return
        const raw = isHorizontal ? (move.clientX - rect.left) / rect.width : (move.clientY - rect.top) / rect.height
        dragged = Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw))
        firstPane.style.flex = `${dragged} 1 0%`
        secondPane.style.flex = `${1 - dragged} 1 0%`
      }
      const cleanup = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', cleanup)
        handle.removeEventListener('pointercancel', cleanup)
        handle.removeEventListener('lostpointercapture', cleanup)
        cleanupRef.current = null
        setDragging(false)
        if (dragged !== null) onRatioChange(dragged)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', cleanup)
      handle.addEventListener('pointercancel', cleanup)
      handle.addEventListener('lostpointercapture', cleanup)
      cleanupRef.current = cleanup
    },
    [isHorizontal, onRatioChange]
  )

  return (
    <div
      data-split-handle={direction}
      className={`tab-group-split-resize-handle ${isHorizontal ? 'is-vertical' : 'is-horizontal'}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
    />
  )
}

export function SplitLayout({
  workspaceId,
  node,
  path = '',
  renderLeaf
}: {
  workspaceId: string
  node: LayoutNode
  path?: string
  renderLeaf: (groupId: string) => React.ReactNode
}) {
  if (node.type === 'leaf') return <>{renderLeaf(node.groupId)}</>
  const ratio = node.ratio ?? 0.5
  const child = (side: 'first' | 'second') => (path ? `${path}.${side}` : side)
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      style={{ flexDirection: node.direction === 'horizontal' ? 'row' : 'column' }}
    >
      <div className="flex min-h-0 min-w-0 overflow-hidden" style={{ flex: `${ratio} 1 0%` }}>
        <SplitLayout workspaceId={workspaceId} node={node.first} path={child('first')} renderLeaf={renderLeaf} />
      </div>
      <ResizeHandle direction={node.direction} onRatioChange={(next) => setSplitRatio(workspaceId, path, next)} />
      <div className="flex min-h-0 min-w-0 overflow-hidden" style={{ flex: `${1 - ratio} 1 0%` }}>
        <SplitLayout workspaceId={workspaceId} node={node.second} path={child('second')} renderLeaf={renderLeaf} />
      </div>
    </div>
  )
}
