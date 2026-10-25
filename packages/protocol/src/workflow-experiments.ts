// Comparing flows: the same task run through several arms, several times each, each run in a
// worktree of its own, so their scorecards can be set side by side. An arm is a saved workflow, or a
// saved workflow whose agent steps go without skills, to see what the skills in every turn are worth.

import type { Workflow } from './workflows'

/** What an arm's steps go without: their skills (one alone is a few hundred tokens, too little to measure). */
export type WorkflowContextRemoval = 'skills'

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

/** The workflow with every agent step shown no skills. */
export function withoutSkills(workflow: Workflow): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.kind === 'start' || node.kind === 'end' || node.kind === 'human' || node.kind === 'check'
        ? node
        : { ...node, config: { ...node.config, tools: { ...node.config.tools, skills: [] } } }
    )
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
