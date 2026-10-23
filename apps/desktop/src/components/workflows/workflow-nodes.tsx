import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Bot, CircleCheckBig, Flag, HardDrive, Lock, Play, Puzzle, ShieldCheck, SquareTerminal, RefreshCw, UserRound, Users, type LucideIcon } from 'lucide-react'
import { chatAgentLabel, type WorkflowNode, type WorkflowNodeKind } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { CycleNode, PHASE_CLASSES, PHASE_LETTERS, phaseOf } from './workflow-cycles'
import { DataNode } from './workflow-data-canvas'

// One card per step: its kind's icon and colour, the label, and the line that matters for that kind
// (the role, the command, the round limit). Edges are routed by workflow-canvas-layout; the handles
// on the left and right are where new edges are dragged from and to.
// A step run by several sessions at once draws as a stack with its count.

/** How a run went through the step, in a run's view. */
export interface StepRunState {
  /** The run is on this step: working on it, or waiting for the person here. */
  now: 'running' | 'waiting' | null
  visits: number
  lastOutcome: string | null
  failed: boolean
}

export type WorkflowCanvasNode = Node<
  {
    /** With its agent's settings filled in, as it runs. */
    node: WorkflowNode
    issue: 'error' | 'warning' | null
    run?: StepRunState
    loop?: string
    /** It may hold what was learned from local-only data. */
    held?: boolean
  },
  WorkflowNodeKind
>

export const STEP_ICONS: Record<WorkflowNodeKind, LucideIcon> = {
  start: Play,
  agent: Bot,
  review: ShieldCheck,
  check: SquareTerminal,
  human: UserRound,
  end: Flag,
  custom: Puzzle
}

/** Accent per kind, from the theme's own tokens. */
export const STEP_ACCENTS: Record<WorkflowNodeKind, string> = {
  start: 'text-foreground',
  agent: 'text-primary',
  review: 'text-status-success',
  check: 'text-muted-foreground',
  human: 'text-agent-question-text',
  end: 'text-foreground',
  custom: 'text-primary'
}

const JOIN_LABELS = { all: 'all', majority: 'majority', any: 'any one', first: 'first done' } as const

/** The agent a step's sessions run on (the Lead's steps run in its Claude chat); null for steps that are not sessions. */
function stepAgent(node: WorkflowNode): string | null {
  const c = node.config
  if (node.kind !== 'agent' && node.kind !== 'review' && !(node.kind === 'custom' && c.runner !== 'command')) return null
  return c.runBy === 'lead' ? 'claude' : (c.agent ?? 'claude')
}

function detail(node: WorkflowNode): string {
  const c = node.config
  switch (node.kind) {
    case 'agent':
      return c.runBy === 'lead'
        ? 'The Lead'
        : [c.role, c.workspace === 'run-worktree' ? 'own worktree' : 'main workspace'].filter(Boolean).join(' · ')
    case 'review':
      return `${c.runBy === 'lead' ? 'The Lead' : (c.role ?? 'Reviewer')}${c.maxRounds ? ` · up to ${c.maxRounds} rounds` : ''}`
    case 'check':
      return `${c.command?.trim() ? c.command : 'No command yet'}${c.maxRounds ? ` · up to ${c.maxRounds} tries` : ''}`
    case 'human':
      return `${c.askLeadFirst ? 'Lead first, then you' : 'Asks you'}${c.question?.trim() ? ` · ${c.question}` : ''}`
    case 'end':
      return c.result === 'failed' ? 'Ends as failed' : 'Ends as done'
    case 'custom': {
      const fields = c.fields?.length ?? 0
      const runner = c.runner === 'command' ? c.command?.trim() || 'Command' : c.role || 'Agent'
      return `${runner}${fields > 0 ? ` · ${fields} field${fields > 1 ? 's' : ''}` : ''}`
    }
    default:
      return 'Where a run begins'
  }
}

