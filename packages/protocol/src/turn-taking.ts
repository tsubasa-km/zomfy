import type { SessionInfo } from './sessions'

/**
 * Whose turn a thread is, as every client shows it (docs/specs/turn-taking-states.md):
 * - `needs-answer`: a question, approval or split confirmation waits, or the last turn failed.
 * - `working`: a turn runs.
 * - `background`: the turn ended but background tasks run or a wake-up is due; it goes on by itself.
 * - `your-turn`: the agent handed the thread back and nothing is going on.
 * - `quiet`: the person has seen it and it has been untouched for a while, or it never ran a turn.
 */
export type TurnPhase = 'needs-answer' | 'working' | 'background' | 'your-turn' | 'quiet'

/** How long a seen thread stays Your turn after its last activity, by default. */
export const DEFAULT_QUIET_AFTER_MS = 24 * 60 * 60_000

type PhaseFields = Pick<SessionInfo, 'status' | 'background' | 'yourTurnSince' | 'seenAt' | 'lastActivityAt' | 'createdAt'>

/** Background work is running or due: tasks, or a wake-up still to fire. */
export function hasBackgroundWork(info: Pick<SessionInfo, 'background'>): boolean {
  const background = info.background
  return !!background && (background.tasks.length > 0 || background.wakeUps.length > 0)
}

/** The next time the thread wakes itself, if a wake-up says. */
export function nextWakeUpAt(info: Pick<SessionInfo, 'background'>): number | null {
  const times = (info.background?.wakeUps ?? []).flatMap((w) => (w.at === null ? [] : [w.at]))
  return times.length > 0 ? Math.min(...times) : null
}

/**
 * The thread's turn-taking state. `quietAfterMs` null never lets a thread go quiet. A daemon that
 * predates `yourTurnSince` reads as Your turn for a thread whose last turn was within `quietAfterMs`.
 */
export function turnPhase(info: PhaseFields, now: number, quietAfterMs: number | null = DEFAULT_QUIET_AFTER_MS): TurnPhase {
  if (info.status === 'needs-you' || info.status === 'error') return 'needs-answer'
  if (info.status === 'working') return 'working'
  if (hasBackgroundWork(info)) return 'background'
  const lastActivity = info.lastActivityAt ?? null
  const stale = quietAfterMs !== null && lastActivity !== null && now - lastActivity >= quietAfterMs
  if (info.yourTurnSince === undefined) {
    // An older daemon: only when a turn last ended is known.
    return lastActivity !== null && !stale ? 'your-turn' : 'quiet'
  }
  if (info.yourTurnSince === null) return 'quiet'
  const seen = info.seenAt != null && info.seenAt >= info.yourTurnSince
  return seen && stale ? 'quiet' : 'your-turn'
}

/** Most pressing first: a parent row shows the most pressing of itself and the chats under it. */
export const TURN_PHASE_RANK: Readonly<Record<TurnPhase, number>> = {
  'needs-answer': 0,
  working: 1,
  background: 2,
  'your-turn': 3,
  quiet: 4
}

/**
 * The state a thread's row shows with the chats under it (helpers, workers, side chats): a child
 * that needs an answer, works or has background work lifts the row; a child's Your turn or Quiet
 * does not.
 */
export function foldedTurnPhase(own: TurnPhase, children: readonly TurnPhase[]): TurnPhase {
  let top = own
  for (const child of children) {
    if (child === 'your-turn' || child === 'quiet') continue
    if (TURN_PHASE_RANK[child] < TURN_PHASE_RANK[top]) top = child
  }
  return top
}
