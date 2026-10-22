// Automations, after Orca's (shared/automations-types.ts): a saved prompt the daemon host runs on a
// schedule or when something happens, each run in a chat session the user can open. The execution
// host owns the scheduler, so runs go on while no window is open.

import type { ChatAgentId } from './chat-agents'
import type { ChatEffort, ChatPermissionMode } from './sessions'

/**
 * `schedule`: an RRULE (see automation-schedules.ts) in the host's local time.
 * `workspace-created`: a workspace appears in `projectId` (null: any project), and the run uses it.
 * `agent-finished`: a chat in `workspaceId` (null: any) ends a turn; the run uses that workspace.
 */
export type AutomationTrigger =
  | { kind: 'schedule'; rrule: string }
  | { kind: 'workspace-created'; projectId: string | null }
  | { kind: 'agent-finished'; workspaceId: string | null }

export type AutomationRunStatus =
  | 'dispatched'
  | 'completed'
  | 'failed'
  | 'dispatch_failed'
  | 'skipped_missed'
  | 'skipped_unavailable'
export type AutomationRunTrigger = 'scheduled' | 'manual' | 'event'

export interface Automation {
  id: string
  name: string
  prompt: string
  agent: ChatAgentId
  /** Claude only; null leaves it to Claude's settings. */
  effort: ChatEffort | null
  permissionMode: ChatPermissionMode
  trigger: AutomationTrigger
  /** Where scheduled and manual runs go; event runs use the event's workspace. */
  workspaceId: string | null
  /** Orca's reuseSession: continue the previous run's chat instead of opening a new one. */
  reuseSession: boolean
  enabled: boolean
  /** Next scheduled occurrence; null for event triggers and disabled automations. */
  nextRunAt: number | null
  lastRunAt: number | null
  /** Orca's run_once_within_grace: an occurrence missed by more than this is skipped, not run late. */
  missedRunGraceMinutes: number
  createdAt: number
  updatedAt: number
}

export interface AutomationRun {
  id: string
  automationId: string
  /** Stays unique after older runs are pruned. */
  runNumber: number
  title: string
  trigger: AutomationRunTrigger
  scheduledFor: number
  status: AutomationRunStatus
  workspaceId: string | null
  /** The chat the run's turn went to. */
  sessionId: string | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
  createdAt: number
}

export type AutomationInput = Pick<
  Automation,
  'name' | 'prompt' | 'agent' | 'effort' | 'permissionMode' | 'trigger' | 'workspaceId' | 'reuseSession' | 'enabled'
> &
  Partial<Pick<Automation, 'missedRunGraceMinutes'>>

export const AUTOMATION_DEFAULT_GRACE_MINUTES = 30

export const AUTOMATION_METHODS = {
  automationsList: '_harness/automations/list',
  automationCreate: '_harness/automations/create',
  automationUpdate: '_harness/automations/update',
  automationDelete: '_harness/automations/delete',
  automationRunNow: '_harness/automations/runNow'
} as const

export const AUTOMATION_NOTIFICATIONS = {
  /** Every client of the host hears the whole list and recent runs after any change. */
  automationsChanged: '_harness/automations/changed'
} as const

export interface AutomationSnapshot {
  automations: Automation[]
  /** Newest first, bounded per automation. */
  runs: AutomationRun[]
}

export interface AutomationRequests {
  [AUTOMATION_METHODS.automationsList]: { params: Record<string, never>; result: AutomationSnapshot }
  [AUTOMATION_METHODS.automationCreate]: { params: { input: AutomationInput }; result: Automation }
  [AUTOMATION_METHODS.automationUpdate]: { params: { id: string; patch: Partial<AutomationInput> }; result: Automation }
  [AUTOMATION_METHODS.automationDelete]: { params: { id: string }; result: Record<string, never> }
  /** `workspaceId` is required for event automations, which have no workspace of their own. */
  [AUTOMATION_METHODS.automationRunNow]: { params: { id: string; workspaceId?: string }; result: AutomationRun }
}
