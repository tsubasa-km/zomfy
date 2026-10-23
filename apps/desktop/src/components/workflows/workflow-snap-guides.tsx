import { ViewportPortal } from '@xyflow/react'
import type { SnapGuide } from './workflow-snap'

// The lines a dragged step lined up on, in canvas coordinates, while the drag lasts.

const OVERHANG = 16

export function SnapGuides({ guides }: { guides: SnapGuide[] }) {
  if (guides.length === 0) return null
  return (
    <ViewportPortal>
      {guides.map((g) => (
        <div
          key={`${g.axis}:${g.at}`}
          aria-hidden
          data-workflow-snap-guide={g.axis}
          className="pointer-events-none absolute bg-primary"
          style={
            g.axis === 'x'
              ? { left: g.at, top: g.from - OVERHANG, width: 1, height: g.to - g.from + OVERHANG * 2 }
              : { top: g.at, left: g.from - OVERHANG, height: 1, width: g.to - g.from + OVERHANG * 2 }
          }
        />
      ))}
    </ViewportPortal>
  )
}
