import type { HarnessState } from '@acp-harness/protocol'
import type { HostId } from '@/session-store'
import { WINDOW_ROLE } from './window-role'

// Each host's last listing, so the sidebar keeps showing a WSL or SSH host's projects (dimmed)
// while it is still connecting or out of reach, instead of the list jumping as hosts come up.

const KEY = 'acp-harness.host-snapshots.v1'

function read(): Record<HostId, HarnessState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

let snapshots = read()

function persist(): void {
  // Only the main window writes, as with the saved layout.
  if (WINDOW_ROLE !== 'main') return
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshots))
  } catch {
    // Storage can be unavailable; offline hosts then show nothing until they connect.
  }
}

export function hostSnapshot(hostId: HostId): HarnessState | null {
  return snapshots[hostId] ?? null
}

export function saveHostSnapshot(hostId: HostId, harness: HarnessState): void {
  snapshots = { ...snapshots, [hostId]: harness }
  persist()
}

/** The person removed the host; its projects should not linger. */
export function forgetHostSnapshot(hostId: HostId): void {
  const { [hostId]: _, ...rest } = snapshots
  snapshots = rest
  persist()
}
