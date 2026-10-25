import { HARNESS_METHODS, type WorkflowRun } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { createExternalStore } from './external-store'

// Workflow runs this window has seen, kept live by each host's workflowRunChanged broadcast.

export type HostedWorkflowRun = WorkflowRun & { hostId: HostId }

const store = createExternalStore<Record<string, HostedWorkflowRun>>({})

export function upsertWorkflowRun(hostId: HostId, run: WorkflowRun): void {
  store.update((all) => ({ ...all, [run.id]: { ...run, hostId } }))
}

export async function loadWorkflowRuns(hostId: HostId, projectId: string): Promise<void> {
  const runs = await harnessRequest(HARNESS_METHODS.workflowRunsList, { projectId }, hostId)
  store.update((all) => {
    const next = { ...all }
    for (const run of runs) next[run.id] = { ...run, hostId }
    return next
  })
}

export function getWorkflowRuns(): HostedWorkflowRun[] {
  return Object.values(store.get())
}

/** A project's runs, newest first. */
export function useWorkflowRuns(hostId: HostId, projectId: string): HostedWorkflowRun[] {
  const all = store.use((runs) => runs)
  return Object.values(all)
    .filter((r) => r.hostId === hostId && r.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function useWorkflowRun(runId: string | null): HostedWorkflowRun | null {
  return store.use((runs) => (runId ? (runs[runId] ?? null) : null))
}
