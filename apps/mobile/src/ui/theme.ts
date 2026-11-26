import type { SessionStatus, TurnPhase } from '@zomfy/protocol'

export const colors = {
  background: '#111214',
  surface: '#1b1d21',
  surfaceRaised: '#25282d',
  border: '#33363c',
  text: '#ececef',
  muted: '#9a9ca3',
  accent: '#7c9cff',
  accentText: '#0d1020',
  danger: '#ff6b6b',
  warning: '#f5b83d',
  success: '#4fd18b',
  userBubble: '#2b3350'
} as const

export const statusColors: Record<SessionStatus, string> = {
  idle: '#6b6e75',
  working: colors.accent,
  'needs-you': colors.warning,
  error: colors.danger
}

/** A thread's turn-taking state (docs/specs/turn-taking-states.md); Quiet is the idle grey. */
export const phaseColors: Record<TurnPhase, string> = {
  'needs-answer': colors.warning,
  working: '#38bdf8',
  background: '#eab308',
  'your-turn': colors.accent,
  quiet: '#6b6e75'
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const
