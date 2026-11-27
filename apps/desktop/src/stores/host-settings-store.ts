import { useEffect } from 'react'
import { HARNESS_METHODS, type HostSettings } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, useStore, type HostId } from '@/session-store'
import { createExternalStore } from './external-store'

// Settings each host's daemon persists under its harness home (`settings.json`). The daemon
// broadcasts changes, so every window and client of that host stays in sync.

const store = createExternalStore<Record<HostId, HostSettings>>({})
const loading = new Set<HostId>()

export function applyHostSettings(hostId: HostId, settings: HostSettings): void {
  store.update((all) => ({ ...all, [hostId]: settings }))
}

export function getHostSettings(hostId: HostId): HostSettings | null {
  return store.get()[hostId] ?? null
}

/** Every host's settings known so far, by host; loads the connected ones that have not answered. */
export function useAllHostSettings(hostIds: readonly HostId[]): Record<HostId, HostSettings> {
  const all = store.use((s) => s)
  const missing = hostIds.filter((id) => !all[id]).join(' ')
  useEffect(() => {
    for (const id of missing.split(' ').filter(Boolean)) if (!loading.has(id)) loadHostSettings(id).catch(() => {})
  }, [missing])
  return all
}

/** Null until the host is connected and has answered. */
export function useHostSettings(hostId: HostId): HostSettings | null {
  const connected = useStore((s) => s.hosts[hostId]?.connection.kind === 'connected')
  const settings = store.use((all) => all[hostId] ?? null)
  useEffect(() => {
    if (connected && !settings) loadHostSettings(hostId).catch(() => {})
  }, [connected, settings, hostId])
  return settings
}

export async function loadHostSettings(hostId: HostId): Promise<void> {
  if (loading.has(hostId) || getState().hosts[hostId]?.connection.kind !== 'connected') return
  loading.add(hostId)
  try {
    applyHostSettings(hostId, await harnessRequest(HARNESS_METHODS.settingsGet, {}, hostId))
  } finally {
    loading.delete(hostId)
  }
}

export async function updateHostSettings(hostId: HostId, patch: Partial<HostSettings>): Promise<HostSettings> {
  const next = await harnessRequest(HARNESS_METHODS.settingsUpdate, { patch }, hostId)
  applyHostSettings(hostId, next)
  return next
}
