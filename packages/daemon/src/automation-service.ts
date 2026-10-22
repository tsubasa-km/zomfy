import type * as acp from '@agentclientprotocol/sdk'
import {
  AUTOMATION_DEFAULT_GRACE_MINUTES,
  AUTOMATION_NOTIFICATIONS,
  isChatAgentId,
  nextAutomationOccurrenceAfter,
  parseAutomationRrule,
  type Automation,
  type AutomationInput,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationRunTrigger,
  type AutomationSnapshot,
  type SessionInfo
} from '@acp-harness/protocol'
import { RUNS_KEPT_PER_AUTOMATION, loadAutomations, saveAutomations } from './automation-store.ts'
import { DEFAULT_SESSION_OPTIONS, type SessionRegistry } from './session-registry.ts'
import type { WorkspaceManager } from './workspace-manager.ts'
import { log } from './log.ts'

const TICK_MS = 15_000

export interface AutomationServiceDeps {
  workspaces: WorkspaceManager
  sessions: SessionRegistry
  runTurn(sessionId: string, text: string): Promise<acp.StopReason>
  broadcast(method: string, params: unknown): void
}

/**
 * The host's automation scheduler (Orca's main/automations/service.ts, cut down): schedule
 * triggers fire from a timer, event triggers from the workspace and session stores, and every
 * run's turn goes to a chat session so its result can be read like any other chat.
 */