function StepNode({ data, selected, type }: NodeProps<WorkflowCanvasNode>) {
  const Icon = STEP_ICONS[type]
  const { node, issue, run, loop, held } = data
  const parallel = node.config.parallel && node.config.parallel.count > 1 ? node.config.parallel : null
  const helpers = node.config.runBy === 'lead' ? 0 : (node.config.maxAgents ?? 0)
  const agent = stepAgent(node)
  const phase = phaseOf(node)
  return (
    <div className="relative" data-workflow-node={node.kind}>
      {/* The stack behind a parallel step, one sheet per extra session (up to two drawn). */}
      {parallel &&
        [2, 1].slice(2 - Math.min(2, parallel.count - 1)).map((depth) => (
          <div
            key={depth}
            aria-hidden
            className="absolute inset-0 rounded-lg border border-border bg-card"
            style={{ transform: `translate(${depth * 5}px, ${depth * 5}px)` }}
          />
        ))}
      <div
        data-step-now={run?.now ?? undefined}
        className={cn(
          'relative w-52 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-xs transition-colors',
          selected ? 'border-ring ring-2 ring-ring/30' : 'border-border',
          issue === 'error' && !selected && 'border-destructive/60',
          run?.now === 'running' && 'border-primary ring-4 ring-primary/25 motion-safe:animate-pulse',
          run?.now === 'waiting' && 'border-agent-question ring-4 ring-agent-question/25',
          run && !run.now && run.visits === 0 && 'opacity-50',
          run?.failed && 'border-destructive'
        )}
      >
        {type !== 'start' && <Handle id="in" type="target" position={Position.Left} className="!size-2.5 !border-border !bg-background" />}
        {/* Where data lines arrive; a data card is dropped on the step itself. */}
        <Handle id="data-in" type="target" position={Position.Top} isConnectable={false} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
        <div className="flex items-center gap-2">
          {phase && (
            <span
              className={cn('flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold', PHASE_CLASSES[phase])}
              title={`${phase[0]!.toUpperCase()}${phase.slice(1)} in its cycle`}
              data-workflow-phase={phase}
            >
              {PHASE_LETTERS[phase]}
            </span>
          )}
          <Icon className={cn('size-4 shrink-0', STEP_ACCENTS[type])} />
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.label}</div>
          {parallel && (
            <span
              className="shrink-0 rounded bg-accent px-1 text-[10px] font-medium text-accent-foreground tabular-nums"
              title={`${parallel.count} sessions at once; ${JOIN_LABELS[parallel.join]} decides`}
              data-workflow-parallel={parallel.count}
            >
              ×{parallel.count}
            </span>
          )}
          {helpers > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 rounded bg-accent px-1 text-[10px] font-medium text-accent-foreground tabular-nums"
              title={`Its agent may spawn up to ${helpers} helper agent${helpers > 1 ? 's' : ''} at once`}
              data-workflow-max-agents={helpers}
            >
              <Users className="size-2.5" />≤{helpers}
            </span>
          )}
          {issue && (
            <span
              aria-label={issue === 'error' ? 'Has problems' : 'Has warnings'}
              className={cn('size-1.5 shrink-0 rounded-full', issue === 'error' ? 'bg-destructive' : 'bg-status-warning')}
            />
          )}
          {type === 'end' && node.config.result !== 'failed' && <CircleCheckBig className="size-3.5 shrink-0 text-status-success" />}
          {held && (
            <span className="flex shrink-0 items-center" title="Works with local-only data; its results stay with local agents and you" data-workflow-held>
              <Lock className="size-3 text-status-warning" />
            </span>
          )}
          {node.config.local && node.config.runBy !== 'lead' && (
            <span className="flex shrink-0 items-center" title="Its agent runs on a local model" data-workflow-local>
              <HardDrive className="size-3 text-muted-foreground" />
            </span>
          )}
          {agent && (
            <span
              className="flex shrink-0 items-center"
              title={node.config.runBy === 'lead' ? "Run by the project's Lead (Claude)" : `Runs on ${chatAgentLabel(agent)}`}
              data-workflow-node-agent={agent}
            >
              <TuiAgentIcon agent={agent} size={14} />
            </span>
          )}
        </div>
        {loop && (
          <div className="mt-1 flex items-center gap-1 truncate pl-6 text-[11px] font-medium text-primary" data-workflow-loop-badge>
            <RefreshCw className="size-3 shrink-0" />
            <span className="truncate">{loop}</span>
          </div>
        )}
        <div className="mt-0.5 truncate pl-6 text-[11px] text-muted-foreground">
          {detail(node)}
          {parallel ? ` · ${JOIN_LABELS[parallel.join]}` : ''}
        </div>
        {run && (run.visits > 0 || run.now) && (
          <div className="mt-1 truncate pl-6 text-[11px] font-medium" data-step-visits={run.visits}>
            {run.now === 'running'
              ? 'Working…'
              : run.now === 'waiting'
                ? 'Waiting for you'
                : `${run.visits}× · ${run.lastOutcome ?? (run.failed ? 'failed' : '—')}`}
          </div>
        )}
        {type !== 'end' && <Handle id="out" type="source" position={Position.Right} className="!size-2.5 !border-border !bg-background" />}
      </div>
    </div>
  )
}

const Step = memo(StepNode)

export const WORKFLOW_NODE_TYPES = {
  cycle: CycleNode,
  data: DataNode,
  start: Step,
  agent: Step,
  review: Step,
  check: Step,
  human: Step,
  end: Step,
  custom: Step
}
