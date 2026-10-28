import type * as acp from '@agentclientprotocol/sdk'
import { SESSION_REPLAY_META } from '@acp-harness/protocol'

/**
 * Orders what arrived while a `session/load` ran: the replay, then the live updates it does not hold.
 * `through` (newer daemons) is the last live seq the replay holds; without it, arrival order.
 */
export function spliceReplay(buffered: acp.SessionNotification[], through: unknown): acp.SessionNotification[] {
  if (typeof through !== 'number') return buffered
  const isReplay = (n: acp.SessionNotification) => n._meta?.[SESSION_REPLAY_META.replay] === true
  return [
    ...buffered.filter(isReplay),
    ...buffered.filter((n) => {
      if (isReplay(n)) return false
      const seq = n._meta?.[SESSION_REPLAY_META.seq]
      return typeof seq !== 'number' || seq > through
    })
  ]
}
