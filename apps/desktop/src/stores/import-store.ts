import type { ImportSourceId } from '@/lib/import-sources'
import type { HostId } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'

// The Import dialog (docs/specs/import-dialog.md), openable from anywhere (the sidebar's add menu,
// the Add a project dialog, onboarding); App mounts it once.

export interface ImportRequest {
  /** The source to show when the host has it; the first found otherwise. */
  source?: ImportSourceId
  /** The host to import on; the active workspace's when absent. */
  hostId?: HostId
  /** The workspace whose folder a thread list starts on; the active one when absent. */
  workspaceId?: string
  /** Reopening with the same options still resets the dialog. */
  nonce: number
}

const requests = createExternalStore<ImportRequest | null>(null)
let nonce = 0

export const useImportRequest = () => requests.use((r) => r)

export function openImport(opts: { source?: ImportSourceId; hostId?: HostId; workspaceId?: string } = {}): void {
  requests.set({ ...opts, nonce: ++nonce })
}

export function closeImport(): void {
  requests.set(null)
}
