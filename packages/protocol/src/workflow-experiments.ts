// Comparing flows: the same task run through several arms, several times each, each run in a
// worktree of its own, so their scorecards can be set side by side. An arm is a saved workflow, or a
// saved workflow with one context item taken away (a skill, an MCP server), to see what it is worth.

import type { Workflow } from './workflows'

/** A skill or MCP server a run's steps go without. */
export interface WorkflowContextRemoval {
  kind: 'skill' | 'mcp'
  /** ALL_SKILLS takes every skill away. */
  name: string
  /**
   * Skills: each step's skills when it last ran with it, by node id. A step can only be shown a list
   * of skills, so it is shown these minus the one taken away.
   */
  keep?: Record<string, string[]>
}

export interface WorkflowExperimentArm {
  id: string
  workflowId: string
  label: string
  without?: WorkflowContextRemoval
}

export interface WorkflowExperimentRun {
  armId: string
  /** 1-based. */
  trial: number
  /** Null until it starts. */
  runId: string | null
  /** Why it could not start. */
  error?: string
}

export interface WorkflowExperiment {
  id: string
  projectId: string
  task: string
  arms: WorkflowExperimentArm[]
  trials: number
  /** Runs at once. */
  parallel: number
  /** Its runs' steps run commands and edits without asking; each run has a worktree of its own. */
  autoApprove: boolean
  runs: WorkflowExperimentRun[]
  status: 'running' | 'done' | 'stopped'
  createdAt: number
  endedAt: number | null
}

export const ALL_SKILLS = '*'

/**
 * The workflow with the item taken from every agent step: an MCP server's tools denied, or a skill
 * left off the step's list of skills. A step with no list, and none recorded, keeps its skills.
 */
export function withoutContextItem(workflow: Workflow, without: WorkflowContextRemoval): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      const tools = node.config.tools ?? {}
      if (without.kind === 'mcp') {
        if (node.kind === 'start' || node.kind === 'end' || node.kind === 'human' || node.kind === 'check') return node
        return { ...node, config: { ...node.config, tools: { ...tools, deny: [...(tools.deny ?? []), `mcp__${without.name}`] } } }
      }
      if (without.name === ALL_SKILLS) {
        if (node.kind === 'start' || node.kind === 'end' || node.kind === 'human' || node.kind === 'check') return node
        return { ...node, config: { ...node.config, tools: { ...tools, skills: [] } } }
      }
      const skills = tools.skills ?? without.keep?.[node.id]
      if (!skills) return node
      return { ...node, config: { ...node.config, tools: { ...tools, skills: skills.filter((s) => s !== without.name) } } }
    })
  }
}

export const WORKFLOW_EXPERIMENT_METHODS = {
  workflowExperimentStart: '_harness/workflowExperiments/start',
  workflowExperimentsList: '_harness/workflowExperiments/list',
  workflowExperimentStop: '_harness/workflowExperiments/stop',
  workflowExperimentRemove: '_harness/workflowExperiments/remove'
} as const

export const WORKFLOW_EXPERIMENT_NOTIFICATIONS = {
  workflowExperimentChanged: '_harness/workflowExperiments/changed'
} as const

export interface WorkflowExperimentRequests {
  [WORKFLOW_EXPERIMENT_METHODS.workflowExperimentStart]: {
    params: {
      projectId: string
      task: string
      arms: { workflowId: string; label: string; without?: WorkflowContextRemoval }[]
      trials: number
      parallel: number
      autoApprove: boolean
    }
    result: WorkflowExperiment
  }
  [WORKFLOW_EXPERIMENT_METHODS.workflowExperimentsList]: { params: { projectId: string }; result: WorkflowExperiment[] }
  /** Stops its running runs and starts no more. */
  [WORKFLOW_EXPERIMENT_METHODS.workflowExperimentStop]: { params: { id: string }; result: WorkflowExperiment }
  /** Deletes it (stopping it first), and with `worktrees` the worktrees and branches its runs made; returns the project's comparisons left. */
  [WORKFLOW_EXPERIMENT_METHODS.workflowExperimentRemove]: { params: { id: string; worktrees: boolean }; result: WorkflowExperiment[] }
}
