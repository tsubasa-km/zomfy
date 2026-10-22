import type { SessionInfo } from './sessions'

// Picking a chat back up after its turn stopped short: Continue after an interruption, Retry after
// an error, Resume after a usage limit, and the daemon's own resume once that limit resets.

/** `_meta` keys on session updates (other clients ignore them). */
export const TURN_RECOVERY_META = {
  /** notice: how the turn before it ended (TurnEndMeta). */
  turnEnd: 'harness/turnEnd',
  /** user_message_chunk: the prompt was a recovery, not typed (TurnResumeKind); shown as a divider. */
  resumed: 'harness/resumed'
} as const

export type TurnEndMeta =
  /** Stopped before it finished: the user's Stop, or the daemon going away mid-turn. */
  | { reason: 'interrupted' }
  /** Claude refused for a plan usage/rate limit; `resetsAt` (epoch ms) when the limit said. */
  | { reason: 'usage-limit'; resetsAt: number | null }
  | { reason: 'error' }

/** 'moved': the chat moved to another workspace mid-task and continues there. */
export type TurnResumeKind = 'continue' | 'retry' | 'resume' | 'auto' | 'moved'

/** The daemon's scheduled resume of a usage-limited chat. Kept on the session, so it is persisted. */
export interface AutoResumeState {
  /** Epoch ms the daemon resumes at. */
  fireAt: number
  /** False when the limit gave no reset time and the daemon is retrying with backoff. */
  resetKnown: boolean
  /** Resumes that ran into the limit again; drives the backoff. */
  attempt: number
}

export const TURN_RECOVERY_METHODS = {
  /** Starts a recovery turn now; returns once it has started. */
  sessionResumeTurn: '_harness/sessions/resumeTurn',
  sessionSetAutoResume: '_harness/sessions/setAutoResume'
} as const

export const TURN_RECOVERY_NOTIFICATIONS = {
  /** The daemon resumed a chat on its own (a usage limit reset). */
  autoResumed: '_harness/sessions/autoResumed'
} as const

export interface TurnRecoveryRequests {
  [TURN_RECOVERY_METHODS.sessionResumeTurn]: {
    params: { sessionId: string; kind: Exclude<TurnResumeKind, 'auto'> }
    result: Record<string, never>
  }
  /** `resetsAt` (epoch ms) is the limit's reset when the client knows it; the daemon falls back to backoff. */
  [TURN_RECOVERY_METHODS.sessionSetAutoResume]: {
    params: { sessionId: string; enabled: boolean; resetsAt?: number | null }
    result: SessionInfo
  }
}
