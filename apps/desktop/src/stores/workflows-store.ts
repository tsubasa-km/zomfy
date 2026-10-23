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

export function openWorkflows(target: WorkflowsPageTarget | null): void {
  store.set(target)
}
