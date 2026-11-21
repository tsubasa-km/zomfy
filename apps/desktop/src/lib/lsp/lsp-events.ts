import type { LspEvent } from '@zomfy/protocol'
import type { HostId } from '@/session-store'

// Where daemon-connection hands over what language servers said. Kept apart from the client so the
// connection does not import the editor's whole language layer (which imports the connection back).

type Listener = (hostId: HostId, event: LspEvent) => void

let listener: Listener | null = null

/** Called by the LSP client once it is loaded; events before that have nobody to go to. */
export function onLspEvent(next: Listener): void {
  listener = next
}

export function dispatchLspEvent(hostId: HostId, event: LspEvent): void {
  listener?.(hostId, event)
}
