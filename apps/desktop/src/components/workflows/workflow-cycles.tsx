import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { RefreshCw } from 'lucide-react'
import type { WorkflowCycle, WorkflowNode, WorkflowPhase } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'

// Cycles (PDCA loops) drawn as frames around their steps (boxes from workflow-canvas-layout), so
// nesting reads at a glance: the dev ⇄ review cycle inside the Lead's cycle. The graph makes them:
// each edge back to an earlier step frames the steps it repeats.

export type CycleCanvasNode = Node<{ cycle: WorkflowCycle; depth: number; round: string | null }, 'cycle'>

/** The phase a step plays when none is set: Start plans, work does, reviews and checks check. */
export function phaseOf(node: WorkflowNode): WorkflowPhase | null {
  if (node.phase) return node.phase
  switch (node.kind) {
    case 'start':
      return 'plan'
    case 'agent':
    case 'custom':
      return 'do'
    case 'review':
    case 'check':
      return 'check'
    default:
      return null
  }
}

export const PHASE_LETTERS: Record<WorkflowPhase, string> = { plan: 'P', do: 'D', check: 'C', act: 'A' }

/** Phase badge colours, from the theme's own tokens. */
export const PHASE_CLASSES: Record<WorkflowPhase, string> = {
  plan: 'bg-primary/15 text-primary',
  do: 'bg-accent text-accent-foreground',
  check: 'bg-status-success/15 text-status-success',
  act: 'bg-status-warning/15 text-status-warning'
}

function CycleFrame({ data, selected, width, height }: NodeProps<CycleCanvasNode>) {
  const { cycle, round } = data
  return (
    <div
      data-workflow-cycle={cycle.id}
      style={{ width, height }}
      className={cn(
        'rounded-xl border-2 border-dashed bg-primary/[0.03] transition-colors',
        selected ? 'border-ring' : 'border-primary/30'
      )}
    >
      <div className="flex h-6 items-center gap-1.5 px-2.5 text-[11px] font-medium text-primary">
        <RefreshCw className="size-3" />
        <span className="truncate">{cycle.label || 'Cycle'}</span>
        <span className="font-normal text-muted-foreground">
          {round ?? `up to ${cycle.maxRounds} rounds`}
        </span>
      </div>
    </div>
  )
}

export const CycleNode = memo(CycleFrame)
