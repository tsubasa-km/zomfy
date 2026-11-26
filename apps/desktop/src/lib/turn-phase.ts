import { nextWakeUpAt, turnPhase, type SessionInfo, type TurnPhase } from '@zomfy/protocol'
import type { AgentDotState } from '@/components/AgentStateDot'
import { getSetting, useSetting } from '@/stores/settings-store'
import { t } from '@/i18n/i18n'

// docs/specs/turn-taking-states.md: whose turn a thread is, in the words and marks every surface
// of the window uses (sidebar, tab, thread, session panel).

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

/** A row's short word for background work: "Background" while tasks run, else when it wakes. */
export function backgroundShortLabel(session: Pick<SessionInfo, 'background'>, now = Date.now()): string {
  if ((session.background?.tasks.length ?? 0) > 0) return t('Background')
  const at = nextWakeUpAt(session)
  return at === null ? t('Background') : t('Wakes {time}', { time: wakeTime(at, now) })
}

/** One line for the thread: what runs and when it wakes, e.g. "bun test · wakes at 14:30". */
export function backgroundSummary(session: Pick<SessionInfo, 'background'>, now = Date.now()): string {
  const tasks = session.background?.tasks ?? []
  const at = nextWakeUpAt(session)
  return [
    tasks.length > 2 ? t('{first} and {n} more', { first: tasks[0]!, n: tasks.length - 1 }) : tasks.join(', '),
    at === null ? '' : t('wakes at {time}', { time: wakeTime(at, now) })
  ]
    .filter(Boolean)
    .join(' · ')
}
