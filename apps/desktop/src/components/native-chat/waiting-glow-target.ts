import { createContext } from 'react'
import type { TurnPhase } from '@zomfy/protocol'
import type { NextStepsRow, TranscriptRowModel } from './native-chat-transcript-model'

// docs/specs/composer-waiting-glow.md: the one place in a thread that glows, where the person acts
// next — a waiting question or approval card, the Next steps question, or the composer.

export type WaitingGlowTarget = { at: 'card' } | { at: 'next-steps'; row: NextStepsRow } | { at: 'composer' } | null

/** The thread's last Next steps card, when it asked a question and nothing was sent after it. */
export function openNextStepsQuestion(rows: readonly TranscriptRowModel[]): NextStepsRow | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if (row.kind === 'user') return null
    if (row.kind === 'next-steps') return row.card.question && row.followUp === undefined ? row : null
  }
  return null
}

/** Where the glow goes: a card that waits wins, then on Your turn the Next steps question, else the composer. */
export function waitingGlowTarget(phase: TurnPhase, cardWaiting: boolean, rows: readonly TranscriptRowModel[]): WaitingGlowTarget {
  if (cardWaiting) return { at: 'card' }
  if (phase !== 'your-turn') return null
  const row = openNextStepsQuestion(rows)
  return row ? { at: 'next-steps', row } : { at: 'composer' }
}

/** The Next steps row whose question glows, for the card that draws it. */
export const NextStepsGlowContext = createContext<NextStepsRow | null>(null)
