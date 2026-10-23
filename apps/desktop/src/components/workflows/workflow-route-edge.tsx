import { memo } from 'react'
import { BaseEdge, type EdgeProps } from '@xyflow/react'
import type { RoutedEdge } from './workflow-canvas-edges'
import { routePath } from './workflow-canvas-layout'

// Draws an edge along the route the canvas layout chose; until the cards are measured, a straight line.

function RouteEdgeView({ data, sourceX, sourceY, targetX, targetY, ...rest }: EdgeProps<RoutedEdge>) {
  const route = data?.route
  const points = route?.points ?? [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY }
  ]
  const label = route?.label ?? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 }
  return (
    <BaseEdge
      path={routePath(points)}
      labelX={label.x}
      labelY={label.y}
      label={rest.label}
      labelStyle={rest.labelStyle}
      labelShowBg={rest.labelShowBg}
      labelBgStyle={rest.labelBgStyle}
      labelBgPadding={rest.labelBgPadding}
      labelBgBorderRadius={rest.labelBgBorderRadius}
      markerEnd={rest.markerEnd}
      style={rest.style}
      interactionWidth={rest.interactionWidth}
    />
  )
}

export const WORKFLOW_EDGE_TYPES = { route: memo(RouteEdgeView) }
