import type { FolderInspection, HostingAccount } from '@zomfy/protocol'
import type { AddProjectStep } from '@/lib/project-dialogs'
import type { HostEntry, HostId } from '@/session-store'
import { shortHostNames } from '@/components/sidebar/project-entries'

// The pure parts of the Add a project dialog (docs/specs/add-project-dialog.md).

/** session-store's LOCAL_HOST, kept here so this file stays free of the store. */
const LOCAL_HOST: HostId = 'local'

export type AddTab = 'open' | 'clone' | 'create'

export function tabForStep(step: AddProjectStep): AddTab {
  return step === 'clone' ? 'clone' : step === 'create' ? 'create' : 'open'
}

export interface HostPill {
  id: HostId
  label: string
  state: 'connected' | 'connecting' | 'offline'
}

/** This computer first, then the rest by name; WSL distros the app has not started are listed offline. */
export function hostPills(hosts: Record<HostId, HostEntry>, distros: string[]): HostPill[] {
  const entries = Object.values(hosts)
  const names = shortHostNames(entries)
  const pills: HostPill[] = entries
    .map((h) => ({ id: h.id, label: h.id === LOCAL_HOST ? '' : (names[h.id] ?? h.label), state: h.connection.kind }))
    .sort((a, b) => (a.id === LOCAL_HOST ? -1 : b.id === LOCAL_HOST ? 1 : a.label.localeCompare(b.label)))
  for (const distro of distros) {
    if (!hosts[`wsl:${distro}`]) pills.push({ id: `wsl:${distro}`, label: distros.length > 1 ? distro : 'WSL', state: 'offline' })
  }
  return pills
}

/** With one machine, the dialog says nothing about machines. */
export function showHostRow(pills: HostPill[]): boolean {
  return pills.length > 1
}

export type FolderStatus =
  | { tone: 'muted'; kind: 'checking' }
  | { tone: 'muted'; kind: 'git-remote'; remote: string }
  | { tone: 'muted'; kind: 'git-other-remote' }
  | { tone: 'muted'; kind: 'git-no-remote' }
  | { tone: 'warning'; kind: 'folder' }
  | { tone: 'error'; kind: 'missing' }

/** What the line under the Folder field says; null with nothing typed or a daemon that cannot tell. */
export function folderStatus(path: string, inspection: FolderInspection | null | undefined): FolderStatus | null {
  if (!path.trim() || inspection === null) return null
  if (inspection === undefined) return { tone: 'muted', kind: 'checking' }
  if (!inspection.exists) return { tone: 'error', kind: 'missing' }
  if (inspection.kind === 'folder') return { tone: 'warning', kind: 'folder' }
  if (inspection.remote) return { tone: 'muted', kind: 'git-remote', remote: `${inspection.remote.host}/${inspection.remote.repo}` }
  return { tone: 'muted', kind: inspection.hasRemote ? 'git-other-remote' : 'git-no-remote' }
}

/** GitHub accounts a new repository can be published as, the active one of each host first. */
export function publishAccounts(accounts: HostingAccount[] | null): HostingAccount[] {
  return (accounts ?? [])
    .filter((a) => a.provider === 'github' && !a.problem)
    .sort((a, b) => (a.host === b.host ? Number(b.active) - Number(a.active) : a.host === 'github.com' ? -1 : b.host === 'github.com' ? 1 : a.host.localeCompare(b.host)))
}
