import { useEffect } from 'react'
import { HARNESS_METHODS, type WorkflowAgentProfile } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { createExternalStore } from './external-store'

// The agents workflow steps use, defined once per host (its daemon keeps them for every project).

const byHost = createExternalStore<Record<HostId, WorkflowAgentProfile[]>>({})
const loading = new Map<HostId, Promise<void>>()

const NONE: WorkflowAgentProfile[] = []

function load(hostId: HostId): Promise<void> {
  const known = loading.get(hostId)
  if (known) return known
  const pending = harnessRequest(HARNESS_METHODS.workflowAgentsList, {}, hostId).then(
    (list) => byHost.update((all) => ({ ...all, [hostId]: list })),
    // Asked again the next time the editor opens.
    () => void loading.delete(hostId)
  )
  loading.set(hostId, pending)
  return pending
}

export function useWorkflowAgents(hostId: HostId): WorkflowAgentProfile[] {
  useEffect(() => {
    void load(hostId)
  }, [hostId])
  return byHost.use((all) => all[hostId] ?? NONE)
}

export async function saveWorkflowAgent(hostId: HostId, agent: WorkflowAgentProfile): Promise<void> {
  const list = await harnessRequest(HARNESS_METHODS.workflowAgentSave, { agent }, hostId)
  byHost.update((all) => ({ ...all, [hostId]: list }))
}

export async function removeWorkflowAgent(hostId: HostId, id: string): Promise<void> {
  const list = await harnessRequest(HARNESS_METHODS.workflowAgentRemove, { id }, hostId)
  byHost.update((all) => ({ ...all, [hostId]: list }))
}