export class AutomationService {
  private automations: Automation[] = []
  private runs: AutomationRun[] = []
  private knownWorkspaces = new Set<string>()
  private lastStatus = new Map<string, SessionInfo['status']>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: AutomationServiceDeps) {}

  async start(): Promise<void> {
    const saved = await loadAutomations()
    this.automations = saved.automations
    // A turn cannot outlive the daemon that ran it.
    this.runs = saved.runs.map((r) =>
      r.status === 'dispatched'
        ? { ...r, status: 'failed', error: 'The daemon stopped during this run', completedAt: r.completedAt ?? Date.now() }
        : r
    )
    const state = await this.deps.workspaces.snapshot()
    this.knownWorkspaces = new Set(state.workspaces.map((w) => w.id))
    for (const s of this.deps.sessions.list()) this.lastStatus.set(s.id, s.status)
    this.deps.workspaces.onChange((next) => this.onWorkspaces(next.workspaces))
    this.deps.sessions.onChange((list) => this.onSessions(list))
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.changed()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  snapshot(): AutomationSnapshot {
    return { automations: this.automations, runs: [...this.runs].sort((a, b) => b.createdAt - a.createdAt) }
  }

  create(input: AutomationInput): Automation {
    const now = Date.now()
    const automation = this.withSchedule(
      {
        id: crypto.randomUUID(),
        missedRunGraceMinutes: AUTOMATION_DEFAULT_GRACE_MINUTES,
        ...this.validate(input),
        nextRunAt: null,
        lastRunAt: null,
        createdAt: now,
        updatedAt: now
      },
      now
    )
    this.automations = [...this.automations, automation]
    this.changed()
    return automation
  }

  update(id: string, patch: Partial<AutomationInput>): Automation {
    const current = this.require(id)
    const { id: _id, nextRunAt: _next, lastRunAt: _last, createdAt: _created, updatedAt: _updated, ...fields } = current
    const now = Date.now()
    const next = this.withSchedule(
      { ...current, ...this.validate({ ...fields, ...patch }), nextRunAt: null, updatedAt: now },
      now
    )
    this.automations = this.automations.map((a) => (a.id === id ? next : a))
    this.changed()
    return next
  }

  remove(id: string): void {
    this.require(id)
    this.automations = this.automations.filter((a) => a.id !== id)
    this.runs = this.runs.filter((r) => r.automationId !== id)
    this.changed()
  }

  runNow(id: string, workspaceId?: string): AutomationRun {
    const automation = this.require(id)
    return this.dispatch(automation, 'manual', workspaceId ?? automation.workspaceId, Date.now())
  }

  /** Sessions a run opened; their finished turns never trigger agent-finished automations. */
  private isAutomationSession(sessionId: string): boolean {
    return this.runs.some((r) => r.sessionId === sessionId)
  }

  private tick(): void {
    const now = Date.now()
    let changed = false
    for (const automation of this.automations) {
      if (!automation.enabled || automation.trigger.kind !== 'schedule' || automation.nextRunAt === null) continue
      if (automation.nextRunAt > now) continue
      const due = automation.nextRunAt
      automation.nextRunAt = safeNext(automation.trigger.rrule, now)
      automation.lastRunAt = due
      changed = true
      if (now - due > automation.missedRunGraceMinutes * 60_000) {
        this.record(this.newRun(automation, 'scheduled', automation.workspaceId, due, 'skipped_missed', 'The host was not running at the scheduled time'))
      } else {
        this.dispatch(automation, 'scheduled', automation.workspaceId, due)
      }
    }
    if (changed) this.changed()
  }

  private onWorkspaces(workspaces: { id: string; projectId: string | null; name: string }[]): void {
    const added = workspaces.filter((w) => !this.knownWorkspaces.has(w.id))
    this.knownWorkspaces = new Set(workspaces.map((w) => w.id))
    for (const workspace of added) {
      if (workspace.projectId === null) continue
      for (const automation of this.automations) {
        const trigger = automation.trigger
        if (!automation.enabled || trigger.kind !== 'workspace-created') continue
        if (trigger.projectId !== null && trigger.projectId !== workspace.projectId) continue
        this.dispatch(automation, 'event', workspace.id, Date.now(), `The workspace "${workspace.name}" was just created.`)
      }
    }
  }

  private onSessions(list: SessionInfo[]): void {
    const finished: SessionInfo[] = []
    for (const session of list) {
      const before = this.lastStatus.get(session.id)
      this.lastStatus.set(session.id, session.status)
      if (before === 'working' && session.status === 'idle') finished.push(session)
    }
    for (const session of finished) {
      if (session.workspaceId === null || session.sideOf || this.isAutomationSession(session.id)) continue
      for (const automation of this.automations) {
        const trigger = automation.trigger
        if (!automation.enabled || trigger.kind !== 'agent-finished') continue
        if (trigger.workspaceId !== null && trigger.workspaceId !== session.workspaceId) continue
        // One run at a time per workspace, so a busy chat cannot pile runs up.
        const busy = this.runs.some(
          (r) => r.automationId === automation.id && r.workspaceId === session.workspaceId && r.status === 'dispatched'
        )
        if (busy) continue
        this.dispatch(automation, 'event', session.workspaceId, Date.now(), `The agent in the chat "${session.title}" just finished a turn.`)
      }
    }
  }

  private dispatch(
    automation: Automation,
    trigger: AutomationRunTrigger,
    workspaceId: string | null,
    scheduledFor: number,
    eventContext?: string
  ): AutomationRun {
    const cwd = workspaceId ? this.deps.workspaces.workspacePath(workspaceId) : null
    if (!workspaceId || !cwd) {
      const run = this.newRun(automation, trigger, workspaceId, scheduledFor, 'skipped_unavailable', 'The workspace no longer exists')
      this.record(run)
      return run
    }
    const run = this.newRun(automation, trigger, workspaceId, scheduledFor, 'dispatched', null)
    const sessionId = this.sessionFor(automation, workspaceId, cwd, run.title)
    run.sessionId = sessionId
    run.startedAt = Date.now()
    this.record(run)
    const text = eventContext ? `${eventContext}\n\n${automation.prompt}` : automation.prompt
    this.deps.runTurn(sessionId, text).then(
      (stopReason) => this.finish(run.id, 'completed', stopReason === 'cancelled' ? 'Stopped before it finished' : null),
      (error: unknown) => this.finish(run.id, 'failed', error instanceof Error ? error.message : String(error))
    )
    log(`automation ${automation.name}: run ${run.runNumber} in ${workspaceId}`)
    return run
  }

  /** Orca's reuseSession continues the last run's chat when it is still open and idle. */
  private sessionFor(automation: Automation, workspaceId: string, cwd: string, title: string): string {
    if (automation.reuseSession) {
      const previous = this.runs.find((r) => r.automationId === automation.id && r.workspaceId === workspaceId && r.sessionId)
      const session = previous?.sessionId ? this.deps.sessions.get(previous.sessionId) : undefined
      if (session && session.status !== 'working' && session.status !== 'needs-you') return session.id
    }
    const record = this.deps.sessions.create({
      workspaceId,
      cwd,
      title,
      options: {
        ...DEFAULT_SESSION_OPTIONS,
        permissionMode: automation.permissionMode,
        effort: automation.agent === 'claude' ? automation.effort : null
      },
      ...(automation.agent !== 'claude' ? { agent: automation.agent } : {})
    })
    return record.id
  }

  private newRun(
    automation: Automation,
    trigger: AutomationRunTrigger,
    workspaceId: string | null,
    scheduledFor: number,
    status: AutomationRunStatus,
    error: string | null
  ): AutomationRun {
    const runNumber = Math.max(0, ...this.runs.filter((r) => r.automationId === automation.id).map((r) => r.runNumber)) + 1
    const now = Date.now()
    return {
      id: crypto.randomUUID(),
      automationId: automation.id,
      runNumber,
      title: `${automation.name} #${runNumber}`,
      trigger,
      scheduledFor,
      status,
      workspaceId,
      sessionId: null,
      error,
      startedAt: null,
      completedAt: status === 'dispatched' ? null : now,
      createdAt: now
    }
  }

  private record(run: AutomationRun): void {
    // Newest first; the oldest finished runs past the bound are pruned.
    const own = [run, ...this.runs.filter((r) => r.automationId === run.automationId)]
    const kept = new Set(own.slice(0, RUNS_KEPT_PER_AUTOMATION).map((r) => r.id))
    this.runs = [run, ...this.runs].filter((r) => r.automationId !== run.automationId || kept.has(r.id))
    const automation = this.automations.find((a) => a.id === run.automationId)
    if (automation && run.status !== 'skipped_missed') automation.lastRunAt = run.createdAt
    this.changed()
  }

  private finish(runId: string, status: AutomationRunStatus, error: string | null): void {
    this.runs = this.runs.map((r) => (r.id === runId ? { ...r, status, error, completedAt: Date.now() } : r))
    this.changed()
  }

  private withSchedule(automation: Automation, now: number): Automation {
    const nextRunAt =
      automation.enabled && automation.trigger.kind === 'schedule' ? safeNext(automation.trigger.rrule, now) : null
    return { ...automation, nextRunAt }
  }

  private validate(input: AutomationInput): AutomationInput {
    const name = input.name.trim()
    const prompt = input.prompt.trim()
    if (!name) throw new Error('Give the automation a name')
    if (!prompt) throw new Error('Write the prompt the automation runs')
    if (!isChatAgentId(input.agent)) throw new Error(`Unknown agent ${String(input.agent)}`)
    const trigger = input.trigger
    if (trigger.kind === 'schedule') {
      parseAutomationRrule(trigger.rrule)
      if (!input.workspaceId) throw new Error('Pick the workspace scheduled runs go to')
    } else if (trigger.kind !== 'workspace-created' && trigger.kind !== 'agent-finished') {
      throw new Error('Unknown trigger')
    }
    if (input.workspaceId && !this.deps.workspaces.workspacePath(input.workspaceId)) {
      throw new Error('That workspace does not exist on this host')
    }
    const grace = input.missedRunGraceMinutes
    return {
      ...input,
      name,
      prompt,
      ...(grace !== undefined ? { missedRunGraceMinutes: Math.max(1, Math.min(24 * 60, Math.floor(grace))) } : {})
    }
  }

  private require(id: string): Automation {
    const automation = this.automations.find((a) => a.id === id)
    if (!automation) throw new Error(`Unknown automation ${id}`)
    return automation
  }

  private changed(): void {
    const snapshot = this.snapshot()
    this.deps.broadcast(AUTOMATION_NOTIFICATIONS.automationsChanged, snapshot)
    void saveAutomations({ automations: this.automations, runs: this.runs })
  }
}

function safeNext(rrule: string, after: number): number | null {
  try {
    return nextAutomationOccurrenceAfter(rrule, after)
  } catch (error) {
    log(`automation schedule ${rrule}: ${String(error)}`)
    return null
  }
}
