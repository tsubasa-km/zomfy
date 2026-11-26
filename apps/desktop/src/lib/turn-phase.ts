import { nextWakeUpAt, turnPhase, type SessionInfo, type TurnPhase } from '@zomfy/protocol'
import type { AgentDotState } from '@/components/AgentStateDot'
import { getSetting, useSetting } from '@/stores/settings-store'
import { t } from '@/i18n/i18n'

// docs/specs/turn-taking-states.md: whose turn a thread is, in the marks every surface of the window
// uses (sidebar, tab, thread, session panel). The words are for tooltips and screen readers only.

export type { TurnPhase }

type PhaseInput = Parameters<typeof turnPhase>[0]

/** The Quiet after setting in ms; null never goes quiet. */
export function quietAfterMs(hours: number): number | null {
  return hours > 0 ? hours * 60 * 60_000 : null
}

/** The thread's state now, with the Quiet after setting. */
export function phaseOf(session: PhaseInput, now = Date.now(), hours = getSetting('chatQuietAfterHours')): TurnPhase {
  return turnPhase(session, now, quietAfterMs(hours))
}

/** The Quiet after setting, for components that work a phase out on render. */
export function useQuietAfterHours(): number {
  return useSetting('chatQuietAfterHours')
}

/** The state's name, as a label or a tooltip. A failed turn is a kind of Needs your answer, named as such. */
export function turnPhaseLabel(phase: TurnPhase, status?: SessionInfo['status']): string {
  switch (phase) {
    case 'needs-answer':
      return status === 'error' ? t('Failed') : t('Needs your answer')
    case 'working':
      return t('Working')
    case 'background':
      return t('Background work running')
    case 'your-turn':
      return t('Your turn')
    case 'quiet':
      return t('Quiet')
  }
}

/** The state's mark; Quiet has none. */
export function turnPhaseDot(phase: TurnPhase, status?: SessionInfo['status']): AgentDotState | null {
  switch (phase) {
    case 'needs-answer':
      return status === 'error' ? 'failed' : 'waiting'
    case 'working':
      return 'working'
    case 'background':
      return 'monitoring'
    case 'your-turn':
      return 'your-turn'
    case 'quiet':
      return null
  }
}

/** "14:30", or a date and time when it is not today. */
export function wakeTime(at: number, now = Date.now()): string {
  const when = new Date(at)
  const sameDay = new Date(now).toDateString() === when.toDateString()
  return sameDay
    ? when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * When background work wakes, as a bare time ("14:30") for beside the Activity mark; null while
 * tasks run or nothing is scheduled. A row shows marks and values, not words (docs/specs/ui-principles.md).
 */
export function backgroundWakeLabel(session: Pick<SessionInfo, 'background'>, now = Date.now()): string | null {
  if ((session.background?.tasks.length ?? 0) > 0) return null
  const at = nextWakeUpAt(session)
  return at === null ? null : wakeTime(at, now)
}

/** What runs in the background, for the thread's line: "bun test", or "bun test and 2 more". */
export function backgroundTasksLabel(session: Pick<SessionInfo, 'background'>): string {
  const tasks = session.background?.tasks ?? []
  return tasks.length > 2 ? t('{first} and {n} more', { first: tasks[0]!, n: tasks.length - 1 }) : tasks.join(', ')
}

/** A tooltip's line: what runs and when it wakes, e.g. "bun test · wakes at 14:30". */
export function backgroundSummary(session: Pick<SessionInfo, 'background'>, now = Date.now()): string {
  const at = nextWakeUpAt(session)
  return [
    backgroundTasksLabel(session),
    at === null ? '' : t('wakes at {time}', { time: wakeTime(at, now) })
  ]
    .filter(Boolean)
    .join(' · ')
}
