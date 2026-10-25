// A run's scorecard: what it cost, how much work was done twice, how often it went round, and how
// it ended. Read from the run's own record, so any finished run (and a running one) can be scored.

import type { WorkflowRun, WorkflowRunStep } from './workflows'

/** Tokens a step's turns used (helpers included). */
export interface WorkflowStepUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** Claude reports it; other agents do not. */
  costUsd?: number
}

export interface WorkflowScorecard {
  status: WorkflowRun['status']
  steps: number
  durationMs: number
  usage: WorkflowStepUsage
  /** Steps that reported no usage (an agent that does not report it, a command, the person). */
  unmetered: number
  reads: number
  /** Reads of a file a step had already read, with no edit to it in between. */
  repeatedReads: number
  /** Reads of a file an earlier step had already read, with no edit in between: what a handoff did not carry. */
  rereadAfterHandoff: number
  commands: number
  /** Commands an earlier step had already run, run again by a later one (often the same tests). */
  rerunCommands: number
  /** Times a review sent work back, and checks failed. */
  sentBack: number
  checksFailed: number
  /** Times the run waited on the person. */
  personWaits: number
  /** Handoff summaries passed between steps: how many and their average length in characters. */
  handoffs: number
  handoffChars: number
}

const norm = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

export function workflowScorecard(run: WorkflowRun): WorkflowScorecard {
  const steps = run.steps
  const usage: WorkflowStepUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  let cost = 0
  let costed = false
  let unmetered = 0
  // The step that last read, last edited, or first ran each file or command.
  const lastRead = new Map<string, number>()
  const lastEdit = new Map<string, number>()
  const ran = new Map<string, number>()
  let reads = 0
  let repeatedReads = 0
  let rereadAfterHandoff = 0
  let commands = 0
  let rerunCommands = 0
  steps.forEach((step: WorkflowRunStep, index) => {
    if (step.usage) {
      usage.inputTokens += step.usage.inputTokens
      usage.outputTokens += step.usage.outputTokens
      usage.cacheReadTokens += step.usage.cacheReadTokens
      if (step.usage.costUsd !== undefined) {
        cost += step.usage.costUsd
        costed = true
      }
    } else if (step.sessionIds.length > 0) unmetered++
    for (const raw of step.reads ?? []) {
      const path = norm(raw)
      reads++
      const before = lastRead.get(path)
      const edited = lastEdit.get(path)
      if (before !== undefined && (edited === undefined || edited < before)) {
        if (before === index) repeatedReads++
        else rereadAfterHandoff++
      }
      lastRead.set(path, index)
    }
    for (const raw of step.edits ?? []) lastEdit.set(norm(raw), index)
    for (const command of step.commands ?? []) {
      commands++
      const key = command.trim().replace(/\s+/g, ' ')
      const earlier = ran.get(key)
      if (earlier !== undefined && earlier < index) rerunCommands++
      if (earlier === undefined) ran.set(key, index)
    }
  })
  if (costed) usage.costUsd = cost
  const ended = steps.filter((s) => s.endedAt !== null)
  const handed = ended.filter((s) => s.summary.trim() && s.sessionIds.length > 0)
  const first = steps[0]?.startedAt ?? run.createdAt
  const last = run.endedAt ?? Math.max(first, ...ended.map((s) => s.endedAt ?? first))
  return {
    status: run.status,
    steps: steps.length,
    durationMs: Math.max(0, last - first),
    usage,
    unmetered,
    reads,
    repeatedReads,
    rereadAfterHandoff,
    commands,
    rerunCommands,
    sentBack: steps.filter((s) => s.outcome === 'changes').length,
    checksFailed: steps.filter((s) => s.outcome === 'fail').length,
    personWaits: steps.filter((s) => s.outcome === 'answered').length + (run.status === 'waiting' ? 1 : 0),
    handoffs: handed.length,
    handoffChars: handed.length ? Math.round(handed.reduce((n, s) => n + s.summary.length, 0) / handed.length) : 0
  }
}
