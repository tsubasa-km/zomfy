import type { Workflow, WorkflowCycleSettings, WorkflowEdge, WorkflowNode } from '@acp-harness/protocol'

// Copying steps: the steps, the edges between them, and the names and limits of loops they start.
// Kept per window, so steps copied from one workflow paste into another.

export interface StepsSnippet {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  cycleSettings: WorkflowCycleSettings[]
}

let clipboard: StepsSnippet | null = null
let pastes = 0

/** The selected steps as a snippet; Start stays behind, as a workflow has one. Null when nothing is left. */
export function snippetOf(workflow: Workflow, ids: string[]): StepsSnippet | null {
  const nodes = workflow.nodes.filter((n) => ids.includes(n.id) && n.kind !== 'start')
  if (nodes.length === 0) return null
  const kept = new Set(nodes.map((n) => n.id))
  return {
    nodes,
    edges: workflow.edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
    cycleSettings: (workflow.cycleSettings ?? []).filter((c) => kept.has(c.entryId))
  }
}

/** The snippet added as new steps, moved by `offset`; returns the workflow and the new steps' ids. */
export function pasteSnippet(workflow: Workflow, snippet: StepsSnippet, offset: number): { workflow: Workflow; ids: string[] } {
  const ids = new Map(snippet.nodes.map((n) => [n.id, crypto.randomUUID()]))
  const nodes = snippet.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, x: n.x + offset, y: n.y + offset }))
  const edges = snippet.edges.map((e) => ({ ...e, id: crypto.randomUUID(), from: ids.get(e.from)!, to: ids.get(e.to)! }))
  const cycleSettings = snippet.cycleSettings.map((c) => ({ ...c, entryId: ids.get(c.entryId)! }))
  return {
    workflow: {
      ...workflow,
      nodes: [...workflow.nodes, ...nodes],
      edges: [...workflow.edges, ...edges],
      ...(cycleSettings.length > 0 ? { cycleSettings: [...(workflow.cycleSettings ?? []), ...cycleSettings] } : {})
    },
    ids: nodes.map((n) => n.id)
  }
}

export function copySteps(snippet: StepsSnippet): void {
  clipboard = snippet
  pastes = 0
}

/** The copied steps, each paste a little further down and right than the last. */
export function pasteSteps(workflow: Workflow): { workflow: Workflow; ids: string[] } | null {
  if (!clipboard) return null
  pastes++
  return pasteSnippet(workflow, clipboard, 40 * pastes)
}
