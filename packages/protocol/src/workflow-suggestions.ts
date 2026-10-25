// Changes to a workflow proposed from its past runs, for the person to apply or not. Kept to a small
// menu (a step's instructions, its round limit, whether an arrow continues the chat, what sits in a
// step's context), so a change is easy to read and to compare against the original.

import type { Workflow } from './workflows'

export type WorkflowChange =
  | { type: 'prompt'; nodeId: string; prompt: string }
  | { type: 'maxRounds'; nodeId: string; maxRounds: number | null }
  | { type: 'continue'; edgeId: string; on: boolean }
  /** The skills the step sees (one taken away from what it had). */
  | { type: 'skills'; nodeId: string; skills: string[]; removed: string }
  /** An MCP server whose tools the step may not use (so they leave its context). */
  | { type: 'denyMcp'; nodeId: string; server: string }

export interface WorkflowSuggestion {
  id: string
  title: string
  /** Why, in terms of what the runs showed. */
  reason: string
  change: WorkflowChange
}

export interface WorkflowSuggestions {
  /** What the runs say about the flow as a whole. */
  assessment: string
  suggestions: WorkflowSuggestion[]
  /** The runs it read. */
  runIds: string[]
}

/** The workflow with the change made; unchanged when what it names is gone. */
export function applyWorkflowChange(workflow: Workflow, change: WorkflowChange): Workflow {
  switch (change.type) {
    case 'prompt':
      return {
        ...workflow,
        nodes: workflow.nodes.map((n) => (n.id === change.nodeId ? { ...n, config: { ...n.config, prompt: change.prompt } } : n))
      }
    case 'maxRounds':
      return {
        ...workflow,
        nodes: workflow.nodes.map((n) => {
          if (n.id !== change.nodeId) return n
          const { maxRounds: _, ...config } = n.config
          return { ...n, config: change.maxRounds ? { ...config, maxRounds: change.maxRounds } : config }
        })
      }
    case 'skills':
      return {
        ...workflow,
        nodes: workflow.nodes.map((n) =>
          n.id === change.nodeId ? { ...n, config: { ...n.config, tools: { ...n.config.tools, skills: change.skills } } } : n
        )
      }
    case 'denyMcp':
      return {
        ...workflow,
        nodes: workflow.nodes.map((n) => {
          if (n.id !== change.nodeId) return n
          const deny = n.config.tools?.deny ?? []
          const rule = `mcp__${change.server}`
          return deny.includes(rule) ? n : { ...n, config: { ...n.config, tools: { ...n.config.tools, deny: [...deny, rule] } } }
        })
      }
    case 'continue':
      return {
        ...workflow,
        edges: workflow.edges.map((e) => {
          if (e.id !== change.edgeId) return e
          const { session: _, ...edge } = e
          return change.on ? { ...edge, session: 'continue' as const } : edge
        })
      }
  }
}

export const WORKFLOW_SUGGESTION_METHODS = {
  workflowSuggest: '_harness/workflows/suggest'
} as const

export interface WorkflowSuggestionRequests {
  /** Reads the workflow's last finished runs and proposes changes; slow (one Claude turn). */
  [WORKFLOW_SUGGESTION_METHODS.workflowSuggest]: { params: { projectId: string; workflowId: string }; result: WorkflowSuggestions }
}
