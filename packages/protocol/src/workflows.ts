// A project's agent workflows: a graph the harness walks step by step (not a prompt the agents
// may follow). Each step ends in an outcome, and the edge labelled with that outcome picks the next
// step, so loops such as develop → review → back to develop are the graph's, not a model's choice.
// Saved per project on the host whose daemon owns the project.

import type { ChatAgentId } from './chat-agents'
import type { WorkflowDataLink, WorkflowDataSource } from './workflow-access'
import type { WorkflowStepContext, WorkflowStepUsage } from './workflow-scorecard'
import type { WorkflowContextRemoval } from './workflow-experiments'

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
  /**
   * Review steps: rounds of "changes", check steps: failures, before the loop is handed up to the
   * loop around it (or the person) to rethink. Absent: no limit.
   */
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
  /** Agent, review and custom agent steps run by a session: which agent runs it; absent means Claude. */
  agent?: ChatAgentId
  /**
   * Agent, review and custom agent steps: the step's agent may split its work and run up to this many
   * helper agents at once (spawn_agents). Absent: it spawns none.
   */
  maxAgents?: number
  /** Agent and review steps: an agent defined on the host (WorkflowAgentProfile) runs it, with that agent's settings. */
  profileId?: string
  /** Its agent's model runs on the person's own machines; filled in from the agent when a run starts. */
  local?: boolean
  /** The model its sessions run; filled in from the agent when a run starts. */
  model?: string
}

/** The step's part in its cycle's Plan-Do-Check-Act; absent means the kind's usual one. */
export type WorkflowPhase = 'plan' | 'do' | 'check' | 'act'

/** What the person set for the cycle that comes back to `entryId` (its name, its round limit). */
export interface WorkflowCycleSettings {
  entryId: string
  label?: string
  maxRounds?: number
}

/**
 * A cycle (a PDCA loop), found from the graph rather than drawn: every edge back to an earlier step
 * makes one, holding the steps from where it comes back to where it leaves. Edges back to the same
 * step share one cycle, and cycles nest: dev ⇄ review inside the Lead's plan ⇄ check.
 */
export interface WorkflowCycle {
  /** The step it comes back to; also the cycle's id. */
  id: string
  label: string
  /** The cycle it sits in. */
  parentId?: string
  /** Rounds before the loop is handed up to the loop around it (or the person) to rethink; absent: no limit. */
  maxRounds?: number
  nodeIds: string[]
  /** The edges that come back to its first step. */
  backEdgeIds: string[]
}

export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  label: string
  /** Canvas position. */
  x: number
  y: number
  config: WorkflowNodeConfig
  phase?: WorkflowPhase
}

export interface WorkflowEdge {
  id: string
  from: string
  to: string
  outcome: WorkflowOutcome
  /**
   * continue: the next step goes on in the chat the step before it ran in (same agent, one session),
   * so nothing is lost to a summary. Absent: a session of its own, handed the summary.
   */
  session?: 'continue'
}

export interface Workflow {
  id: string
  /** The host project it belongs to (the main one when the project spans hosts). */
  projectId: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  /** Names and round limits for the cycles the graph makes. */
  cycleSettings?: WorkflowCycleSettings[]
  /** Start without asking even though a loop has no limit. */
  skipLoopConfirm?: boolean
  /** Files and folders its steps may be given; a step sees only those linked to it. */
  data?: WorkflowDataSource[]
  dataLinks?: WorkflowDataLink[]
  updatedAt: number
}

type CycleSource = Pick<Workflow, 'nodes' | 'edges' | 'cycleSettings'>

const derived = new WeakMap<object, WorkflowCycle[]>()

