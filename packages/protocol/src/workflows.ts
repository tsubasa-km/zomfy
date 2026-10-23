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

/** An MCP server a step's sessions get, on top of (or, with strict, instead of) the host's own. */
export interface WorkflowMcpServer {
  name: string
  /** A ready-made server; command and args are then ignored. */
  preset?: 'playwright'
  command?: string
  args?: string[]
}

/** What a step's sessions may use; the harness passes it to each session, so it is enforced, not asked. */
export interface WorkflowToolPolicy {
  mcp?: WorkflowMcpServer[]
  /** Only these MCP servers, none from the host's Claude settings. */
  strictMcp?: boolean
  /** Skills the session can see and call; absent means the host's usual set. */
  skills?: string[]
  /** No file edits (Edit, Write, NotebookEdit). */
  readOnly?: boolean
  /** Tools that run without asking (e.g. mcp__playwright__browser_take_screenshot). */
  allow?: string[]
  /** Tools the session cannot use at all. */
  deny?: string[]
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
  /** Agent, review and custom agent steps. */
  tools?: WorkflowToolPolicy
  /** Human steps: the project's Lead answers first and passes on only what is the person's call. */
  askLeadFirst?: boolean
  /** Agent, review and custom agent steps: a new session, or the project's Lead chat itself (planning, final checks). */
  runBy?: 'session' | 'lead'
}

/** The step's part in its cycle's Plan-Do-Check-Act; absent means the kind's usual one. */
export type WorkflowPhase = 'plan' | 'do' | 'check' | 'act'

/**
 * A cycle drawn around steps (a PDCA loop): cycles nest, so a dev ⇄ review cycle sits inside the
 * Lead's plan ⇄ check cycle. Coming back to a cycle's first step from inside it starts a new round.
 */
export interface WorkflowCycle {
  id: string
  label: string
  /** The cycle it sits in. */
  parentId?: string
  /** Rounds before the run stops and asks the person. */
  maxRounds?: number
}

export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  label: string
  /** Canvas position. */
  x: number
  y: number
  config: WorkflowNodeConfig
  /** The innermost cycle the step is in. */
  cycleId?: string
  phase?: WorkflowPhase
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
  /** Absent in workflows saved before cycles. */
  cycles?: WorkflowCycle[]
  updatedAt: number
}

/** The cycles a step sits in, innermost first. */
export function cyclesOf(workflow: Pick<Workflow, 'cycles'>, node: Pick<WorkflowNode, 'cycleId'>): WorkflowCycle[] {
  const byId = new Map((workflow.cycles ?? []).map((c) => [c.id, c]))
  const chain: WorkflowCycle[] = []
  for (let c = node.cycleId ? byId.get(node.cycleId) : undefined; c && !chain.includes(c); c = c.parentId ? byId.get(c.parentId) : undefined) {
    chain.push(c)
  }
  return chain
}

/** A cycle's first step: the one its loop comes back to, entered from outside the cycle. */
export function cycleEntry(workflow: Pick<Workflow, 'nodes' | 'edges' | 'cycles'>, cycleId: string): WorkflowNode | null {
  const inside = (id: string) => {
    const node = workflow.nodes.find((n) => n.id === id)
    return !!node && cyclesOf(workflow, node).some((c) => c.id === cycleId)
  }
  const entries = workflow.nodes.filter(
    (n) => inside(n.id) && workflow.edges.some((e) => e.to === n.id && !inside(e.from))
  )
  return entries.sort((a, b) => a.x - b.x)[0] ?? null
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

export type WorkflowRunStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

/** One visit of a step in a run. */
export interface WorkflowRunStep {
  id: string
  nodeId: string
  label: string
  startedAt: number
  endedAt: number | null
  /** null while it runs. */
  outcome: WorkflowOutcome | null
  /** What the step handed on (an agent's summary, a command's output tail, the person's answer). */
  summary: string
  /** The chat sessions that ran it, on the run's host. */
  sessionIds: string[]
  error?: string
}

export interface WorkflowRun {
  id: string
  workflowId: string
  projectId: string
  /** The graph as it was when the run started, so later edits do not change a running run. */
  workflow: Workflow
  task: string
  status: WorkflowRunStatus
  /** The step running or waiting now. */
  currentNodeId: string | null
  /** Where agent steps run unless they ask for the main workspace. */
  workspaceId: string
  /** Rounds taken back along each step's limited outcomes ("changes", "fail"), by node id. */
  rounds: Record<string, number>
  /** Sessions a step keeps across rounds, by node id. */
  sessionsByNode: Record<string, string[]>
  steps: WorkflowRunStep[]
  /** Set while the run waits for the person: what they are asked. */
  waiting?: { question: string; reason: 'human' | 'ask' | 'limit'; /** The round count a limit stop resets. */ limitKey?: string } | null
  createdAt: number
  endedAt: number | null
}

export const WORKFLOW_METHODS = {
  workflowsList: '_harness/workflows/list',
  workflowSave: '_harness/workflows/save',
  workflowRemove: '_harness/workflows/remove',
  workflowRunStart: '_harness/workflowRuns/start',
  workflowRunsList: '_harness/workflowRuns/list',
  workflowRunAnswer: '_harness/workflowRuns/answer',
  workflowRunStop: '_harness/workflowRuns/stop',
  workflowRunAskPerson: '_harness/workflowRuns/askPerson'
} as const

/** On a chat transcript's notice: the workflow run that chat started, drawn as a live card. */
export const WORKFLOW_META = {
  run: 'harness/workflowRun'
} as const

export const WORKFLOW_NOTIFICATIONS = {
  /** Every client of the run's host hears each change of a run. */
  workflowRunChanged: '_harness/workflowRuns/changed'
} as const

export interface WorkflowRequests {
  [WORKFLOW_METHODS.workflowsList]: { params: { projectId: string }; result: Workflow[] }
  [WORKFLOW_METHODS.workflowSave]: { params: { workflow: Workflow }; result: Workflow[] }
  [WORKFLOW_METHODS.workflowRemove]: { params: { projectId: string; workflowId: string }; result: Workflow[] }
  /** Starts the saved workflow on a task; agent steps run in a worktree made for the run (git projects). */
  /** `originSessionId`: the chat it was started from, which shows the run as a card. */
  [WORKFLOW_METHODS.workflowRunStart]: {
    params: { projectId: string; workflowId: string; task: string; originSessionId?: string }
    result: WorkflowRun
  }
  [WORKFLOW_METHODS.workflowRunsList]: { params: { projectId: string }; result: WorkflowRun[] }
  /** The person's answer to a waiting run; "stop" in a limit stop ends it instead. */
  [WORKFLOW_METHODS.workflowRunAnswer]: { params: { runId: string; text: string }; result: WorkflowRun }
  [WORKFLOW_METHODS.workflowRunStop]: { params: { runId: string }; result: WorkflowRun }
  /** A run's session puts a question to the person mid-step; resolves with their answer (null: the session is in no run). */
  [WORKFLOW_METHODS.workflowRunAskPerson]: { params: { sessionId: string; question: string }; result: { answer: string | null } }
}
