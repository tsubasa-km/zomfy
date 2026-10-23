import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Background, Controls, ReactFlow, useReactFlow, type NodeChange } from '@xyflow/react'
import { ArrowLeft, CircleStop, MessageSquare, Send } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS, workflowCycles, type WorkflowCycle, type WorkflowRun, type WorkflowRunStep } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { selectSession } from '@/session-store'
import { openWorkflows } from '@/stores/workflows-store'
import type { HostedWorkflowRun } from '@/stores/workflow-runs-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { WORKFLOW_NODE_TYPES, type StepRunState, type WorkflowCanvasNode } from './workflow-nodes'
import { canvasEdges } from './workflow-canvas-edges'
import { type CycleCanvasNode } from './workflow-cycles'
import { canvasLayout } from './workflow-canvas-layout'
import { WORKFLOW_EDGE_TYPES } from './workflow-route-edge'
import { LoopViewPanel, loopDecor, useLoopView } from './workflow-loop-view'
import { outcomeLabel } from './workflow-model'

// A run of a workflow: the graph as it was when the run started, with where the run is now, how
// often each step ran and which edges it took; beside it, the steps' log and the person's part.

const STATUS_LABELS: Record<WorkflowRun['status'], string> = {
  running: 'Running',
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped'
}

const STATUS_CLASSES: Record<WorkflowRun['status'], string> = {
  running: 'text-primary',
  waiting: 'text-agent-question-text',
  done: 'text-status-success',
  failed: 'text-destructive',
  stopped: 'text-muted-foreground'
}

