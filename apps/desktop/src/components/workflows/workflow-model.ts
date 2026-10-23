import {
  workflowAccessIssues,
  workflowOutcomes,
  type BuiltinWorkflowOutcome,
  type Workflow,
  type WorkflowAgentProfile,
  type WorkflowDataSource,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowOutcome
} from '@acp-harness/protocol'

// The editor's model of a workflow: what each step kind is, the starting template, and the checks
// a graph must pass before the harness can run it.

export const NODE_KINDS: { kind: WorkflowNodeKind; label: string; hint: string }[] = [
  { kind: 'agent', label: 'Agent', hint: 'A session does a piece of work' },
  { kind: 'review', label: 'Review', hint: 'A session approves or sends back' },
  { kind: 'check', label: 'Check', hint: 'A command passes or fails (tests, lint)' },
  { kind: 'human', label: 'Ask the person', hint: 'Waits for your answer' },
  { kind: 'custom', label: 'Custom', hint: 'Your own fields and outcomes' },
  { kind: 'end', label: 'End', hint: 'The run is done (or failed)' }
]

const BUILTIN_LABELS: Record<BuiltinWorkflowOutcome, string> = {
  next: 'Then',
  approve: 'Approved',
  changes: 'Changes requested',
  pass: 'Passed',
  fail: 'Failed',
  answered: 'Answered',
  ask: 'Has a question'
}

function isBuiltin(outcome: WorkflowOutcome): outcome is BuiltinWorkflowOutcome {
  return outcome in BUILTIN_LABELS
}

/** A built-in outcome's wording; a custom step's outcomes read as their own names. */
export function outcomeLabel(outcome: WorkflowOutcome): string {
  return isBuiltin(outcome) ? BUILTIN_LABELS[outcome] : outcome
}

/** Outcomes a step must have an edge for; "ask" is optional (questions go to the Lead without one). */
function requiredOutcomes(node: WorkflowNode): WorkflowOutcome[] {
  switch (node.kind) {
    case 'start':
    case 'agent':
      return ['next']
    case 'review':
      return ['approve', 'changes']
    case 'check':
      return ['pass', 'fail']
    case 'human':
      return ['answered']
    case 'custom':
      return workflowOutcomes(node).filter((o) => o !== 'ask')
    default:
      return []
  }
}

const DEFAULT_LABELS: Record<WorkflowNodeKind, string> = {
  start: 'Start',
  agent: 'Developer',
  review: 'Reviewer',
  check: 'Run tests',
  human: 'Ask the person',
  end: 'Done',
  custom: 'Custom step'
}

function defaultConfig(kind: WorkflowNodeKind): WorkflowNode['config'] {
  switch (kind) {
    case 'agent':
      return { role: 'Developer', session: 'keep', workspace: 'run-worktree' }
    case 'review':
      return { role: 'Reviewer' }
    case 'check':
      return { command: '' }
    case 'human':
      return { question: '', askLeadFirst: true }
    case 'end':
      return { result: 'done' }
    case 'custom':
      return { runner: 'agent', role: 'Agent', fields: [], outcomes: [] }
    default:
      return {}
  }
}

export function newNode(kind: WorkflowNodeKind, x: number, y: number): WorkflowNode {
  return { id: crypto.randomUUID(), kind, label: DEFAULT_LABELS[kind], x, y, config: defaultConfig(kind) }
}

/** A step run by an agent defined on the host. */
export function newAgentStep(profile: WorkflowAgentProfile, x: number, y: number): WorkflowNode {
  const base = newNode(profile.kind, x, y)
  const { role: _, ...config } = base.config
  return { ...base, label: profile.name, config: { ...config, profileId: profile.id } }
}

export function newDataSource(x: number, y: number): WorkflowDataSource {
  return { id: crypto.randomUUID(), name: 'Data', path: '', x, y }
}

/** Without these steps (Start stays), their edges and their data links. */
export function withoutSteps(workflow: Workflow, ids: Set<string>): Workflow {
  const nodes = workflow.nodes.filter((n) => !ids.has(n.id) || n.kind === 'start')
  const kept = new Set(nodes.map((n) => n.id))
  return {
    ...workflow,
    nodes,
    edges: workflow.edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
    ...(workflow.dataLinks ? { dataLinks: workflow.dataLinks.filter((l) => kept.has(l.nodeId)) } : {})
  }
}

