import { TURN_RECOVERY_META, type TurnEndMeta } from '@zomfy/protocol'

/** How the turn before a notice ended, from the notice's `_meta`; null when it says nothing known. */
export function turnEndMeta(meta: Record<string, unknown> | null | undefined): TurnEndMeta | null {
  const value = meta?.[TURN_RECOVERY_META.turnEnd]
  if (typeof value !== 'object' || value === null || !('reason' in value)) return null
  switch (value.reason) {
    case 'interrupted':
      return { reason: 'interrupted' }
    case 'error':
      // docs/specs/claude-sign-in.md: signing in again is what fixes it.
      return 'signIn' in value && value.signIn === 'claude' ? { reason: 'error', signIn: 'claude' } : { reason: 'error' }
    case 'usage-limit': {
      const resetsAt = 'resetsAt' in value && typeof value.resetsAt === 'number' ? value.resetsAt : null
      return { reason: 'usage-limit', resetsAt }
    }
    default:
      return null
  }
}
