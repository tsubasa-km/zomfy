import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type FinalConnectionState,
  type EdgeChange,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronDown, Copy, Database, FlaskConical, HardDrive, History, Plus, Save, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  HARNESS_METHODS,
  localOnlySteps,
  resolveWorkflowAgents,
  workflowCycles,
  workflowOutcomes,
  type Workflow,
  type WorkflowAgentProfile,
  type WorkflowDataLink,
  type WorkflowDataSource,
  type WorkflowNode,
  type WorkflowNodeConfig,
  type WorkflowNodeKind,
  type WorkflowOutcome
} from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { useWorkflowAgents } from '@/stores/workflow-agents-store'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import type { HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { openWorkflows, type WorkflowsPageTarget } from '@/stores/workflows-store'
import { cn } from '@/lib/utils'
import { STEP_ACCENTS, STEP_ICONS, WORKFLOW_NODE_TYPES, type WorkflowCanvasNode } from './workflow-nodes'
import type { CycleCanvasNode } from './workflow-cycles'
import { GRID, snapRect, type SnapGuide } from './workflow-snap'
import { SnapGuides } from './workflow-snap-guides'
import { LoopViewPanel, loopDecor, useLoopView } from './workflow-loop-view'
import { canvasLayout } from './workflow-canvas-layout'
import { WORKFLOW_TEMPLATES } from './workflow-samples'
import { EditHistory } from './workflow-edit-history'
import { copySteps, pasteSnippet, pasteSteps, snippetOf } from './workflow-clipboard'
import { isMac } from '@/lib/terminal-shortcuts'
import { WORKFLOW_EDGE_TYPES } from './workflow-route-edge'
import { WorkflowInspector } from './WorkflowInspector'
import { WorkflowConnectMenu, type PendingConnection } from './WorkflowConnectMenu'
import { canvasEdges } from './workflow-canvas-edges'
import { WorkflowRunView } from './WorkflowRunView'
import { WorkflowCompareDialog } from './WorkflowCompareDialog'
import { WorkflowExperimentView } from './WorkflowExperimentView'
import { loadWorkflowExperiments, useWorkflowExperiment, useWorkflowExperiments } from '@/stores/workflow-experiments-store'
import { WorkflowAgentDialog, blankAgentProfile } from './WorkflowAgentDialog'
import { DATA_PREFIX, LINK_PREFIX, dataCanvasEdges, dataCanvasNodes, type DataCanvasNode } from './workflow-data-canvas'
import { loadWorkflowRuns, useWorkflowRun, useWorkflowRuns } from '@/stores/workflow-runs-store'
import {
  NODE_KINDS,
  blankWorkflow,
  newAgentStep,
  newDataSource,
  newNode,
  nextOutcome,
  reviewLoopTemplate,
  validateWorkflow,
  withoutData,
  withoutSteps,
  type WorkflowIssue
} from './workflow-model'

// A project's agent workflows, drawn as a graph (React Flow): steps are cards, edges carry the
// outcome that takes a run along them. The harness walks this graph; the editor only shapes it.

function subscribeDark(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** A key press meant for a text field, which keeps its own undo and clipboard. */
function typingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

const useDark = () => useSyncExternalStore(subscribeDark, () => document.documentElement.classList.contains('dark'))

export function WorkflowsPage({ target }: { target: WorkflowsPageTarget }) {
  const [saved, setSaved] = useState<Workflow[] | null>(null)
  const [draft, setDraft] = useState<Workflow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [viewRunId, setViewRunId] = useState<string | null>(target.runId ?? null)
  const history = useRef(new EditHistory())
  const runs = useWorkflowRuns(target.hostId, target.projectId)
  const agents = useWorkflowAgents(target.hostId)
  const experiments = useWorkflowExperiments(target.hostId, target.projectId)
  const [viewExperimentId, setViewExperimentId] = useState<string | null>(null)
  const viewExperiment = useWorkflowExperiment(viewExperimentId)
  const [comparing, setComparing] = useState(false)
  const viewRun = useWorkflowRun(viewRunId)

  useEffect(() => {
    void loadWorkflowRuns(target.hostId, target.projectId).catch(() => undefined)
    void loadWorkflowExperiments(target.hostId, target.projectId).catch(() => undefined)
  }, [target.hostId, target.projectId])

  useEffect(() => {
    let live = true
    setSaved(null)
    setDraft(null)
    harnessRequest(HARNESS_METHODS.workflowsList, { projectId: target.projectId }, target.hostId)
      .then((list) => {
        if (!live) return
        setSaved(list)
        history.current.reset()
        // A project without workflows starts from the review loop, unsaved, as a starting point.
        setDraft(list[0] ?? reviewLoopTemplate(target.projectId))
        setDirty(list.length === 0)
      })
      .catch((error: unknown) => {
        if (!live) return
        setSaved([])
        toast.error('Could not load workflows', { description: String(error) })
      })
    return () => {
      live = false
    }
  }, [target.hostId, target.projectId])

  const confirmDiscard = () => !dirty || window.confirm('Discard the unsaved changes to this workflow?')

  const pick = (workflow: Workflow) => {
    if (workflow.id === draft?.id || !confirmDiscard()) return
    history.current.reset()
    setDraft(workflow)
    setDirty(false)
  }

  /** A copy to change one thing in, for comparing against the original. */
  const duplicate = () => {
    if (!draft || !confirmDiscard()) return
    history.current.reset()
    setDraft({ ...structuredClone(draft), id: crypto.randomUUID(), name: `${draft.name} (variant)`, updatedAt: Date.now() })
    setDirty(true)
  }

  const startNew = (make: (projectId: string) => Workflow) => {
    if (!confirmDiscard()) return
    history.current.reset()
    setDraft(make(target.projectId))
    setDirty(true)
  }

  const save = useCallback(async () => {
    if (!draft || busy) return
    setBusy(true)
    try {
      const list = await harnessRequest(HARNESS_METHODS.workflowSave, { workflow: draft }, target.hostId)
      setSaved(list)
      setDirty(false)
      toast.success('Workflow saved', { description: draft.name })
    } catch (error) {
      toast.error('Could not save the workflow', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }, [draft, busy, target.hostId])

  const remove = async () => {
    if (!draft) return
    const stored = saved?.some((w) => w.id === draft.id)
    if (!window.confirm(`Delete the workflow "${draft.name}"?`)) return
    const list = stored
      ? await harnessRequest(HARNESS_METHODS.workflowRemove, { projectId: target.projectId, workflowId: draft.id }, target.hostId)
      : (saved ?? [])
    setSaved(list)
    history.current.reset()
    setDraft(list[0] ?? blankWorkflow(target.projectId))
    setDirty(list.length === 0)
  }

  const issues = useMemo(() => (draft ? validateWorkflow(draft, agents) : []), [draft, agents])
  const errors = issues.filter((i) => i.level === 'error').length
  const draftRuns = runs.filter((r) => r.workflowId === draft?.id)

  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      data-workflows-page
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          void save()
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <WorkflowIcon className="size-4 text-muted-foreground" />
        <div className="text-sm font-medium">Workflows</div>
        <div className="text-sm text-muted-foreground">· {target.projectName}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-2 h-7 gap-1" disabled={!draft}>
              <span className="max-w-56 truncate">{draft?.name ?? 'Loading…'}</span>
              {dirty && <span className="size-1.5 rounded-full bg-status-warning" aria-label="Unsaved changes" />}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {saved && saved.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">Saved</DropdownMenuLabel>}
            {saved?.map((w) => (
              <DropdownMenuItem key={w.id} onSelect={() => pick(w)}>
                {w.name}
              </DropdownMenuItem>
            ))}
            {saved && saved.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={duplicate} disabled={!draft} data-workflow-duplicate>
              <Copy className="size-3.5" />
              Duplicate as a variant
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">New from a template</DropdownMenuLabel>
            {WORKFLOW_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.name} onSelect={() => startNew(t.make)} data-workflow-template={t.name}>
                <Plus className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-[11px] text-muted-foreground">{t.hint}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-2">
          {draft && (
            <span className={cn('text-xs', errors > 0 ? 'text-destructive' : 'text-status-success')} data-workflow-status>
              {errors > 0 ? `${errors} problem${errors > 1 ? 's' : ''}` : 'Ready to run'}
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setComparing(true)} disabled={!saved?.length} data-workflow-compare>
            <FlaskConical className="size-3.5" />
            Compare
          </Button>
          {experiments.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1" data-workflow-experiments>
                  Results
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {experiments.map((e) => (
                  <DropdownMenuItem key={e.id} onSelect={() => setViewExperimentId(e.id)} data-workflow-experiment-item={e.status}>
                    <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{e.status}</span>
                    <span className="min-w-0 flex-1 truncate">{e.task}</span>
                    <span className="text-[11px] text-muted-foreground">{e.workflowIds.length} flows</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {draftRuns.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1" data-workflow-runs>
                  <History className="size-3.5" />
                  Runs
                  {draftRuns.some((r) => r.status === 'waiting') && (
                    <span className="size-1.5 rounded-full bg-agent-question" aria-label="A run is waiting for you" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {draftRuns.map((r) => (
                  <DropdownMenuItem key={r.id} onSelect={() => setViewRunId(r.id)} data-workflow-run-item={r.status}>
                    <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{r.status}</span>
                    <span className="min-w-0 flex-1 truncate">{r.task}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="ghost" size="sm" className="h-7" onClick={() => void remove()} disabled={!draft} aria-label="Delete workflow">
            <Trash2 className="size-3.5" />
          </Button>
          <Button size="sm" className="h-7" onClick={() => void save()} disabled={!draft || !dirty || busy}>
            <Save className="size-3.5" />
            Save
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Close workflows"
            onClick={() => {
              if (confirmDiscard()) openWorkflows(null)
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      {viewRun ? (
        <ReactFlowProvider key={viewRun.id}>
          <WorkflowRunView run={viewRun} onBack={() => setViewRunId(null)} />
        </ReactFlowProvider>
      ) : viewExperiment ? (
        <WorkflowExperimentView
          experiment={viewExperiment}
          workflows={saved ?? []}
          onOpenRun={setViewRunId}
          onBack={() => setViewExperimentId(null)}
        />
      ) : draft ? (
        <ReactFlowProvider key={draft.id}>
          <WorkflowCanvas
            hostId={target.hostId}
            workflow={draft}
            agents={agents}
            issues={issues}
            onChange={(next) => {
              history.current.record(draft)
              setDraft(next)
              setDirty(true)
            }}
            onHistory={(step) => {
              const restored = step === 'undo' ? history.current.undo(draft) : history.current.redo(draft)
              if (!restored) return
              setDraft(restored)
              setDirty(true)
            }}
          />
        </ReactFlowProvider>
      ) : (
        <div className="m-auto text-sm text-muted-foreground">Loading workflows…</div>
      )}
      {comparing && (
        <WorkflowCompareDialog
          hostId={target.hostId}
          projectId={target.projectId}
          workflows={saved ?? []}
          initial={draft ? [draft.id] : []}
          onClose={() => setComparing(false)}
          onStarted={(experiment) => {
            setComparing(false)
            setViewRunId(null)
            setViewExperimentId(experiment.id)
          }}
        />
      )}
    </div>
  )
}

type Selection = { nodes: string[] } | { edge: string } | { cycle: string } | { data: string } | { link: string } | null

const CYCLE_PREFIX = 'cycle:'

function WorkflowCanvas({
  hostId,
  workflow,
  agents,
  issues,
  onChange,
  onHistory
}: {
  hostId: HostId
  workflow: Workflow
  agents: WorkflowAgentProfile[]
  issues: WorkflowIssue[]
  onChange: (workflow: Workflow) => void
  onHistory: (step: 'undo' | 'redo') => void
}) {
  const dark = useDark()
  const flow = useReactFlow()
  // React Flow measures the cards; a controlled flow must hand the sizes back on its nodes.
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  const measured = workflow.nodes.length > 0 && workflow.nodes.every((n) => sizes[n.id])
  const fitted = useRef(false)
  useEffect(() => {
    if (!measured || fitted.current) return
    fitted.current = true
    void flow.fitView({ padding: 0.2, maxZoom: 1 })
  }, [measured, flow])
  const canvasRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const loopView = useLoopView()
  // Holding Alt places a dragged step freely.
  const snapOff = useRef(false)
  useEffect(() => {
    const track = (e: KeyboardEvent) => {
      snapOff.current = e.altKey
    }
    window.addEventListener('keydown', track)
    window.addEventListener('keyup', track)
    return () => {
      window.removeEventListener('keydown', track)
      window.removeEventListener('keyup', track)
    }
  }, [])
  const pickedNodes = selection && 'nodes' in selection ? selection.nodes : []
  const selectedNode = pickedNodes.length === 1 ? (workflow.nodes.find((n) => n.id === pickedNodes[0]) ?? null) : null
  const selectedEdge = selection && 'edge' in selection ? (workflow.edges.find((e) => e.id === selection.edge) ?? null) : null
  const cycles = workflowCycles(workflow)
  const selectedCycle = selection && 'cycle' in selection ? (cycles.find((c) => c.id === selection.cycle) ?? null) : null
  const selectedData = selection && 'data' in selection ? (workflow.data?.find((d) => d.id === selection.data) ?? null) : null
  const selectedLink = selection && 'link' in selection ? (workflow.dataLinks?.find((l) => l.id === selection.link) ?? null) : null
  const [agentDialog, setAgentDialog] = useState<{ profile: WorkflowAgentProfile; isNew: boolean; forNode?: string; place?: boolean } | null>(null)

  const issueOf = (nodeId: string): 'error' | 'warning' | null => {
    const mine = issues.filter((i) => i.nodeId === nodeId)
    return mine.some((i) => i.level === 'error') ? 'error' : mine.length > 0 ? 'warning' : null
  }
  const dataIssueOf = (dataId: string): 'error' | 'warning' | null => {
    const mine = issues.filter((i) => i.dataId === dataId && !i.nodeId)
    return mine.some((i) => i.level === 'error') ? 'error' : mine.length > 0 ? 'warning' : null
  }
  // Cards show each step as it runs: with its agent's settings, and whether it holds local-only data.
  const resolved = resolveWorkflowAgents(workflow, agents)
  const held = localOnlySteps(resolved)

  const { boxes, routes } = canvasLayout(workflow, sizes)
  const decor = loopDecor(loopView, cycles)
  const cycleNodes: CycleCanvasNode[] = cycles.flatMap((cycle, tone) => {
    const box = boxes.get(cycle.id)
    if (!box || !decor.areas) return []
    return [
      {
        id: `${CYCLE_PREFIX}${cycle.id}`,
        type: 'cycle' as const,
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        // Outer frames behind inner ones, all behind the steps.
        zIndex: -100 + box.depth,
        data: { cycle, depth: box.depth, round: null, variant: decor.areas, tone },
        selected: selectedCycle?.id === cycle.id,
        connectable: false,
        deletable: false
      }
    ]
  })
  const stepNodes: WorkflowCanvasNode[] = workflow.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: node.x, y: node.y },
    data: {
      node: resolved.nodes.find((n) => n.id === node.id) ?? node,
      issue: issueOf(node.id),
      loop: decor.nodes.get(node.id),
      held: held.has(node.id)
    },
    selected: pickedNodes.includes(node.id),
    deletable: node.kind !== 'start',
    ...(sizes[node.id] ? { measured: sizes[node.id] } : {})
  }))
  const dataNodes = dataCanvasNodes(workflow, selectedData?.id ?? null, dataIssueOf, sizes)
  const nodes: (WorkflowCanvasNode | CycleCanvasNode | DataCanvasNode)[] = [...cycleNodes, ...dataNodes, ...stepNodes]

  const edges = [...canvasEdges(workflow, routes, selectedEdge?.id ?? null, undefined, decor.edges), ...dataCanvasEdges(workflow, selectedLink?.id ?? null)]

  const removeNodes = (ids: Set<string>) => onChange(withoutSteps(workflow, ids))

  // Undo, redo, copy, cut, paste, duplicate and select all, unless a text field has the keys.
  const shortcut = useRef<(e: KeyboardEvent) => void>(() => undefined)
  shortcut.current = (e) => {
    if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey || typingIn(e.target) || document.querySelector('[role="dialog"]')) return
    const key = e.key.toLowerCase()
    const paste = (result: { workflow: Workflow; ids: string[] } | null) => {
      if (!result) return
      onChange(result.workflow)
      setSelection({ nodes: result.ids })
    }
    if (key === 'z' || key === 'y') onHistory(key === 'y' || e.shiftKey ? 'redo' : 'undo')
    else if (key === 'c' || key === 'x') {
      const snippet = snippetOf(workflow, pickedNodes)
      if (!snippet) return
      copySteps(snippet)
      if (key === 'x') {
        removeNodes(new Set(snippet.nodes.map((n) => n.id)))
        setSelection(null)
      }
    } else if (key === 'v') paste(pasteSteps(workflow))
    else if (key === 'd') {
      const snippet = snippetOf(workflow, pickedNodes)
      paste(snippet && pasteSnippet(workflow, snippet, 40))
    } else if (key === 'a') setSelection({ nodes: workflow.nodes.map((n) => n.id) })
    else return
    e.preventDefault()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcut.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onNodesChange = (changes: NodeChange<WorkflowCanvasNode | CycleCanvasNode | DataCanvasNode>[]) => {
    let next = workflow
    const removed = new Set<string>()
    const removedData = new Set<string>()
    let pickedData: string | null = selectedData?.id ?? null
    const measuredNow: Record<string, { width: number; height: number }> = {}
    const picked = new Set(pickedNodes)
    let pickedCycle: string | null = selectedCycle?.id ?? null
    let selectionChanged = false
    // Steps dragged together move by the snap of the first one, so they keep their spacing.
    const moving = changes.flatMap((c) => (c.type === 'position' && c.position && !c.id.startsWith(CYCLE_PREFIX) ? [c] : []))
    let shift = { x: 0, y: 0 }
    const lead = moving[0]
    if (lead?.position && !snapOff.current) {
      const movingIds = new Set(moving.map((c) => c.id))
      const rectOf = (id: string, x: number, y: number) => ({ x, y, ...(sizes[id] ?? { width: 208, height: 60 }) })
      const others = workflow.nodes.filter((n) => !movingIds.has(n.id)).map((n) => rectOf(n.id, n.x, n.y))
      const snapped = snapRect(rectOf(lead.id, lead.position.x, lead.position.y), others)
      shift = { x: snapped.x - lead.position.x, y: snapped.y - lead.position.y }
      setGuides(lead.dragging ? snapped.guides : [])
    }
    if (changes.some((c) => c.type === 'position' && !c.dragging)) setGuides([])
    for (const change of changes) {
      const cycleId = 'id' in change && change.id.startsWith(CYCLE_PREFIX) ? change.id.slice(CYCLE_PREFIX.length) : null
      const dataId = 'id' in change && change.id.startsWith(DATA_PREFIX) ? change.id.slice(DATA_PREFIX.length) : null
      if (dataId && change.type !== 'dimensions') {
        if (change.type === 'position' && change.position) {
          const at = { x: Math.round(change.position.x + shift.x), y: Math.round(change.position.y + shift.y) }
          next = { ...next, data: (next.data ?? []).map((d) => (d.id === dataId ? { ...d, ...at } : d)) }
        } else if (change.type === 'remove') removedData.add(dataId)
        else if (change.type === 'select') {
          selectionChanged = true
          pickedData = change.selected ? dataId : pickedData === dataId ? null : pickedData
        }
        continue
      }
      if (change.type === 'dimensions' && change.dimensions) {
        if (!cycleId) measuredNow[change.id] = change.dimensions
      } else if (change.type === 'position' && change.position) {
        const { x, y } = change.position
        if (cycleId) {
          // Dragging a frame moves every step inside it, inner cycles included.
          const box = boxes.get(cycleId)
          const inside = cycles.find((c) => c.id === cycleId)?.nodeIds ?? []
          if (!box) continue
          const snap = (d: number) => (snapOff.current ? Math.round(d) : Math.round(d / GRID) * GRID)
          const dx = snap(x - box.x)
          const dy = snap(y - box.y)
          next = {
            ...next,
            nodes: next.nodes.map((n) => (inside.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n))
          }
        } else {
          const at = { x: Math.round(x + shift.x), y: Math.round(y + shift.y) }
          next = { ...next, nodes: next.nodes.map((n) => (n.id === change.id ? { ...n, ...at } : n)) }
        }
      } else if (change.type === 'remove') {
        if (!cycleId) removed.add(change.id)
      } else if (change.type === 'select') {
        selectionChanged = true
        if (cycleId) pickedCycle = change.selected ? cycleId : pickedCycle === cycleId ? null : pickedCycle
        else if (change.selected) picked.add(change.id)
        else picked.delete(change.id)
      }
    }
    if (Object.keys(measuredNow).length > 0) setSizes((all) => ({ ...all, ...measuredNow }))
    if (selectionChanged) {
      setSelection(
        picked.size > 0 ? { nodes: [...picked] } : pickedData ? { data: pickedData } : pickedCycle ? { cycle: pickedCycle } : null
      )
    }
    if (removed.size > 0 || removedData.size > 0) {
      onChange(withoutData(withoutSteps(next, removed), removedData))
      setSelection(null)
    } else if (next !== workflow) onChange(next)
  }

  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = new Set(changes.flatMap((c) => (c.type === 'remove' ? [c.id] : [])))
    for (const change of changes) {
      if (change.type !== 'select' || !change.selected) continue
      setSelection(change.id.startsWith(LINK_PREFIX) ? { link: change.id.slice(LINK_PREFIX.length) } : { edge: change.id })
    }
    if (removed.size > 0) {
      onChange({
        ...workflow,
        edges: workflow.edges.filter((e) => !removed.has(e.id)),
        ...(workflow.dataLinks ? { dataLinks: workflow.dataLinks.filter((l) => !removed.has(`${LINK_PREFIX}${l.id}`)) } : {})
      })
      setSelection(null)
    }
  }

  const [pending, setPending] = useState<PendingConnection | null>(null)

  /** Every dragged edge ends here: on a step, or on empty canvas, it asks which outcome it is. */
  const onConnectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    const from = state.fromNode?.id
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!from || !rect || state.fromHandle?.type !== 'source') return
    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    if (!point) return
    // A drop on a card's body counts as a drop on the card, not just on its handle.
    const under = document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>('.react-flow__node')
    if (from.startsWith(DATA_PREFIX)) {
      // A data card dropped on a step gives that step access.
      const dataId = from.slice(DATA_PREFIX.length)
      const step = workflow.nodes.find((n) => n.id === under?.dataset.id)
      if (!step) return
      const existing = workflow.dataLinks?.find((l) => l.dataId === dataId && l.nodeId === step.id)
      if (existing) {
        setSelection({ link: existing.id })
        return
      }
      const link: WorkflowDataLink = { id: crypto.randomUUID(), dataId, nodeId: step.id }
      onChange({ ...workflow, dataLinks: [...(workflow.dataLinks ?? []), link] })
      setSelection({ link: link.id })
      return
    }
    const to = (state.isValid ? state.toNode?.id : null) ?? under?.dataset.id ?? null
    if (to === from) return
    setPending({ from, to, x: point.clientX - rect.left, y: point.clientY - rect.top })
  }

  const connect = (outcome: WorkflowOutcome, kind: WorkflowNodeKind | null) => {
    if (!pending) return
    const rect = canvasRef.current?.getBoundingClientRect()
    let next = workflow
    let to = pending.to
    if (!to && kind && rect) {
      const at = flow.screenToFlowPosition({ x: rect.left + pending.x, y: rect.top + pending.y })
      const node = newNode(kind, Math.round(at.x), Math.round(at.y - 28))
      next = { ...next, nodes: [...next.nodes, node] }
      to = node.id
    }
    if (!to) return
    const edge = { id: crypto.randomUUID(), from: pending.from, to, outcome }
    onChange({ ...next, edges: [...next.edges, edge] })
    setSelection(kind ? { nodes: [to] } : { edge: edge.id })
    setPending(null)
  }
  const pendingFrom = pending ? workflow.nodes.find((n) => n.id === pending.from) : undefined

  /** Where a new card goes: the middle of the view, moved down (data: up) until it covers no other card. */
  const freeSpot = (up = false) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const center = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }
    const cards = [
      ...workflow.nodes.map((n) => ({ x: n.x, y: n.y, size: sizes[n.id] })),
      ...(workflow.data ?? []).map((d) => ({ x: d.x, y: d.y, size: sizes[`${DATA_PREFIX}${d.id}`] })),
      // Loop frames hold their arrows' lanes too.
      ...[...boxes.values()].map((b) => ({ x: b.x, y: b.y, size: { width: b.width, height: b.height } }))
    ]
    const covers = (x: number, y: number) =>
      cards.some((c) => x < c.x + (c.size?.width ?? 208) + GRID && x + 208 + GRID > c.x && y < c.y + (c.size?.height ?? 60) + GRID && y + 60 + GRID > c.y)
    const x = Math.round((center.x - 104) / GRID) * GRID
    let y = Math.round((center.y - 30) / GRID) * GRID
    for (let i = 0; i < 60 && covers(x, y); i++) y += up ? -GRID * 2 : GRID * 2
    return { x, y }
  }

  const addStep = (kind: WorkflowNodeKind, profile?: WorkflowAgentProfile) => {
    const at = freeSpot()
    const node = profile ? newAgentStep(profile, at.x, at.y) : newNode(kind, at.x, at.y)
    onChange({ ...workflow, nodes: [...workflow.nodes, node] })
    setSelection({ nodes: [node.id] })
  }

  const addData = () => {
    const at = freeSpot(true)
    const source = newDataSource(at.x, at.y)
    onChange({ ...workflow, data: [...(workflow.data ?? []), source] })
    setSelection({ data: source.id })
  }

  const patchData = (id: string, patch: Partial<WorkflowDataSource>) =>
    onChange({ ...workflow, data: (workflow.data ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)) })
  const patchLink = (id: string, patch: Partial<WorkflowDataLink>) =>
    onChange({ ...workflow, dataLinks: (workflow.dataLinks ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)) })

  const patchNode = (id: string, patch: Partial<Omit<WorkflowNode, 'config'>> & { config?: Partial<WorkflowNodeConfig> }) =>
    onChange({
      ...workflow,
      nodes: workflow.nodes.map((n) => (n.id === id ? { ...n, ...patch, config: { ...n.config, ...patch.config } } : n))
    })

  return (
    <div className="flex min-h-0 flex-1">
      <div ref={canvasRef} className="relative min-w-0 flex-1 [&_.react-flow\_\_node]:!cursor-default [&_.react-flow\_\_nodesselection-rect]:!cursor-default [&_.react-flow\_\_pane]:!cursor-default [&_.react-flow\_\_node.dragging]:!cursor-grabbing [&_.react-flow\_\_pane.dragging]:!cursor-grabbing" data-workflow-canvas>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          edgeTypes={WORKFLOW_EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnectEnd={onConnectEnd}
          onPaneClick={() => setSelection(null)}
          isValidConnection={(c) => c.source !== c.target}
          deleteKeyCode={['Delete', 'Backspace']}
          colorMode={dark ? 'dark' : 'light'}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={GRID} size={1} />
          <Controls showInteractive={false} />
          <SnapGuides guides={guides} />
          <LoopViewPanel cycles={cycles} />
          <Panel position="top-left">
            <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1 shadow-xs" data-workflow-palette>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7" title="Add: an agent does the work or reviews it" data-workflow-add-agent>
                    {(() => {
                      const Icon = STEP_ICONS.agent
                      return <Icon className={STEP_ACCENTS.agent} />
                    })()}
                    Agent
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {(['agent', 'review'] as const).map((kind) => {
                    const Icon = STEP_ICONS[kind]
                    return (
                      <DropdownMenuItem key={kind} onSelect={() => addStep(kind)} data-workflow-add-kind={kind}>
                        <Icon className={STEP_ACCENTS[kind]} />
                        <span className="flex-1">{kind === 'agent' ? 'Developer' : 'Reviewer'}</span>
                        <span className="text-[11px] text-muted-foreground">{kind === 'agent' ? 'does the work' : 'approves or sends back'}</span>
                      </DropdownMenuItem>
                    )
                  })}
                  {agents.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">Your agents</DropdownMenuLabel>
                      {agents.map((a) => (
                        <DropdownMenuItem key={a.id} onSelect={() => addStep(a.kind, a)} data-workflow-add-profile={a.name}>
                          <TuiAgentIcon agent={a.agent ?? 'claude'} size={14} />
                          <span className="min-w-0 flex-1 truncate">{a.name}</span>
                          {a.local && <HardDrive className="size-3 text-muted-foreground" aria-label="Local model" />}
                          <span className="text-[11px] text-muted-foreground">{a.kind === 'review' ? 'reviews' : 'works'}</span>
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setAgentDialog({ profile: blankAgentProfile('agent'), isNew: true, place: true })}
                    data-workflow-new-agent
                  >
                    <Plus className="size-3.5" />
                    New agent…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {NODE_KINDS.filter((k) => k.kind !== 'agent' && k.kind !== 'review').map((k) => {
                const Icon = STEP_ICONS[k.kind]
                return (
                  <Button key={k.kind} variant="ghost" size="sm" className="h-7" title={`Add: ${k.hint}`} onClick={() => addStep(k.kind)}>
                    <Icon className={STEP_ACCENTS[k.kind]} />
                    {k.label}
                  </Button>
                )
              })}
              <Button variant="ghost" size="sm" className="h-7" title="Add: a file or folder steps may be given" onClick={addData} data-workflow-add-data>
                <Database className="text-muted-foreground" />
                Data
              </Button>
            </div>
          </Panel>
        </ReactFlow>
        {pending && pendingFrom && (
          <WorkflowConnectMenu
            pending={pending}
            fromLabel={pendingFrom.label}
            outcomes={workflowOutcomes(pendingFrom)}
            used={new Set(workflow.edges.filter((e) => e.from === pendingFrom.id).map((e) => e.outcome))}
            suggested={nextOutcome(pendingFrom, workflow)}
            onPick={connect}
            onClose={() => setPending(null)}
          />
        )}
      </div>
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-border p-4">
        <WorkflowInspector
          hostId={hostId}
          workflow={workflow}
          agents={agents}
          node={selectedNode}
          edge={selectedEdge}
          data={selectedData}
          link={selectedLink}
          onData={patchData}
          onLink={patchLink}
          onAgentDialog={(profile, forNode) =>
            setAgentDialog(
              profile
                ? { profile, isNew: false }
                : {
                    profile: blankAgentProfile(workflow.nodes.find((n) => n.id === forNode)?.kind === 'review' ? 'review' : 'agent'),
                    isNew: true,
                    ...(forNode ? { forNode } : {})
                  }
            )
          }
          cycle={
            selectedCycle ??
            (selectedEdge && cycles.find((c) => c.backEdgeIds.includes(selectedEdge.id))) ??
            (selectedNode && cycles.find((c) => c.id === selectedNode.id)) ??
            null
          }
          multi={pickedNodes.length}
          onCycle={(id, patch) => {
            const settings = workflow.cycleSettings ?? []
            const own = settings.find((c) => c.entryId === id) ?? { entryId: id }
            onChange({ ...workflow, cycleSettings: [...settings.filter((c) => c !== own), { ...own, ...patch }] })
          }}
          issues={issues}
          onWorkflow={(patch) => onChange({ ...workflow, ...patch })}
          onNode={patchNode}
          onEdge={(id, patch) => onChange({ ...workflow, edges: workflow.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) })}
          onDelete={() => {
            if (selectedNode) removeNodes(new Set([selectedNode.id]))
            else if (selectedEdge) onChange({ ...workflow, edges: workflow.edges.filter((e) => e.id !== selectedEdge.id) })
            else if (selectedData) onChange(withoutData(workflow, new Set([selectedData.id])))
            else if (selectedLink) onChange({ ...workflow, dataLinks: (workflow.dataLinks ?? []).filter((l) => l.id !== selectedLink.id) })
            setSelection(null)
          }}
          onSelectIssue={(issue) => {
            if (issue.nodeId) setSelection({ nodes: [issue.nodeId] })
            else if (issue.edgeId) setSelection({ edge: issue.edgeId })
            else if (issue.dataId) setSelection({ data: issue.dataId })
          }}
        />
      </aside>
      {agentDialog && (
        <WorkflowAgentDialog
          hostId={hostId}
          initial={agentDialog.profile}
          isNew={agentDialog.isNew}
          usedBy={workflow.nodes.filter((n) => n.config.profileId === agentDialog.profile.id).length}
          onClose={() => setAgentDialog(null)}
          onSaved={(profile) => {
            if (agentDialog.place) addStep(profile.kind, profile)
            else if (agentDialog.forNode) patchNode(agentDialog.forNode, { config: { profileId: profile.id } })
            setAgentDialog(null)
          }}
        />
      )}
    </div>
  )
}
