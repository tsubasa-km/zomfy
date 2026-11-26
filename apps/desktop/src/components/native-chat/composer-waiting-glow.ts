import type { ChatWaitingGlow } from '@/stores/settings-store'

// docs/specs/composer-waiting-glow.md: which pattern a composer's border shows. The patterns
// themselves are composer-waiting-glow.css; Settings previews them with WaitingGlowPreview.

const PATTERNS: readonly ChatWaitingGlow[] = ['rainbow', 'pulse', 'outline']

/**
 * The value of the box's `data-waiting-glow`: absent when the chat does not wait or the glow is
 * off, so an idle composer carries no animation. A saved value Zomfy does not know shows nothing.
 */
export function waitingGlowAttribute(waiting: boolean, pattern: ChatWaitingGlow): Exclude<ChatWaitingGlow, 'off'> | undefined {
  if (!waiting || pattern === 'off' || !PATTERNS.includes(pattern)) return undefined
  return pattern
}
