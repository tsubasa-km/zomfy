import { HARNESS_METHODS } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { updateSession, type Session } from '@/session-store'

/**
 * Tells the chat's host the person was shown it since its turn was handed back, so it can go Quiet
 * once left alone (docs/specs/turn-taking-states.md). Shown at once; an older host ignores it.
 */
export function noteChatSeen(session: Pick<Session, 'id' | 'hostId' | 'yourTurnSince' | 'seenAt'>): void {
  const since = session.yourTurnSince
  if (since == null || (session.seenAt != null && session.seenAt >= since)) return
  updateSession(session.id, (s) => ({ ...s, seenAt: Date.now() }))
  void harnessRequest(HARNESS_METHODS.sessionMarkSeen, { sessionId: session.id }, session.hostId).catch(() => undefined)
}
