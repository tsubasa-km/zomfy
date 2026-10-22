import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronDown, Plus, Save, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  HARNESS_METHODS,
  type Workflow,
  type WorkflowNode,
  type WorkflowNodeConfig,
  type WorkflowNodeKind,
  type WorkflowOutcome
} from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
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
import { WORKFLOW_NODE_TYPES, type WorkflowCanvasNode } from './workflow-nodes'
import { WorkflowInspector } from './WorkflowInspector'
import {
  NODE_KINDS,
  OUTCOME_LABELS,
  blankWorkflow,
  newNode,
  nextOutcome,
  reviewLoopTemplate,
  validateWorkflow,
  type WorkflowIssue
} from './workflow-model'

// A project's agent workflows, drawn as a graph (React Flow): steps are cards, edges carry the
// outcome that takes a run along them. The harness walks this graph; the editor only shapes it.

const OUTCOME_COLORS: Record<WorkflowOutcome, string> = {
  next: 'var(--muted-foreground)',
  pass: 'var(--muted-foreground)',
  answered: 'var(--muted-foreground)',
  approve: 'var(--status-success)',
  changes: 'var(--status-warning)',
  fail: 'var(--destructive)',
  ask: 'var(--agent-question)'
}

function subscribeDark(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const useDark = () => useSyncExternalStore(subscribeDark, () => document.documentElement.classList.contains('dark'))

export function WorkflowsPage({ target }: { target: WorkflowsPageTarget }) {
  const [saved, setSaved] = useState<Workflow[] | null>(null)
  const [draft, setDraft] = useState<Workflow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setSaved(null)
    setDraft(null)
    harnessRequest(HARNESS_METHODS.workflowsList, { projectId: target.projectId }, target.hostId)
      .then((list) => {
        if (!live) return
        setSaved(list)
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
    setDraft(workflow)
    setDirty(false)
  }

  const startNew = (make: (projectId: string) => Workflow) => {
    if (!confirmDiscard()) return
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
    setDraft(list[0] ?? blankWorkflow(target.projectId))
    setDirty(list.length === 0)
  }

  const issues = useMemo(() => (draft ? validateWorkflow(draft) : []), [draft])
  const errors = issues.filter((i) => i.level === 'error').length

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
            <DropdownMenuItem onSelect={() => startNew(reviewLoopTemplate)}>
              <Plus className="size-3.5" />
              New from “Develop and review”
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startNew(blankWorkflow)}>
              <Plus className="size-3.5" />
              New blank workflow
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-2">
          {draft && (
            <span className={cn('text-xs', errors > 0 ? 'text-destructive' : 'text-status-success')} data-workflow-status>
              {errors > 0 ? `${errors} problem${errors > 1 ? 's' : ''}` : 'Ready to run'}
            </span>
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
      {draft ? (
        <ReactFlowProvider key={draft.id}>
          <WorkflowCanvas
            workflow={draft}
            issues={issues}
            onChange={(next) => {
              setDraft(next)
              setDirty(true)
            }}
          />
        </ReactFlowProvider>
      ) : (
        <div className="m-auto text-sm text-muted-foreground">Loading workflows…</div>
      )}
    </div>
  )
}

type Selection = { node: string } | { edge: string } | null

function WorkflowCanvas({
  workflow,
  issues,
  onChange
}: {
  workflow: Workflow
  issues: WorkflowIssue[]
  onChange: (workflow: Workflow) => void
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
  const selectedNode = selection && 'node' in selection ? (workflow.nodes.find((n) => n.id === selection.node) ?? null) : null
  const selectedEdge = selection && 'edge' in selection ? (workflow.edges.find((e) => e.id === selection.edge) ?? null) : null

  const issueOf = (nodeId: string): 'error' | 'warning' | null => {
    const mine = issues.filter((i) => i.nodeId === nodeId)
    return mine.some((i) => i.level === 'error') ? 'error' : mine.length > 0 ? 'warning' : null
  }

  const nodes: WorkflowCanvasNode[] = workflow.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: node.x, y: node.y },
    data: { node, issue: issueOf(node.id) },
    selected: selectedNode?.id === node.id,
    deletable: node.kind !== 'start',
    ...(sizes[node.id] ? { measured: sizes[node.id] } : {})
  }))

  const byId = new Map(workflow.nodes.map((n) => [n.id, n]))
  const edges: Edge[] = workflow.edges.map((edge) => {
    const color = OUTCOME_COLORS[edge.outcome]
    const selected = selectedEdge?.id === edge.id
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    // Back to an earlier step: under the row, lower the further back it goes, so loops stay readable.
    const back = !!from && !!to && to.x < from.x - 40
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle: back ? 'back-out' : 'out',
      targetHandle: back ? 'back-in' : 'in',
      type: 'smoothstep',
      pathOptions: back && from && to ? { offset: 24 + Math.round((from.x - to.x) / 12), borderRadius: 8 } : { borderRadius: 8 },
      label: OUTCOME_LABELS[edge.outcome],
      selected,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: selected ? 2.5 : 1.5 },
      labelStyle: { fontSize: 11, fill: color, fontWeight: 500 },
      labelBgStyle: { fill: 'var(--background)' },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 4
    }
  })

  const removeNodes = (ids: Set<string>) => {
    const kept = workflow.nodes.filter((n) => !ids.has(n.id) || n.kind === 'start')
    const keptIds = new Set(kept.map((n) => n.id))
    onChange({ ...workflow, nodes: kept, edges: workflow.edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to)) })
  }

  const onNodesChange = (changes: NodeChange<WorkflowCanvasNode>[]) => {
    let next = workflow
    const removed = new Set<string>()
    const measuredNow: Record<string, { width: number; height: number }> = {}
    for (const change of changes) {
      if (change.type === 'dimensions' && change.dimensions) {
        measuredNow[change.id] = change.dimensions
      } else if (change.type === 'position' && change.position) {
        const { x, y } = change.position
        next = { ...next, nodes: next.nodes.map((n) => (n.id === change.id ? { ...n, x: Math.round(x), y: Math.round(y) } : n)) }
      } else if (change.type === 'remove') {
        removed.add(change.id)
      } else if (change.type === 'select' && change.selected) {
        setSelection({ node: change.id })
      }
    }
    if (Object.keys(measuredNow).length > 0) setSizes((all) => ({ ...all, ...measuredNow }))
    if (removed.size > 0) {
      removeNodes(removed)
      setSelection(null)
    } else if (next !== workflow) onChange(next)
  }

  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = new Set(changes.flatMap((c) => (c.type === 'remove' ? [c.id] : [])))
    for (const change of changes) if (change.type === 'select' && change.selected) setSelection({ edge: change.id })
    if (removed.size > 0) {
      onChange({ ...workflow, edges: workflow.edges.filter((e) => !removed.has(e.id)) })
      setSelection(null)
    }
  }

  const onConnect = (connection: Connection) => {
    const from = workflow.nodes.find((n) => n.id === connection.source)
    if (!from || connection.source === connection.target) return
    const edge = { id: crypto.randomUUID(), from: from.id, to: connection.target, outcome: nextOutcome(from, workflow) }
    onChange({ ...workflow, edges: [...workflow.edges, edge] })
    setSelection({ edge: edge.id })
  }

  const addStep = (kind: WorkflowNodeKind) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const center = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }
    // Offset by the step count so steps added in a row do not stack exactly.
    const node = newNode(kind, Math.round(center.x - 104 + workflow.nodes.length * 12), Math.round(center.y - 30))
    onChange({ ...workflow, nodes: [...workflow.nodes, node] })
    setSelection({ node: node.id })
  }

  const patchNode = (id: string, patch: Partial<Omit<WorkflowNode, 'config'>> & { config?: Partial<WorkflowNodeConfig> }) =>
    onChange({
      ...workflow,
      nodes: workflow.nodes.map((n) => (n.id === id ? { ...n, ...patch, config: { ...n.config, ...patch.config } } : n))
    })

  return (
    <div className="flex min-h-0 flex-1">
      <div ref={canvasRef} className="relative min-w-0 flex-1" data-workflow-canvas>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={WORKFLOW_NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={() => setSelection(null)}
          isValidConnection={(c) => c.source !== c.target}
          deleteKeyCode={['Delete', 'Backspace']}
          colorMode={dark ? 'dark' : 'light'}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <Panel position="top-left">
            <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1 shadow-xs" data-workflow-palette>
              {NODE_KINDS.map((k) => (
                <Button key={k.kind} variant="ghost" size="sm" className="h-7" title={k.hint} onClick={() => addStep(k.kind)}>
                  <Plus className="size-3.5" />
                  {k.label}
                </Button>
              ))}
            </div>
          </Panel>
        </ReactFlow>
      </div>
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-border p-4">
        <WorkflowInspector
          workflow={workflow}
          node={selectedNode}
          edge={selectedEdge}
          issues={issues}
          onWorkflow={(patch) => onChange({ ...workflow, ...patch })}
          onNode={patchNode}
          onEdge={(id, outcome) => onChange({ ...workflow, edges: workflow.edges.map((e) => (e.id === id ? { ...e, outcome } : e)) })}
          onDelete={() => {
            if (selectedNode) removeNodes(new Set([selectedNode.id]))
            else if (selectedEdge) onChange({ ...workflow, edges: workflow.edges.filter((e) => e.id !== selectedEdge.id) })
            setSelection(null)
          }}
          onSelectIssue={(issue) => {
            if (issue.nodeId) setSelection({ node: issue.nodeId })
            else if (issue.edgeId) setSelection({ edge: issue.edgeId })
          }}
        />
      </aside>
    </div>
  )
}
