// A project's agent workflows: a graph the harness walks step by step (not a prompt the agents
// may follow). Each step ends in an outcome, and the edge labelled with that outcome picks the next
// step, so loops such as develop → review → back to develop are the graph's, not a model's choice.
// Saved per project on the host whose daemon owns the project.

export type WorkflowNodeKind = 'start' | 'agent' | 'review' | 'check' | 'human' | 'end'

/** How a step ended; an edge takes the run on when its outcome matches. */
export type WorkflowOutcome = 'next' | 'approve' | 'changes' | 'pass' | 'fail' | 'answered' | 'ask'

export interface WorkflowNodeConfig {
  /** Agent and review steps: the role the session plays ("Developer", "Reviewer"…). */
  role?: string
  /** Agent and review steps: what the session is told, on top of the run's task and handoff. */
  prompt?: string
  /** Agent steps: keep one session across loops (it remembers earlier rounds), or start fresh each time. */
  session?: 'keep' | 'fresh'
  /** Where the step runs: the project's main workspace, or a new worktree made for the run. */
  workspace?: 'main' | 'run-worktree'
  /** Review steps: rounds of "changes", check steps: failures, before the run stops and asks the person. */
  maxRounds?: number
  /** Check steps: a shell command whose exit code is the outcome (0 = pass). */
  command?: string
  /** Human steps: what the person is asked. */
  question?: string
  /** End steps: whether reaching it counts as done or failed. */
  result?: 'done' | 'failed'
}

export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  label: string
  /** Canvas position. */
  x: number
  y: number
  config: WorkflowNodeConfig
}

export interface WorkflowEdge {
  id: string
  from: string
  to: string
  outcome: WorkflowOutcome
}

export interface Workflow {
  id: string
  /** The host project it belongs to (the main one when the project spans hosts). */
  projectId: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  updatedAt: number
}

/** The outcomes each kind of step can end in, in the order the editor offers them. */
export const WORKFLOW_OUTCOMES: Record<WorkflowNodeKind, WorkflowOutcome[]> = {
  start: ['next'],
  agent: ['next', 'ask'],
  review: ['approve', 'changes', 'ask'],
  check: ['pass', 'fail'],
  human: ['answered'],
  end: []
}

export const WORKFLOW_METHODS = {
  workflowsList: '_harness/workflows/list',
  workflowSave: '_harness/workflows/save',
  workflowRemove: '_harness/workflows/remove'
} as const

export interface WorkflowRequests {
  [WORKFLOW_METHODS.workflowsList]: { params: { projectId: string }; result: Workflow[] }
  [WORKFLOW_METHODS.workflowSave]: { params: { workflow: Workflow }; result: Workflow[] }
  [WORKFLOW_METHODS.workflowRemove]: { params: { projectId: string; workflowId: string }; result: Workflow[] }
}
