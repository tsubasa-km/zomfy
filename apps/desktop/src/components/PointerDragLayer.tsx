import { attachPointerDragPreview, usePointerDragPreview } from '@/lib/pointer-drag'
import { cn } from '@/lib/utils'

/** The floating preview of an in-app pointer drag; lib/pointer-drag.ts moves it with the cursor. */
export function PointerDragLayer() {
  const preview = usePointerDragPreview()
  if (!preview) return null
  return (
    <div
      ref={attachPointerDragPreview}
      aria-hidden
      data-pointer-drag-preview=""
      className="pointer-events-none fixed top-0 left-0 z-[100]"
      style={{ width: preview.width, height: preview.height, transform: preview.transform }}
    >
      {preview.node}
    </div>
  )
}

/** Orca's TabDragPreview chip, reused for every dragged item. */
export function DragChip({ icon, label, fill = false }: { icon?: React.ReactNode; label: string; fill?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-sm border border-border bg-accent px-2 text-xs text-foreground shadow-md',
        fill ? 'h-full w-full' : 'h-7 max-w-[260px]'
      )}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
    </div>
  )
}
