// A project's agent workflows: a graph the harness walks step by step (not a prompt the agents
// may follow). Each step ends in an outcome, and the edge labelled with that outcome picks the next
// step, so loops such as develop → review → back to develop are the graph's, not a model's choice.
// Saved per project on the host whose daemon owns the project.

export type WorkflowNodeKind = 'start' | 'agent' | 'review' | 'check' | 'human' | 'end' | 'custom'

export type BuiltinWorkflowOutcome = 'next' | 'approve' | 'changes' | 'pass' | 'fail' | 'answered' | 'ask'

/** How a step ended: a built-in outcome, or one a custom step names itself. */
export type WorkflowOutcome = string

/** A custom step's setting, filled in on the step and usable as {{key}} in its prompt or command. */
export interface WorkflowField {
  id: string
  /** The {{key}} it fills in. */
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  /** For 'select'. */
  options?: string[]
  value: string | number | boolean
}

/** Several sessions run the step at once, and their outcomes are combined into the step's one. */
export interface WorkflowParallel {
  count: number
  /**
   * all: every session must reach the outcome (all approve; all finish); majority: most of them;
   * any: one is enough; first: the first to finish decides and the others stop.
   */
  join: 'all' | 'majority' | 'any' | 'first'
}

export interface WorkflowNodeConfig {
  /** Agent, review and custom steps: the role the session plays ("Developer", "Reviewer"…). */
  role?: string
  /** Agent, review and custom steps: what the session is told, on top of the run's task and handoff. */
  prompt?: string
  /** Agent steps: keep one session across loops (it remembers earlier rounds), or start fresh each time. */
  session?: 'keep' | 'fresh'
  /** Where the step runs: the project's main workspace, or a new worktree made for the run. */
  workspace?: 'main' | 'run-worktree'
  /** Review steps: rounds of "changes", check steps: failures, before the run stops and asks the person. */
  maxRounds?: number
  /** Check (and command custom) steps: a shell command whose exit code is the outcome (0 = pass). */
  command?: string
  /** Human steps: what the person is asked. */
  question?: string
  /** End steps: whether reaching it counts as done or failed. */
  result?: 'done' | 'failed'
  /** Agent, review and custom steps; absent means one session. */
  parallel?: WorkflowParallel
  /** Custom steps: an agent session or a command does the work. */
  runner?: 'agent' | 'command'
  /** Custom steps: their own settings. */
  fields?: WorkflowField[]
  /** Custom steps: the outcomes the step can end in; an agent runner must pick one. */
  outcomes?: string[]
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

const BUILTIN_OUTCOMES: Record<Exclude<WorkflowNodeKind, 'custom'>, BuiltinWorkflowOutcome[]> = {
  start: ['next'],
  agent: ['next', 'ask'],
  review: ['approve', 'changes', 'ask'],
  check: ['pass', 'fail'],
  human: ['answered'],
  end: []
}

/** The outcomes a step can end in, in the order the editor offers them. */
export function workflowOutcomes(node: Pick<WorkflowNode, 'kind' | 'config'>): WorkflowOutcome[] {
  if (node.kind !== 'custom') return BUILTIN_OUTCOMES[node.kind]
  const own = (node.config.outcomes ?? []).filter((o) => o.trim())
  if (node.config.runner === 'command') return own.length > 0 ? own : ['pass', 'fail']
  return [...(own.length > 0 ? own : ['next']), 'ask']
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
