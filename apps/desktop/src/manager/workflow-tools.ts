import { WORKFLOW_PERMISSION_MODES, type Workflow, type WorkflowEdge, type WorkflowNode, type WorkflowNodeKind } from '@acp-harness/protocol'

// The pieces behind the agent's save_workflow and copy_workflow tools and the Workflows page's
// "Copy from another project": a workflow built from the plain graph an agent writes, laid out on the
// canvas for it, and a copy of another project's workflow as a new one of this project.

const KINDS: WorkflowNodeKind[] = ['start', 'agent', 'review', 'check', 'human', 'end', 'custom']
const LABELS: Record<WorkflowNodeKind, string> = {
  start: 'Start',
  agent: 'Agent',
  review: 'Review',
  check: 'Check',
  human: 'Ask the person',
  end: 'End',
  custom: 'Step'
}
const COLUMN = 260
const ROW = 150

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Columns by distance from Start along the edges; what Start never reaches goes after them. */
export function layoutNodes(nodes: Pick<WorkflowNode, 'id' | 'kind'>[], edges: Pick<WorkflowEdge, 'from' | 'to'>[]): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>()
  const start = nodes.find((n) => n.kind === 'start') ?? nodes[0]
  if (start) depth.set(start.id, 0)
  const queue = start ? [start.id] : []
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const edge of edges.filter((e) => e.from === id)) {
      if (depth.has(edge.to)) continue
      depth.set(edge.to, depth.get(id)! + 1)
      queue.push(edge.to)
    }
  }
  const last = Math.max(0, ...depth.values())
  const rows = new Map<number, number>()
  const positions = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const column = depth.get(node.id) ?? last + 1
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    positions.set(node.id, { x: column * COLUMN, y: 120 + row * ROW })
  }
  return positions
}

/**
 * A workflow of `projectId` from an agent's { name, description?, nodes, edges }; with `base`, it
 * replaces that workflow, keeping its id and the data sources still linked to a step. Throws on a
 * graph that is not one (the person-facing checks are validateWorkflow's).
 */
export function workflowFromSpec(spec: Record<string, unknown>, projectId: string, base?: Workflow): Workflow {
  const name = typeof spec.name === 'string' ? spec.name.trim() : ''
  if (!name) throw new Error('Give the workflow a name.')
  if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) throw new Error('Give nodes and edges as arrays.')
  const seen = new Set<string>()
  const nodes = spec.nodes.map((raw, index): Omit<WorkflowNode, 'x' | 'y'> => {
    if (!isRecord(raw)) throw new Error(`Node ${index + 1} is not an object.`)
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `step-${index + 1}`
    if (seen.has(id)) throw new Error(`Two nodes have the id "${id}".`)
    seen.add(id)
    const kind = raw.kind
    if (typeof kind !== 'string' || !KINDS.includes(kind as WorkflowNodeKind)) {
      throw new Error(`Node "${id}" has kind ${JSON.stringify(kind)}; use one of ${KINDS.join(', ')}.`)
    }
    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : LABELS[kind as WorkflowNodeKind]
    const config = isRecord(raw.config) ? (raw.config as WorkflowNode['config']) : {}
    return { id, kind: kind as WorkflowNodeKind, label, config }
  })
  const edges = spec.edges.map((raw, index): WorkflowEdge => {
    if (!isRecord(raw)) throw new Error(`Edge ${index + 1} is not an object.`)
    const { from, to, outcome } = raw
    if (typeof from !== 'string' || !seen.has(from)) throw new Error(`Edge ${index + 1} starts at an unknown node ${JSON.stringify(from)}.`)
    if (typeof to !== 'string' || !seen.has(to)) throw new Error(`Edge ${index + 1} ends at an unknown node ${JSON.stringify(to)}.`)
    if (typeof outcome !== 'string' || !outcome.trim()) throw new Error(`Edge ${index + 1} has no outcome.`)
    return { id: `${from}->${to}:${outcome}`, from, to, outcome }
  })
  const positions = layoutNodes(nodes, edges)
  const permissionMode = WORKFLOW_PERMISSION_MODES.find((m) => m === spec.permissionMode) ?? base?.permissionMode
  const kept = new Set(nodes.map((n) => n.id))
  const links = base?.dataLinks?.filter((l) => kept.has(l.nodeId))
  return {
    ...(base ? { data: base.data, dataLinks: links } : {}),
    id: base?.id ?? crypto.randomUUID(),
    projectId,
    name,
    ...(typeof spec.description === 'string' && spec.description.trim() ? { description: spec.description.trim() } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    nodes: nodes.map((n) => ({ ...n, ...positions.get(n.id)! })),
    edges,
    updatedAt: Date.now()
  }
}

/** `source` (from any project) as a new workflow of `projectId`, named so it does not clash with `taken`. */
export function copyOfWorkflow(source: Workflow, projectId: string, taken: string[], name?: string): Workflow {
  const wanted = name?.trim() || source.name
  const names = new Set(taken)
  let next = wanted
  for (let n = 2; names.has(next); n++) next = `${wanted} (${n})`
  return { ...structuredClone(source), id: crypto.randomUUID(), projectId, name: next, updatedAt: Date.now() }
}
