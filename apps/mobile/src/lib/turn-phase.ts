import { nextWakeUpAt, turnPhase, type SessionInfo, type TurnPhase } from '@zomfy/protocol'
import type { Translate } from './i18n'

// docs/specs/turn-taking-states.md: the same five states as the desktop, for the thread list and the
// chat screen. A row shows the state's mark, not its name (docs/specs/ui-principles.md); the name is
// for screen readers. No React Native imports, so it is tested with bun.

export type { TurnPhase }

type PhaseFields = Parameters<typeof turnPhase>[0]

export function phaseOf(info: PhaseFields, now = Date.now()): TurnPhase {
  return turnPhase(info, now)
}

/** The state's name, for a screen reader; Quiet says nothing. */
export function phaseText(info: PhaseFields & Pick<SessionInfo, 'background'>, t: Translate, now = Date.now()): string | null {
  switch (phaseOf(info, now)) {
    case 'needs-answer':
      return info.status === 'error' ? t('Error') : t('Needs your answer')
    case 'working':
      return t('Working')
    case 'background': {
      if ((info.background?.tasks.length ?? 0) > 0) return t('Background work running')
      const at = nextWakeUpAt(info)
      return at === null
        ? t('Background work running')
        : t('Wakes {time}', { time: new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })
    }
    case 'your-turn':
      return t('Your turn')
    case 'quiet':
      return null
  }
}

/** The one value a row shows beside its mark: when background work wakes ("14:30"); else null. */
export function phaseValue(info: PhaseFields & Pick<SessionInfo, 'background'>, now = Date.now()): string | null {
  if (phaseOf(info, now) !== 'background' || (info.background?.tasks.length ?? 0) > 0) return null
  const at = nextWakeUpAt(info)
  return at === null ? null : new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
