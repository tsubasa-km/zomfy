import { MarkerType, type Edge } from '@xyflow/react'
import type { Workflow, WorkflowOutcome } from '@acp-harness/protocol'
import { outcomeLabel } from './workflow-model'

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

/** `taken`: edges a run went along, drawn heavier; the rest fade while a run is shown. */
export function canvasEdges(workflow: Workflow, selectedId: string | null, taken?: Set<string>): Edge[] {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]))
  return workflow.edges.map((edge) => {
    // A custom step's own outcomes take the accent colour.
    const color = OUTCOME_COLORS[edge.outcome] ?? 'var(--primary)'
    const selected = selectedId === edge.id
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    // Back to an earlier step: under the row, lower the further back it goes, so loops stay readable.
    const back = !!from && !!to && to.x < from.x - 40
    const faded = taken !== undefined && !taken.has(edge.id)
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle: back ? 'back-out' : 'out',
      targetHandle: back ? 'back-in' : 'in',
      type: 'smoothstep',
      pathOptions: back && from && to ? { offset: 24 + Math.round((from.x - to.x) / 12), borderRadius: 8 } : { borderRadius: 8 },
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
