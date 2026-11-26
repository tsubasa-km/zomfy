import type { HarnessState, SessionInfo } from '@zomfy/protocol'
import type { HostId } from '@/session-store'
import { WINDOW_ROLE } from './window-role'

// Each host's last listing (projects, workspaces and chats), so a window starts with the sidebar,
// tabs and threads it had when it closed, while the hosts are still connecting, and a WSL or SSH
// host out of reach keeps showing what it had, instead of the screen building up as hosts answer.

const KEY = 'zomfy.host-snapshots.v1'
const SESSIONS_KEY = 'zomfy.session-snapshots.v1'

function read<T>(key: string): Record<HostId, T> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}')
  } catch {
    return {}
  }
}

let snapshots = read<HarnessState>(KEY)
let sessionSnapshots = read<SessionInfo[]>(SESSIONS_KEY)

function persist(key: string, value: unknown): void {
  // Only the main window writes, as with the saved layout.
  if (WINDOW_ROLE !== 'main') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; offline hosts then show nothing until they connect.
  }
}

export function hostSnapshot(hostId: HostId): HarnessState | null {
  return snapshots[hostId] ?? null
}

export function saveHostSnapshot(hostId: HostId, harness: HarnessState): void {
  snapshots = { ...snapshots, [hostId]: harness }
  persist(KEY, snapshots)
}

/** The chats a host listed last, as it sent them. */
export function sessionsSnapshot(hostId: HostId): SessionInfo[] {
  return sessionSnapshots[hostId] ?? []
}

let sessionsTimer: ReturnType<typeof setTimeout> | null = null

/** Chats change often while agents work; the copy is written at most once a second. */
export function saveSessionsSnapshot(hostId: HostId, list: SessionInfo[]): void {
  sessionSnapshots = { ...sessionSnapshots, [hostId]: list }
  if (sessionsTimer !== null) return
  sessionsTimer = setTimeout(() => {
    sessionsTimer = null
    persist(SESSIONS_KEY, sessionSnapshots)
  }, 1000)
}

/** The person removed the host; its projects should not linger. */
export function forgetHostSnapshot(hostId: HostId): void {
  const { [hostId]: _, ...rest } = snapshots
  snapshots = rest
  persist(KEY, snapshots)
  const { [hostId]: _sessions, ...otherSessions } = sessionSnapshots
  sessionSnapshots = otherSessions
  persist(SESSIONS_KEY, sessionSnapshots)
}
