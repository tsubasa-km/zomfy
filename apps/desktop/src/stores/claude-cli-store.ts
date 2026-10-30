import { useEffect } from 'react'
import { toast } from 'sonner'
import { HARNESS_METHODS, type ClaudeCliStatus } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, useStore, type HostId } from '@/session-store'
import { createExternalStore } from './external-store'
import { t } from '@/i18n/i18n'

// Each host's Claude Code CLI version, checked once per connection; a host the user updates by
// hand is rechecked when it reconnects or when the CLI path setting changes.

const store = createExternalStore<Record<HostId, ClaudeCliStatus>>({})
const updating = createExternalStore<ReadonlySet<HostId>>(new Set())
const loading = new Set<HostId>()

/** Null until the host is connected and has answered. */
export function useClaudeCliStatus(hostId: HostId): ClaudeCliStatus | null {
  const connected = useStore((s) => s.hosts[hostId]?.connection.kind === 'connected')
  const status = store.use((all) => all[hostId] ?? null)
  useEffect(() => {
    if (connected && !status) loadClaudeCliStatus(hostId).catch(() => {})
    if (!connected && status) store.update(({ [hostId]: _, ...rest }) => rest)
  }, [connected, status, hostId])
  return status
}

export function useClaudeCliUpdating(hostId: HostId): boolean {
  return updating.use((set) => set.has(hostId))
}

export async function loadClaudeCliStatus(hostId: HostId): Promise<void> {
  if (loading.has(hostId) || getState().hosts[hostId]?.connection.kind !== 'connected') return
  loading.add(hostId)
  try {
    const status = await harnessRequest(HARNESS_METHODS.claudeCliStatus, {}, hostId)
    store.update((all) => ({ ...all, [hostId]: status }))
  } finally {
    loading.delete(hostId)
  }
}

export function claudeCliWarning(status: ClaudeCliStatus): string {
  return t('Claude Code {version} is older than {expected}, the version Zomfy is built for. Newer chat features may fail on this host.', {
    version: status.version,
    expected: status.expected
  })
}

/** Runs `claude update` on the host and reports the outcome as a toast. */
export async function updateClaudeCliOn(hostId: HostId): Promise<void> {
  if (updating.get().has(hostId)) return
  const label = getState().hosts[hostId]?.label ?? hostId
  updating.update((set) => new Set(set).add(hostId))
  const id = toast.loading(t('Updating Claude Code on {host}…', { host: label }))
  try {
    const result = await harnessRequest(HARNESS_METHODS.claudeCliUpdate, {}, hostId)
    store.update((all) => ({ ...all, [hostId]: result.status }))
    if (result.ok) toast.success(t('Claude Code on {host} is now {version}.', { host: label, version: result.status.version }), { id })
    else
      toast.error(t('Claude Code on {host} was not updated', { host: label }), {
        id,
        description: result.output.split('\n').slice(-6).join('\n') || t('Run `claude update` in a terminal on that host.'),
        duration: 15_000
      })
  } catch (error) {
    toast.error(t('Claude Code on {host} was not updated', { host: label }), { id, description: String(error) })
  } finally {
    updating.update((set) => {
      const next = new Set(set)
      next.delete(hostId)
      return next
    })
  }
}
