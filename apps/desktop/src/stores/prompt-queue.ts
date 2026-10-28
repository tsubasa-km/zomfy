import type { SessionStatus } from '@acp-harness/protocol'
import type { ChatSessionState } from './chat-store'

/** What a chat's follow-up queue does when the host reports the chat's new status. */
export type QueueOnStatus = { kind: 'send' } | { kind: 'pause'; reason: string } | null

export const QUEUE_PAUSED_BY_FAILURE = 'The last turn failed'

export function queueOnStatus(chat: Pick<ChatSessionState, 'queue' | 'queuePaused'>, to: SessionStatus): QueueOnStatus {
  if (chat.queue.length === 0 || chat.queuePaused) return null
  if (to === 'idle') return { kind: 'send' }
  // Follow-ups were written for a turn that worked, and would likely fail the same way (a usage limit, sign-in).
  if (to === 'error') return { kind: 'pause', reason: QUEUE_PAUSED_BY_FAILURE }
  return null
}
