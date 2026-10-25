// Comparing flows: the same task run through several workflows, several times each, each run in a
// worktree of its own, so their scorecards can be set side by side.

export interface WorkflowExperimentRun {
  workflowId: string
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
  workflowIds: string[]
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

export const WORKFLOW_EXPERIMENT_METHODS = {
  workflowExperimentStart: '_harness/workflowExperiments/start',
  workflowExperimentsList: '_harness/workflowExperiments/list',
  workflowExperimentStop: '_harness/workflowExperiments/stop'
} as const

export const WORKFLOW_EXPERIMENT_NOTIFICATIONS = {
  workflowExperimentChanged: '_harness/workflowExperiments/changed'
} as const

export interface WorkflowExperimentRequests {
  [WORKFLOW_EXPERIMENT_METHODS.workflowExperimentStart]: {
    params: { projectId: string; task: string; workflowIds: string[]; trials: number; parallel: number; autoApprove: boolean }
    result: WorkflowExperiment
  }
  [WORKFLOW_EXPERIMENT_METHODS.workflowExperimentsList]: { params: { projectId: string }; result: WorkflowExperiment[] }
  /** Stops its running runs and starts no more. */
  [WORKFLOW_EXPERIMENT_METHODS.workflowExperimentStop]: { params: { id: string }; result: WorkflowExperiment }
}
