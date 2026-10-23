import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { RefreshCw } from 'lucide-react'
import { cyclesOf, type Workflow, type WorkflowCycle, type WorkflowNode, type WorkflowPhase } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'

// Cycles (PDCA loops) drawn as frames around their steps. A frame's box follows its steps (and the
// frames inside it), so nesting reads at a glance: the dev ⇄ review cycle inside the Lead's cycle.

const CARD = { width: 208, height: 60 }
const PAD = 18
const TITLE = 26

export interface CycleBox {
  x: number
  y: number
  width: number
  height: number
  depth: number
}

export type CycleCanvasNode = Node<{ cycle: WorkflowCycle; depth: number; round: string | null }, 'cycle'>

/** Each cycle's frame on the canvas, from its steps' positions and measured sizes. */
export function cycleBoxes(workflow: Workflow, sizes: Record<string, { width: number; height: number }>): Map<string, CycleBox> {
  const cycles = workflow.cycles ?? []
  const boxes = new Map<string, CycleBox>()
  const depthOf = (cycle: WorkflowCycle): number => {
    let depth = 0
    for (let c = cycle; c.parentId; depth++) {
      const parent = cycles.find((p) => p.id === c.parentId)
      if (!parent || depth > cycles.length) break
      c = parent
    }
    return depth
  }
  const box = (cycle: WorkflowCycle, seen: Set<string>): CycleBox | null => {
    const known = boxes.get(cycle.id)
    if (known) return known
    if (seen.has(cycle.id)) return null
    seen.add(cycle.id)
    const rects: { x: number; y: number; r: number; b: number }[] = []
    for (const node of workflow.nodes.filter((n) => n.cycleId === cycle.id)) {
      const size = sizes[node.id] ?? CARD
      rects.push({ x: node.x, y: node.y, r: node.x + size.width, b: node.y + size.height })
    }
    for (const child of cycles.filter((c) => c.parentId === cycle.id)) {
      const inner = box(child, seen)
      if (inner) rects.push({ x: inner.x, y: inner.y, r: inner.x + inner.width, b: inner.y + inner.height })
    }
    if (rects.length === 0) return null
    const x = Math.min(...rects.map((r) => r.x)) - PAD
    const y = Math.min(...rects.map((r) => r.y)) - PAD - TITLE
    const result = {
      x,
      y,
      width: Math.max(...rects.map((r) => r.r)) + PAD - x,
      height: Math.max(...rects.map((r) => r.b)) + PAD - y,
      depth: depthOf(cycle)
    }
    boxes.set(cycle.id, result)
    return result
  }
  for (const cycle of cycles) box(cycle, new Set())
  return boxes
}

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

/** Makes a cycle around `stepIds`, inside the innermost cycle they all share. */
export function makeCycle(workflow: Workflow, stepIds: string[], label: string): Workflow {
  const steps = workflow.nodes.filter((n) => stepIds.includes(n.id))
  if (steps.length === 0) return workflow
  const chains = steps.map((n) => cyclesOf(workflow, n))
  const shared = chains[0]!.find((c) => chains.every((chain) => chain.some((x) => x.id === c.id)))
  const cycle: WorkflowCycle = { id: crypto.randomUUID(), label, maxRounds: 3, ...(shared ? { parentId: shared.id } : {}) }
  const reparent = new Set<string>()
  const nodes = workflow.nodes.map((n) => {
    if (!stepIds.includes(n.id)) return n
    // A step deeper than the shared cycle brings its whole sub-cycle along instead of leaving it.
    const chain = cyclesOf(workflow, n)
    const below = shared ? chain[chain.findIndex((c) => c.id === shared.id) - 1] : chain.at(-1)
    if (below) {
      reparent.add(below.id)
      return n
    }
    return { ...n, cycleId: cycle.id }
  })
  const cycles = (workflow.cycles ?? []).map((c) => (reparent.has(c.id) ? { ...c, parentId: cycle.id } : c))
  return { ...workflow, nodes, cycles: [...cycles, cycle] }
}

/** Removes a cycle; its steps and inner cycles move up to the cycle around it. */
export function ungroupCycle(workflow: Workflow, cycleId: string): Workflow {
  const cycle = (workflow.cycles ?? []).find((c) => c.id === cycleId)
  if (!cycle) return workflow
  const nodes = workflow.nodes.map((n) => {
    if (n.cycleId !== cycleId) return n
    const { cycleId: _, ...rest } = n
    return cycle.parentId ? { ...rest, cycleId: cycle.parentId } : rest
  })
  const cycles = (workflow.cycles ?? [])
    .filter((c) => c.id !== cycleId)
    .map((c) => {
      if (c.parentId !== cycleId) return c
      const { parentId: _, ...rest } = c
      return cycle.parentId ? { ...rest, parentId: cycle.parentId } : rest
    })
  return { ...workflow, nodes, cycles }
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
          {round ?? (cycle.maxRounds ? `up to ${cycle.maxRounds} rounds` : 'no round limit')}
        </span>
      </div>
    </div>
  )
}

export const CycleNode = memo(CycleFrame)
