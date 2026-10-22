import { createSession } from '@/daemon-connection'
import { LOCAL_HOST, floatingWorkspaceId, getState, selectSession } from '@/session-store'

/**
 * Focuses the Manager chat, starting one on first use. It lives in this computer's floating
 * workspace (no project of its own) and reaches every host through this window.
 */
export async function openManager(): Promise<boolean> {
  const floating = floatingWorkspaceId()
  if (!floating) return false
  const existing = getState().sessions.find((s) => s.role === 'manager' && s.hostId === LOCAL_HOST)
  const id = existing?.id ?? (await createSession(floating, undefined, { hostId: LOCAL_HOST, role: 'manager' }))
  selectSession(id)
  return true
}
