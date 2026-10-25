import { HARNESS_METHODS, type WorkflowExperiment } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { createExternalStore } from './external-store'

// Flow comparisons this window has seen, kept live by each host's workflowExperimentChanged broadcast.

export type HostedWorkflowExperiment = WorkflowExperiment & { hostId: HostId }

const store = createExternalStore<Record<string, HostedWorkflowExperiment>>({})

export function upsertWorkflowExperiment(hostId: HostId, experiment: WorkflowExperiment): void {
  store.update((all) => ({ ...all, [experiment.id]: { ...experiment, hostId } }))
}

export async function loadWorkflowExperiments(hostId: HostId, projectId: string): Promise<void> {
  const list = await harnessRequest(HARNESS_METHODS.workflowExperimentsList, { projectId }, hostId)
  store.update((all) => {
    const next = { ...all }
    for (const experiment of list) next[experiment.id] = { ...experiment, hostId }
    return next
  })
}

/** A project's comparisons, newest first. */
export function useWorkflowExperiments(hostId: HostId, projectId: string): HostedWorkflowExperiment[] {
  const all = store.use((experiments) => experiments)
  return Object.values(all)
    .filter((e) => e.hostId === hostId && e.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function useWorkflowExperiment(id: string | null): HostedWorkflowExperiment | null {
  return store.use((experiments) => (id ? (experiments[id] ?? null) : null))
}