/** The workflow's cycles, outermost first. */
export function workflowCycles(workflow: CycleSource): WorkflowCycle[] {
  const known = derived.get(workflow)
  if (known) return known
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]))
  const edges = workflow.edges.filter((e) => byId.has(e.from) && byId.has(e.to))

  // An edge back to an earlier step: one to a step still being explored, walking from Start.
  const back: typeof edges = []
  const state = new Map<string, 'open' | 'done'>()
  const walk = (id: string) => {
    state.set(id, 'open')
    for (const e of edges.filter((x) => x.from === id)) {
      if (state.get(e.to) === 'open') back.push(e)
      else if (!state.has(e.to)) walk(e.to)
    }
    state.set(id, 'done')
  }
  const roots = [...workflow.nodes.filter((n) => n.kind === 'start'), ...workflow.nodes.filter((n) => n.kind !== 'start')]
  for (const n of roots) if (!state.has(n.id)) walk(n.id)

  // A loop holds the step it comes back to and every step that reaches the leaving one without
  // passing it; loops back to the same step merge.
  const bodies = new Map<string, { nodes: Set<string>; edges: string[] }>()
  for (const e of back) {
    const body = bodies.get(e.to) ?? { nodes: new Set([e.to]), edges: [] }
    body.edges.push(e.id)
    const stack = [e.from]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (body.nodes.has(id)) continue
      body.nodes.add(id)
      for (const x of edges) if (x.to === id) stack.push(x.from)
    }
    bodies.set(e.to, body)
  }

  const cycles: WorkflowCycle[] = []
  for (const [entryId, body] of bodies) {
    // Asking someone and coming back with the answer is a detour, not a round.
    if (body.nodes.size > 1 && [...body.nodes].every((id) => id === entryId || byId.get(id)!.kind === 'human')) continue
    const settings = workflow.cycleSettings?.find((c) => c.entryId === entryId)
    const entry = byId.get(entryId)!
    const leaving = body.edges.map((id) => byId.get(edges.find((e) => e.id === id)!.from)!).sort((a, b) => b.x - a.x)[0]
    cycles.push({
      id: entryId,
      label: settings?.label?.trim() || (leaving && leaving.id !== entryId ? `${entry.label} ⇄ ${leaving.label}` : entry.label),
      ...(settings?.maxRounds ? { maxRounds: settings.maxRounds } : {}),
      nodeIds: workflow.nodes.filter((n) => body.nodes.has(n.id)).map((n) => n.id),
      backEdgeIds: body.edges
    })
  }
  // The parent is the smallest other cycle holding all of this one's steps.
  for (const cycle of cycles) {
    const holds = (o: WorkflowCycle) =>
      o !== cycle &&
      cycle.nodeIds.every((id) => o.nodeIds.includes(id)) &&
      (o.nodeIds.length > cycle.nodeIds.length || cycles.indexOf(o) < cycles.indexOf(cycle))
    const parent = cycles.filter(holds).sort((a, b) => a.nodeIds.length - b.nodeIds.length)[0]
    if (parent) cycle.parentId = parent.id
  }
  cycles.sort((a, b) => b.nodeIds.length - a.nodeIds.length)
  derived.set(workflow, cycles)
  return cycles
}

/** Loops nothing caps: no round limit of their own, and some way back whose step has none either. They may run on and on. */
export function unboundedLoops(workflow: CycleSource): WorkflowCycle[] {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]))
  const limited = (edgeId: string) => {
    const edge = workflow.edges.find((e) => e.id === edgeId)
    return !!edge && !!byId.get(edge.from)?.config.maxRounds
  }
  return workflowCycles(workflow).filter((c) => !c.maxRounds && !c.backEdgeIds.every(limited))
}

/** The cycles a step sits in, innermost first. */
export function cyclesOf(workflow: CycleSource, nodeId: string): WorkflowCycle[] {
  return workflowCycles(workflow)
    .filter((c) => c.nodeIds.includes(nodeId))
    .sort((a, b) => a.nodeIds.length - b.nodeIds.length)
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
  /** It went on in the previous step's chat (a "continue" arrow), handed no summary. */
  continued?: boolean
  /** What its turns used, helpers included; absent when its agent does not report it. */
  usage?: WorkflowStepUsage
  /** Files its sessions read and edited, and commands they ran, in order (for the scorecard). */
  reads?: string[]
  edits?: string[]
  commands?: string[]
  /** Claude steps: what its context held at the end of its last turn. */
  context?: WorkflowStepContext
  /** Skills it invoked, MCP servers whose tools it called, subagent types it launched (one entry per call). */
  skillsUsed?: string[]
  mcpUsed?: string[]
  agentsUsed?: string[]
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
  waiting?: {
    question: string
    reason: 'human' | 'ask' | 'limit'
    /** The round count a limit stop resets. */
    limitKey?: string
    /** The question holds local-only work: the answer goes on without it. */
    secret?: boolean
  } | null
  /** A loop that could not finish, handed up to this step to rethink; told to it once, then cleared. */
  escalation?: { nodeId: string; text: string } | null
  /** Non-blocking findings reviewers left for later, handed to the person when the run ends. */
  followUps?: { nodeId: string; label: string; text: string }[]
  /** What each loop was stuck on when it was last handed up, by cycle id: the same again goes higher. */
  escalated?: Record<string, string>
  /** Why it ended failed or stopped, when something said (a step's error, or a comparison's run that would have waited). */
  endReason?: string
  /** Started by a comparison of flows (WorkflowExperiment); the Lead is not told of it. */
  experimentId?: string
  /** Its steps' permission asks are answered "allow" (a comparison's runs, each in a worktree of its own). */
  autoApprove?: boolean
  /** A comparison arm's: what its steps went without. */
  without?: WorkflowContextRemoval
  /** Taken along a "continue" arrow: the chat the next step goes on in. */
  handover?: { nodeId: string; sessionIds: string[] } | null
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
