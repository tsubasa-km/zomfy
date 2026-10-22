import { useEffect } from 'react'
import { HARNESS_METHODS, type Automation, type AutomationRun, type AutomationSnapshot } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { useStore, type HostId } from '@/session-store'
import { createExternalStore } from './external-store'

// Each host's daemon owns its automations and broadcasts the whole list after any change; this
// window keeps the latest snapshot per host, plus whether the Automations page is open.

export type HostedAutomation = Automation & { hostId: HostId }
export type HostedAutomationRun = AutomationRun & { hostId: HostId }

interface AutomationState {
  byHost: Record<HostId, AutomationSnapshot>
  pageOpen: boolean
  selectedId: string | null
}

const store = createExternalStore<AutomationState>({ byHost: {}, pageOpen: false, selectedId: null })
const loading = new Set<HostId>()

export const useAutomationState = store.use

export function applyAutomationSnapshot(hostId: HostId, snapshot: AutomationSnapshot): void {
  store.update((s) => ({ ...s, byHost: { ...s.byHost, [hostId]: snapshot } }))
}

export function setAutomationsPageOpen(open: boolean): void {
  store.update((s) => ({ ...s, pageOpen: open }))
}

export function selectAutomation(id: string | null): void {
  store.update((s) => ({ ...s, selectedId: id }))
}

export function allAutomations(byHost: AutomationState['byHost']): HostedAutomation[] {
  return Object.entries(byHost).flatMap(([hostId, snap]) => snap.automations.map((a) => ({ ...a, hostId })))
}

export function automationRuns(byHost: AutomationState['byHost'], automation: HostedAutomation): HostedAutomationRun[] {
  return (byHost[automation.hostId]?.runs ?? [])
    .filter((r) => r.automationId === automation.id)
    .map((r) => ({ ...r, hostId: automation.hostId }))
}

/** Fetches every connected host's automations once each is connected; broadcasts keep them fresh. */
export function useLoadAutomations(): void {
  const connected = useStore((s) =>
    Object.values(s.hosts)
      .filter((h) => h.connection.kind === 'connected')
      .map((h) => h.id)
      .join('\n')
  )
  useEffect(() => {
    for (const hostId of connected.split('\n').filter(Boolean)) {
      if (store.get().byHost[hostId] || loading.has(hostId)) continue
      loading.add(hostId)
      harnessRequest(HARNESS_METHODS.automationsList, {}, hostId)
        .then((snapshot) => applyAutomationSnapshot(hostId, snapshot))
        .catch(() => undefined)
        .finally(() => loading.delete(hostId))
    }
  }, [connected])
}
