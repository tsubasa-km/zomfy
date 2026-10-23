import { MarkerType, type Edge } from '@xyflow/react'
import type { Workflow, WorkflowOutcome } from '@acp-harness/protocol'
import { outcomeLabel } from './workflow-model'
import type { EdgeRoute } from './workflow-canvas-layout'

// Edges as the canvas draws them, in the editor and in a run's view alike.

const OUTCOME_COLORS: Partial<Record<WorkflowOutcome, string>> = {
  next: 'var(--muted-foreground)',
  pass: 'var(--muted-foreground)',
  answered: 'var(--muted-foreground)',
  approve: 'var(--status-success)',
  changes: 'var(--status-warning)',
  fail: 'var(--destructive)',
  ask: 'var(--agent-question)'
}

export type RoutedEdge = Edge<{ route?: EdgeRoute }, 'route'>

/** `taken`: edges a run went along, drawn heavier; the rest fade while a run is shown. */
export function canvasEdges(
  workflow: Workflow,
  routes: Map<string, EdgeRoute>,
  selectedId: string | null,
  taken?: Set<string>
): RoutedEdge[] {
  return workflow.edges.map((edge) => {
    // A custom step's own outcomes take the accent colour.
    const color = OUTCOME_COLORS[edge.outcome] ?? 'var(--primary)'
    const selected = selectedId === edge.id
    const faded = taken !== undefined && !taken.has(edge.id)
    const route = routes.get(edge.id)
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'route',
      data: route ? { route } : {},
      label: outcomeLabel(edge.outcome),
      selected,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: selected || (taken && !faded) ? 2.5 : 1.5, opacity: faded ? 0.35 : 1 },
      labelStyle: { fontSize: 11, fill: color, fontWeight: 500, opacity: faded ? 0.5 : 1 },
      labelBgStyle: { fill: 'var(--background)' },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 4
    }
  })
}
