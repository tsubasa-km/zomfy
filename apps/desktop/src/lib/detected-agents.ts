import { useEffect, useSyncExternalStore } from 'react'
import { HARNESS_METHODS, type TuiAgentId } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'

// Agent CLIs found on each daemon host. The probe runs on that host (Windows or a WSL distro),
// never here, as Orca's useDetectedAgents asks the workspace's execution host.

export type DetectedAgentsState =
  | { kind: 'loading' }
  | { kind: 'ready'; agents: TuiAgentId[] }
  | { kind: 'failed'; reason: string }

const LOADING: DetectedAgentsState = { kind: 'loading' }
const byHost = new Map<HostId, DetectedAgentsState>()
const inFlight = new Map<HostId, Promise<void>>()
const listeners = new Set<() => void>()

function set(hostId: HostId, state: DetectedAgentsState): void {
  byHost.set(hostId, state)
  for (const listener of listeners) listener()
}

export function loadDetectedAgents(hostId: HostId, refresh = false): Promise<void> {
  const running = inFlight.get(hostId)
  if (running && !refresh) return running
  if (refresh || !byHost.has(hostId)) set(hostId, LOADING)
  const request = harnessRequest(HARNESS_METHODS.agentsDetect, refresh ? { refresh } : {}, hostId)
    .then(
      ({ agents }) => set(hostId, { kind: 'ready', agents }),
      (error: unknown) => set(hostId, { kind: 'failed', reason: error instanceof Error ? error.message : String(error) })
    )
    .finally(() => inFlight.delete(hostId))
  inFlight.set(hostId, request)
  return request
}

export function useDetectedAgents(hostId: HostId): DetectedAgentsState {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => byHost.get(hostId) ?? LOADING
  )
  useEffect(() => {
    if (!byHost.has(hostId) || byHost.get(hostId)?.kind === 'failed') void loadDetectedAgents(hostId)
  }, [hostId])
  return state
}