/** Without these data sources and their links. */
export function withoutData(workflow: Workflow, ids: Set<string>): Workflow {
  return {
    ...workflow,
    data: (workflow.data ?? []).filter((d) => !ids.has(d.id)),
    dataLinks: (workflow.dataLinks ?? []).filter((l) => !ids.has(l.dataId))
  }
}

/** The outcome a new edge from `node` gets: the first of its kind's outcomes not yet drawn. */
export function nextOutcome(node: WorkflowNode, workflow: Workflow): WorkflowOutcome {
  const used = new Set(workflow.edges.filter((e) => e.from === node.id).map((e) => e.outcome))
  const options = workflowOutcomes(node)
  return options.find((o) => !used.has(o)) ?? options[0] ?? 'next'
}

/** The develop → test → review loop, with the reviewer's questions going to the person. */
export function reviewLoopTemplate(projectId: string): Workflow {
  const node = (kind: WorkflowNodeKind, label: string, x: number, y: number, config: WorkflowNode['config'] = {}) => {
    const base = newNode(kind, x, y)
    return { ...base, label, config: { ...base.config, ...config } }
  }
  const start = node('start', 'Lead hands off a task', 0, 120)
  const dev = node('agent', 'Developer', 280, 120, {
    prompt: 'Implement the task in this worktree. Commit when done. Address every review finding you are given.'
  })
  const tests = node('check', 'Run tests', 560, 120, { command: '' })
  const review = node('review', 'Reviewer', 840, 120, {
    prompt: "Review the changes on this branch for correctness and the task's intent. Do not edit files."
  })
  const done = node('end', 'Done', 1120, 40)
  const ask = node('human', 'Ask the person', 1120, 220, { question: 'The reviewer needs a decision.' })
  const edge = (from: WorkflowNode, to: WorkflowNode, outcome: WorkflowOutcome) => ({
    id: crypto.randomUUID(),
    from: from.id,
    to: to.id,
    outcome
  })
  return {
    id: crypto.randomUUID(),
    projectId,
    name: 'Develop and review',
    description: 'A developer implements, tests run, a reviewer approves or sends it back (at most 3 rounds).',
    nodes: [start, dev, tests, review, done, ask],
    edges: [
      edge(start, dev, 'next'),
      edge(dev, tests, 'next'),
      edge(tests, review, 'pass'),
      edge(tests, dev, 'fail'),
      edge(review, done, 'approve'),
      edge(review, dev, 'changes'),
      edge(review, ask, 'ask'),
      edge(ask, review, 'answered')
    ],
    updatedAt: Date.now()
  }
}

/**
 * Nested PDCA: the Lead plans and finally checks the result against the person's intent (its own
 * cycle); inside, the developer and reviewer loop until the change is approved.
 */
export function leadCycleTemplate(projectId: string): Workflow {
  const node = (
    kind: WorkflowNodeKind,
    label: string,
    x: number,
    y: number,
    config: WorkflowNode['config'] = {},
    extra: Partial<WorkflowNode> = {}
  ): WorkflowNode => {
    const base = newNode(kind, x, y)
    return { ...base, label, config: { ...base.config, ...config }, ...extra }
  }
  const start = node('start', 'Task from the person', 0, 180)
  const plan = node(
    'agent',
    'Lead plans',
    280,
    180,
    {
      runBy: 'lead',
      role: 'Lead',
      prompt:
        'Turn the task into a plan the developer can follow: scope, files, acceptance criteria. On a later round, fold in what your check found. Hand the plan on in your summary.'
    },
    { phase: 'plan' }
  )
  const dev = node(
    'agent',
    'Developer',
    600,
    180,
    { prompt: "Implement the Lead's plan in this worktree. Commit when done. Address every review finding you are given." }
  )
  const tests = node('check', 'Run tests', 880, 180, { command: '' })
  const review = node(
    'review',
    'Reviewer',
    1160,
    180,
    { prompt: "Review the change against the Lead's plan for correctness. Do not edit files.", tools: { readOnly: true } }
  )
  const check = node(
    'review',
    'Lead checks the result',
    1480,
    180,
    {
      runBy: 'lead',
      role: 'Lead',
      prompt:
        "Check the result against the person's intent and your plan. Approve when it is what they asked for; choose changes to plan another round, saying what to change."
    }
  )
  const ask = node('human', 'Ask the person', 1480, 20, { askLeadFirst: false, question: '' })
  const done = node('end', 'Done', 1800, 180)
  const edge = (from: WorkflowNode, to: WorkflowNode, outcome: WorkflowOutcome) => ({
    id: crypto.randomUUID(),
    from: from.id,
    to: to.id,
    outcome
  })
  return {
    id: crypto.randomUUID(),
    projectId,
    name: 'Lead-led development',
    description: 'Nested PDCA: the Lead plans and checks the result; inside, develop ⇄ review until approved.',
    nodes: [start, plan, dev, tests, review, check, ask, done],
    edges: [
      edge(start, plan, 'next'),
      edge(plan, dev, 'next'),
      edge(dev, tests, 'next'),
      edge(tests, review, 'pass'),
      edge(tests, dev, 'fail'),
      edge(review, check, 'approve'),
      edge(review, dev, 'changes'),
      edge(check, done, 'approve'),
      edge(check, plan, 'changes'),
      edge(check, ask, 'ask'),
      edge(ask, check, 'answered')
    ],
    cycleSettings: [
      { entryId: plan.id, label: 'Lead: plan ⇄ check' },
      { entryId: dev.id, label: 'Develop ⇄ review' }
    ],
    updatedAt: Date.now()
  }
}

