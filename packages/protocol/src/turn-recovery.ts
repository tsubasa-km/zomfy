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

/**
 * `_meta` key on a user_message_chunk the harness wrote rather than the person (PromptOrigin): the
 * chat draws it apart from what they typed.
 */
export const PROMPT_ORIGIN_META = 'harness/promptOrigin'

export type PromptOrigin =
  /** A workflow step's question put to the chat that started the run. */
  | { kind: 'step-question'; from: string; question: string }
  /** A workflow step's instructions to its agent. */
  | { kind: 'step-task'; workflow: string; step: string }

export function promptOrigin(meta: Record<string, unknown> | null | undefined, text: string): PromptOrigin | null {
  const value = meta?.[PROMPT_ORIGIN_META]
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    if (value.kind === 'step-question' && 'from' in value && 'question' in value && typeof value.from === 'string' && typeof value.question === 'string') {
      return { kind: 'step-question', from: value.from, question: value.question }
    }
    if (value.kind === 'step-task' && 'workflow' in value && 'step' in value && typeof value.workflow === 'string' && typeof value.step === 'string') {
      return { kind: 'step-task', workflow: value.workflow, step: value.step }
    }
  }
  return legacyOrigin(text)
}

// Prompts recorded before the marker existed, recognised by the words the harness wrote.
const LEGACY_QUESTION = /^\[Question from (.+)\]\n([\s\S]*?)\n\nAnswer it if you can from this conversation/
const LEGACY_TASK = /^(?:You are (?:the .+|a helper agent) in|Next step in) the workflow "(.+?)"[:,] (?:step )?"(.+?)"/

function legacyOrigin(text: string): PromptOrigin | null {
  const question = LEGACY_QUESTION.exec(text)
  if (question) return { kind: 'step-question', from: question[1]!, question: question[2]!.trim() }
  const task = LEGACY_TASK.exec(text)
  if (task) return { kind: 'step-task', workflow: task[1]!, step: task[2]! }
  return null
}
