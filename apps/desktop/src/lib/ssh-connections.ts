import { useEffect } from 'react'
import { HARNESS_METHODS, type SshConnection, type SshConnectionInput, type SshConnectionTag } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, getState, LOCAL_HOST, selectTerminal, setTerminals, type HostId } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'
import { t } from '@/i18n/i18n'

// Saved SSH connections, per host (each host's ssh logs in to its own list), and the dialog that
// manages them, which opens from the "+" menu and the command palette.

const lists = createExternalStore<Partial<Record<HostId, SshConnection[]>>>({})
const dialog = createExternalStore<{ open: boolean; workspaceId: string | null }>({ open: false, workspaceId: null })

export const useSshConnectionsDialog = () => dialog.use((d) => d)

/** Opens the list; its tabs open in `workspaceId` (else the workspace in front). */
export function openSshConnectionsDialog(workspaceId: string | null = null): void {
  dialog.set({ open: true, workspaceId: workspaceId ?? getState().activeWorkspaceId })
}

export function closeSshConnectionsDialog(): void {
  dialog.update((d) => ({ ...d, open: false }))
}

export function workspaceHost(workspaceId: string | null): HostId {
  return (workspaceId && allWorkspaces(getState()).find((w) => w.id === workspaceId)?.hostId) || LOCAL_HOST
}

export async function loadSshConnections(hostId: HostId): Promise<SshConnection[]> {
  const list = await harnessRequest(HARNESS_METHODS.sshConnectionsList, {}, hostId)
  lists.update((all) => ({ ...all, [hostId]: list }))
  return list
}

/** The host's connections, loaded on first use; null until they arrive. */
export function useSshConnections(hostId: HostId): SshConnection[] | null {
  const list = lists.use((all) => all[hostId] ?? null)
  useEffect(() => {
    if (!list) void loadSshConnections(hostId).catch(() => lists.update((all) => ({ ...all, [hostId]: [] })))
  }, [hostId, list])
  return list
}

export async function saveSshConnection(hostId: HostId, id: string | undefined, connection: SshConnectionInput): Promise<void> {
  const list = await harnessRequest(HARNESS_METHODS.sshConnectionSave, { ...(id ? { id } : {}), connection }, hostId)
  lists.update((all) => ({ ...all, [hostId]: list }))
}

export async function deleteSshConnection(hostId: HostId, id: string): Promise<void> {
  const list = await harnessRequest(HARNESS_METHODS.sshConnectionDelete, { id }, hostId)
  lists.update((all) => ({ ...all, [hostId]: list }))
}

/** Logs in to the connection in a new terminal tab of the workspace, in front. */
export async function openSshConnection(workspaceId: string, connectionId: string): Promise<string> {
  const hostId = workspaceHost(workspaceId)
  const info = await harnessRequest(HARNESS_METHODS.sshConnectionOpen, { id: connectionId, workspaceId, cols: 120, rows: 30 }, hostId)
  setTerminals(hostId, [...getState().terminals.filter((term) => term.hostId === hostId && term.id !== info.id), info])
  selectTerminal(info.id)
  return info.id
}

export function sshTagLabel(tag: SshConnectionTag): string {
  return { production: t('Production'), staging: t('Staging'), development: t('Development') }[tag]
}

/** user@host:port, as the list shows where a connection goes. */
export function sshDestination(connection: Pick<SshConnection, 'host' | 'user' | 'port'>): string {
  return `${connection.user ? `${connection.user}@` : ''}${connection.host}${connection.port ? `:${connection.port}` : ''}`
}
