import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Bot, CircleCheckBig, Flag, Play, ShieldCheck, SquareTerminal, UserRound, type LucideIcon } from 'lucide-react'
import type { WorkflowNode, WorkflowNodeKind } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'

// One card per step: its kind's icon and colour, the label, and the line that matters for that kind
// (the role, the command, the round limit). Inputs enter on the left, outcomes leave on the right.

export type WorkflowCanvasNode = Node<{ node: WorkflowNode; issue: 'error' | 'warning' | null }, WorkflowNodeKind>

const ICONS: Record<WorkflowNodeKind, LucideIcon> = {
  start: Play,
  agent: Bot,
  review: ShieldCheck,
  check: SquareTerminal,
  human: UserRound,
  end: Flag
}

/** Accent per kind, from the theme's own tokens. */
const ACCENT: Record<WorkflowNodeKind, string> = {
  start: 'text-foreground',
  agent: 'text-primary',
  review: 'text-status-success',
  check: 'text-muted-foreground',
  human: 'text-agent-question-text',
  end: 'text-foreground'
}

function detail(node: WorkflowNode): string {
  const c = node.config
  switch (node.kind) {
    case 'agent':
      return [c.role, c.workspace === 'run-worktree' ? 'own worktree' : 'main workspace'].filter(Boolean).join(' · ')
    case 'review':
      return `${c.role ?? 'Reviewer'} · up to ${c.maxRounds ?? '?'} rounds`
    case 'check':
      return `${c.command?.trim() ? c.command : 'No command yet'} · up to ${c.maxRounds ?? '?'} tries`
    case 'human':
      return c.question?.trim() ? c.question : 'Asks the person'
    case 'end':
      return c.result === 'failed' ? 'Ends as failed' : 'Ends as done'
    default:
      return 'Where a run begins'
  }
}

function StepNode({ data, selected, type }: NodeProps<WorkflowCanvasNode>) {
  const Icon = ICONS[type]
  const { node, issue } = data
  return (
    <div
      data-workflow-node={node.kind}
      className={cn(
        'w-52 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-xs transition-colors',
        selected ? 'border-ring ring-2 ring-ring/30' : 'border-border',
        issue === 'error' && !selected && 'border-destructive/60'
      )}
    >
      {type !== 'start' && <Handle id="in" type="target" position={Position.Left} className="!size-2.5 !border-border !bg-background" />}
      {/* Edges back to an earlier step leave and arrive underneath, clear of the forward ones. */}
      {type !== 'start' && <Handle id="back-in" type="target" position={Position.Bottom} className="!size-1.5 !border-0 !bg-transparent" isConnectable={false} />}
      {type !== 'end' && <Handle id="back-out" type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-transparent" isConnectable={false} />}
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', ACCENT[type])} />
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.label}</div>
        {issue && (
          <span
            aria-label={issue === 'error' ? 'Has problems' : 'Has warnings'}
            className={cn('size-1.5 shrink-0 rounded-full', issue === 'error' ? 'bg-destructive' : 'bg-status-warning')}
          />
        )}
        {type === 'end' && node.config.result !== 'failed' && <CircleCheckBig className="size-3.5 shrink-0 text-status-success" />}
      </div>
      <div className="mt-0.5 truncate pl-6 text-[11px] text-muted-foreground">{detail(node)}</div>
      {type !== 'end' && <Handle id="out" type="source" position={Position.Right} className="!size-2.5 !border-border !bg-background" />}
    </div>
  )
}

const Step = memo(StepNode)

export const WORKFLOW_NODE_TYPES = {
  start: Step,
  agent: Step,
  review: Step,
  check: Step,
  human: Step,
  end: Step
}
