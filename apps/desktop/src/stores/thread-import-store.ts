import type { HostId } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'

// The Import threads dialog, openable from anywhere (the sidebar's add menu today); App mounts it once.

export interface ImportThreadsRequest {
  /** The host whose agents' conversations to list; the active workspace's when absent. */
  hostId?: HostId
  /** The workspace whose folder to start on; the active one when absent. */
  workspaceId?: string
  /** Reopening with the same options still resets the dialog. */
  nonce: number
}

const requests = createExternalStore<ImportThreadsRequest | null>(null)
let nonce = 0

export const useImportThreadsRequest = () => requests.use((r) => r)

export function openImportThreads(opts: { hostId?: HostId; workspaceId?: string } = {}): void {
  requests.set({ ...opts, nonce: ++nonce })
}

export function closeImportThreads(): void {
  requests.set(null)
}
