import type { SessionStatus } from '@zomfy/protocol'

/** A chat's turn state as a host reports it. */
export interface ReportedTurn {
  status: SessionStatus
  turnStartedAt: number | null
}

/**
 * Prompts this window sent that the host has not yet reported running. Until it does, a session list
 * the host sent before it took the prompt still says idle: shown as is, the Stop button would turn
 * back into Send (and a second send would replace the first turn), and the follow-up queue would
 * send its next message into the turn that is only starting.
 */
export class SendsInFlight {
  private sends = new Map<string, { token: symbol; sentAt: number; held: ReportedTurn | null }>()

  /** Returns the send's token, for `finish`: a later send to the same chat takes its place. */
  start(sessionId: string, sentAt: number): symbol {
    const token = Symbol(sessionId)
    this.sends.set(sessionId, { token, sentAt, held: null })
    return token
  }

  has(sessionId: string): boolean {
    return this.sends.has(sessionId)
  }

  /** What to show for a host's report: working while the send is in flight and the host has not caught up. */
  shown(sessionId: string, reported: ReportedTurn): ReportedTurn {
    const send = this.sends.get(sessionId)
    if (!send) return reported
    if (reported.status === 'working' || reported.status === 'needs-you') {
      this.sends.delete(sessionId)
      return reported
    }
    send.held = reported
    return { status: 'working', turnStartedAt: send.sentAt }
  }

  /**
   * The prompt's request settled: the host's latest report, held back while it was in flight, is
   * the truth now. Null when nothing was held back, or another send has taken this one's place.
   */
  finish(sessionId: string, token: symbol): ReportedTurn | null {
    const send = this.sends.get(sessionId)
    if (send?.token !== token) return null
    this.sends.delete(sessionId)
    return send.held
  }
}
