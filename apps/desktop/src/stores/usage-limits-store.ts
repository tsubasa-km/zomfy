import { useEffect } from 'react'
import { HARNESS_METHODS, type ProviderUsageLimits } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { createExternalStore } from './external-store'

// The host's accounts' usage limits (Claude's 5-hour and weekly windows, Codex's), as the daemon
// read them lately. Asked again every minute while something shows them and the window is in view;
// the daemon answers from what it has unless it is old, so asking is cheap.

const POLL_MS = 60_000

export interface HostUsageLimits {
  providers: ProviderUsageLimits[]
  loading: boolean
  error: string | null
}

const EMPTY: HostUsageLimits = { providers: [], loading: false, error: null }
const store = createExternalStore<Record<HostId, HostUsageLimits>>({})
const inFlight = new Map<HostId, Promise<void>>()

export function refreshUsageLimits(hostId: HostId, options: { refresh?: boolean; sessionId?: string } = {}): Promise<void> {
  const running = inFlight.get(hostId)
  if (running) return running
  store.update((all) => ({ ...all, [hostId]: { ...(all[hostId] ?? EMPTY), loading: true } }))
  const request = harnessRequest(
    HARNESS_METHODS.usageLimits,
    { ...(options.refresh ? { refresh: true } : {}), ...(options.sessionId ? { sessionId: options.sessionId } : {}) },
    hostId
  )
    .then((result) => store.update((all) => ({ ...all, [hostId]: { providers: result.providers, loading: false, error: null } })))
    .catch((error: unknown) =>
      store.update((all) => ({
        ...all,
        [hostId]: { ...(all[hostId] ?? EMPTY), loading: false, error: error instanceof Error ? error.message : String(error) }
      }))
    )
    .finally(() => inFlight.delete(hostId))
  inFlight.set(hostId, request)
  return request
}

/** This host's limits, kept fresh while the calling component is mounted. */
export function useUsageLimits(hostId: HostId | null, sessionId?: string): HostUsageLimits {
  const limits = store.use((all) => (hostId ? all[hostId] : undefined)) ?? EMPTY
  useEffect(() => {
    if (!hostId) return
    const read = () => {
      if (document.visibilityState === 'visible') void refreshUsageLimits(hostId, sessionId ? { sessionId } : {})
    }
    read()
    const timer = setInterval(read, POLL_MS)
    document.addEventListener('visibilitychange', read)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', read)
    }
  }, [hostId, sessionId])
  return limits
}
