import { useEffect, useRef, useState } from 'react'
import { clampSidebarWidth, setSidebarWidth, type SidebarWidthKey } from '@/stores/sidebar-width-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The draggable edge of a sidebar: on the left sidebar's right edge, on a pane sidebar's left edge.
// It sits over the sidebar's border, so the layout does not change; a double-click restores the width.

export function SidebarResizeHandle({ widthKey, edge }: { widthKey: SidebarWidthKey; edge: 'left' | 'right' }) {
  const [dragging, setDragging] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || cleanupRef.current) return
    event.preventDefault()
    const handle = event.currentTarget
    const sidebar = handle.parentElement
    if (!sidebar) return
    const startX = event.clientX
    const startWidth = sidebar.getBoundingClientRect().width
    let width: number | null = null
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    // Style writes while dragging; the store (and storage) hears only where it ends.
    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX
      width = clampSidebarWidth(widthKey, startWidth + (edge === 'right' ? delta : -delta))
      sidebar.style.width = `${width}px`
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', cleanup)
      handle.removeEventListener('pointercancel', cleanup)
      handle.removeEventListener('lostpointercapture', cleanup)
      cleanupRef.current = null
      setDragging(false)
      if (width !== null) setSidebarWidth(widthKey, width)
      sidebar.style.width = ''
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', cleanup)
    handle.addEventListener('pointercancel', cleanup)
    handle.addEventListener('lostpointercapture', cleanup)
    cleanupRef.current = cleanup
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Resize sidebar')}
      title={t('Drag to resize · double-click to reset')}
      data-sidebar-resize={widthKey}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setSidebarWidth(widthKey)}
      className={cn(
        'group absolute inset-y-0 z-20 w-1.5 cursor-col-resize touch-none',
        edge === 'right' ? '-right-px' : '-left-px'
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 w-0.5 transition-colors group-hover:bg-highlight/60',
          edge === 'right' ? 'right-0' : 'left-0',
          dragging && 'bg-highlight'
        )}
      />
    </div>
  )
}