export function blankWorkflow(projectId: string): Workflow {
  const start = { ...newNode('start', 0, 120), label: 'Lead hands off a task' }
  return { id: crypto.randomUUID(), projectId, name: 'New workflow', nodes: [start], edges: [], updatedAt: Date.now() }
}

export interface WorkflowIssue {
  level: 'error' | 'warning'
  message: string
  nodeId?: string
  edgeId?: string
  dataId?: string
}

/** What keeps the harness from running the graph (errors) or looks unintended (warnings). */
export function validateWorkflow(workflow: Workflow, agents: WorkflowAgentProfile[] = []): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [...workflowAccessIssues(workflow, agents)]
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]))
  const starts = workflow.nodes.filter((n) => n.kind === 'start')
  if (starts.length !== 1) issues.push({ level: 'error', message: 'A workflow needs exactly one Start.' })
  if (!workflow.nodes.some((n) => n.kind === 'end')) issues.push({ level: 'error', message: 'Add an End step.' })

  for (const node of workflow.nodes) {
    const out = workflow.edges.filter((e) => e.from === node.id)
    for (const outcome of requiredOutcomes(node)) {
      if (!out.some((e) => e.outcome === outcome)) {
        issues.push({ level: 'error', nodeId: node.id, message: `"${node.label}" needs a "${outcomeLabel(outcome)}" edge.` })
      }
    }
    const seen = new Set<WorkflowOutcome>()
    for (const edge of out) {
      if (!workflowOutcomes(node).includes(edge.outcome)) {
        issues.push({ level: 'error', edgeId: edge.id, message: `"${node.label}" cannot end in "${outcomeLabel(edge.outcome)}".` })
      } else if (seen.has(edge.outcome)) {
        issues.push({ level: 'error', edgeId: edge.id, message: `"${node.label}" has two "${outcomeLabel(edge.outcome)}" edges.` })
      }
      seen.add(edge.outcome)
    }
    if ((node.kind === 'check' || (node.kind === 'custom' && node.config.runner === 'command')) && !node.config.command?.trim()) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${node.label}" has no command.` })
    }
    const keys = (node.config.fields ?? []).map((f) => f.key.trim())
    if (keys.some((k) => !/^[A-Za-z_][\w-]*$/.test(k))) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${node.label}" has a field without a valid key (letters, digits, _ or -).` })
    } else if (new Set(keys).size !== keys.length) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${node.label}" has two fields with the same key.` })
    }
    if (node.kind === 'human' && !node.config.question?.trim()) {
      issues.push({ level: 'warning', nodeId: node.id, message: `"${node.label}" has no question; the step's reason is shown instead.` })
    }
  }

  // Every step should be reachable from Start.
  const start = starts[0]
  if (start) {
    const reached = new Set([start.id])
    const queue = [start.id]
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const edge of workflow.edges) {
        if (edge.from === id && !reached.has(edge.to) && byId.has(edge.to)) {
          reached.add(edge.to)
          queue.push(edge.to)
        }
      }
    }
    for (const node of workflow.nodes) {
      if (!reached.has(node.id)) issues.push({ level: 'warning', nodeId: node.id, message: `"${node.label}" is never reached from Start.` })
    }
  }

  return issues
}