function subscribeDark(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const useDark = () => useSyncExternalStore(subscribeDark, () => document.documentElement.classList.contains('dark'))

function stepStates(run: WorkflowRun): Map<string, StepRunState> {
  const states = new Map<string, StepRunState>()
  for (const node of run.workflow.nodes) {
    const steps = run.steps.filter((s) => s.nodeId === node.id)
    const done = steps.filter((s) => s.endedAt !== null)
    const last = done.at(-1)
    const here = run.currentNodeId === node.id
    const open = steps.some((s) => s.endedAt === null)
    // An End is reached, not run: it has no step of its own.
    const reached = node.kind === 'end' && here && (run.status === 'done' || run.status === 'failed')
    states.set(node.id, {
      now: here && run.status === 'waiting' ? 'waiting' : here && run.status === 'running' && open ? 'running' : null,
      visits: reached ? 1 : done.length,
      lastOutcome: reached ? 'Reached' : last?.outcome ? outcomeLabel(last.outcome) : null,
      failed: !!last?.error
    })
  }
  return states
}

/** The edges the run went along: each finished step's outcome edge out of its node. */
function takenEdges(run: WorkflowRun): Set<string> {
  const taken = new Set<string>()
  for (const step of run.steps) {
    if (!step.outcome) continue
    const edge = run.workflow.edges.find((e) => e.from === step.nodeId && e.outcome === step.outcome)
    if (edge) taken.add(edge.id)
  }
  return taken
}

function duration(step: WorkflowRunStep): string {
  const ms = (step.endedAt ?? Date.now()) - step.startedAt
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export function WorkflowRunView({ run, onBack }: { run: HostedWorkflowRun; onBack: () => void }) {
  const dark = useDark()
  const flow = useReactFlow()
  const [focusNode, setFocusNode] = useState<string | null>(null)
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  const loopView = useLoopView()
  const fitted = useRef(false)
  const measured = run.workflow.nodes.length > 0 && run.workflow.nodes.every((n) => sizes[n.id])
  useEffect(() => {
    if (!measured || fitted.current) return
    fitted.current = true
    void flow.fitView({ padding: 0.2, maxZoom: 1 })
  }, [measured, flow])

  const states = stepStates(run)
  const cycles = workflowCycles(run.workflow)
  const visited = new Set(run.steps.map((s) => s.nodeId))
  const roundOf = (cycle: WorkflowCycle) =>
    cycle.nodeIds.some((id) => visited.has(id))
      ? `round ${(run.rounds[`cycle:${cycle.id}`] ?? 0) + 1}${cycle.maxRounds ? ` of ${cycle.maxRounds}` : ''}`
      : 'not reached'
  const decor = loopDecor(loopView, cycles, roundOf)
  const nodes: WorkflowCanvasNode[] = run.workflow.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: node.x, y: node.y },
    data: { node, issue: null, run: states.get(node.id), loop: decor.nodes.get(node.id) },
    selected: focusNode === node.id,
    draggable: false,
    connectable: false,
    ...(sizes[node.id] ? { measured: sizes[node.id] } : {})
  }))
  const { boxes, routes } = canvasLayout(run.workflow, sizes)
  const edges = canvasEdges(run.workflow, routes, null, takenEdges(run), decor.edges)
  const cycleNodes: CycleCanvasNode[] = cycles.flatMap((cycle, tone) => {
    const box = boxes.get(cycle.id)
    if (!box || !decor.areas) return []
    return [
      {
        id: `cycle:${cycle.id}`,
        type: 'cycle' as const,
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        zIndex: -100 + box.depth,
        draggable: false,
        selectable: false,
        data: { cycle, depth: box.depth, round: roundOf(cycle), variant: decor.areas, tone }
      }
    ]
  })

  const onNodesChange = (changes: NodeChange<WorkflowCanvasNode | CycleCanvasNode>[]) => {
    const now: Record<string, { width: number; height: number }> = {}
    for (const change of changes) {
      if ('id' in change && change.id.startsWith('cycle:')) continue
      if (change.type === 'dimensions' && change.dimensions) now[change.id] = change.dimensions
      else if (change.type === 'select') setFocusNode(change.selected ? change.id : null)
    }
    if (Object.keys(now).length > 0) setSizes((all) => ({ ...all, ...now }))
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative min-w-0 flex-1 [&_.react-flow\_\_node]:!cursor-default [&_.react-flow\_\_nodesselection-rect]:!cursor-default [&_.react-flow\_\_pane]:!cursor-default [&_.react-flow\_\_node.dragging]:!cursor-grabbing [&_.react-flow\_\_pane.dragging]:!cursor-grabbing" data-workflow-run-canvas>
        <ReactFlow
          nodes={[...cycleNodes, ...nodes]}
          edges={edges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          edgeTypes={WORKFLOW_EDGE_TYPES}
          onNodesChange={onNodesChange}
          onPaneClick={() => setFocusNode(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          deleteKeyCode={null}
          colorMode={dark ? 'dark' : 'light'}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <LoopViewPanel cycles={cycles} rounds={roundOf} />
        </ReactFlow>
      </div>
      <RunPanel run={run} focusNode={focusNode} onBack={onBack} />
    </div>
  )
}

function RunPanel({ run, focusNode, onBack }: { run: HostedWorkflowRun; focusNode: string | null; onBack: () => void }) {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const live = run.status === 'running' || run.status === 'waiting'
  // The running step's time counts up while the run is live.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [live])
  const steps = focusNode ? run.steps.filter((s) => s.nodeId === focusNode) : run.steps
  const followUps = run.followUps ?? []

  const act = async (method: typeof HARNESS_METHODS.workflowRunAnswer | typeof HARNESS_METHODS.workflowRunStop, text?: string) => {
    setBusy(true)
    try {
      if (method === HARNESS_METHODS.workflowRunAnswer) {
        await harnessRequest(method, { runId: run.id, text: text ?? '' }, run.hostId)
        setAnswer('')
      } else await harnessRequest(method, { runId: run.id }, run.hostId)
    } catch (error) {
      toast.error('The run did not take that', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border" data-workflow-run-panel>
      <div className="space-y-2 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="-ml-2 h-7" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            Editor
          </Button>
          <span className={cn('ml-auto text-xs font-medium', STATUS_CLASSES[run.status])} data-run-status={run.status}>
            {STATUS_LABELS[run.status]}
          </span>
          {live && (
            <Button variant="outline" size="sm" className="h-7" disabled={busy} onClick={() => void act(HARNESS_METHODS.workflowRunStop)}>
              <CircleStop className="size-3.5" />
              Stop
            </Button>
          )}
        </div>
        <p className="line-clamp-4 text-xs whitespace-pre-wrap text-foreground">{run.task}</p>
        <p className="text-[11px] text-muted-foreground">Started {new Date(run.createdAt).toLocaleString()}</p>
      </div>

      {run.status === 'waiting' && run.waiting && (
        <div className="space-y-2 border-b border-border bg-agent-question/5 p-4" data-run-waiting={run.waiting.reason}>
          <div className="text-xs font-medium text-agent-question-text">
            {run.waiting.reason === 'limit' ? 'A loop needs your direction' : run.waiting.reason === 'ask' ? 'A step has a question' : 'Your turn'}
          </div>
          <p className="text-xs whitespace-pre-wrap">{run.waiting.question}</p>
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={run.waiting.reason === 'limit' ? 'How the loop should go on' : 'Your answer'}
            className="min-h-20 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && answer.trim()) void act(HARNESS_METHODS.workflowRunAnswer, answer)
            }}
          />
          <Button size="sm" className="h-7" disabled={busy || !answer.trim()} onClick={() => void act(HARNESS_METHODS.workflowRunAnswer, answer)}>
            <Send className="size-3.5" />
            Answer
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" data-run-steps>
        {focusNode && <p className="text-[11px] text-muted-foreground">Showing one step; click the canvas to see all.</p>}
        {steps.length === 0 && <p className="text-xs text-muted-foreground">No steps yet.</p>}
        {steps.map((step) => (
          <div key={step.id} className="space-y-1 rounded-md border border-border p-2" data-run-step={step.nodeId}>
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium">{step.label}</span>
              {step.outcome && <span className="rounded bg-accent px-1 text-[10px] text-accent-foreground">{outcomeLabel(step.outcome)}</span>}
              {step.endedAt === null && !step.error && <span className="text-[10px] text-primary">running</span>}
              <span className="text-[10px] text-muted-foreground tabular-nums">{duration(step)}</span>
            </div>
            {step.error && <p className="text-[11px] text-destructive">{step.error}</p>}
            {step.summary && (
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer truncate">{step.summary.split('\n')[0]}</summary>
                <p className="mt-1 whitespace-pre-wrap">{step.summary}</p>
              </details>
            )}
            {step.sessionIds.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {step.sessionIds.map((id, i) => (
                  <Button
                    key={id}
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px]"
                    onClick={() => {
                      openWorkflows(null)
                      selectSession(id)
                    }}
                  >
                    <MessageSquare className="size-3" />
                    {step.sessionIds.length > 1 ? `Chat ${i + 1}` : 'Open chat'}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
        {!focusNode && followUps.length > 0 && (
          <div className="space-y-1 rounded-md border border-dashed border-border p-2" data-run-follow-ups>
            <div className="text-xs font-medium">Left for later ({followUps.length})</div>
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
              {followUps.map((f, i) => (
                <li key={i}>
                  <span className="text-foreground">{f.label}:</span> {f.text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  )
}
