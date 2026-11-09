import type { HostId } from '@/session-store'
import { createExternalStore } from './external-store'

// Which project's Workflows page fills the main area, if any (components/workflows/WorkflowsPage).

export interface WorkflowsPageTarget {
  hostId: HostId
  projectId: string
  projectName: string
  /** Opens straight on this run's view. */
  runId?: string
}

const store = createExternalStore<WorkflowsPageTarget | null>(null)

export const useWorkflowsPage = () => store.use((target) => target)
export const getWorkflowsPage = store.get

export function openWorkflows(target: WorkflowsPageTarget | null): void {
  store.set(target)
}

/** Set by the open Workflows page: false when it has unsaved changes the person keeps. */
let leaveGuard: (() => boolean) | null = null

export function setWorkflowsLeaveGuard(guard: (() => boolean) | null): void {
  leaveGuard = guard
}

/** Whether the Workflows page may close now (asking about unsaved changes). */
export function leaveWorkflows(): boolean {
  return leaveGuard?.() ?? true
}
