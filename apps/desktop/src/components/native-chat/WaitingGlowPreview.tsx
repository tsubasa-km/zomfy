import type { ChatWaitingGlow } from '@/stores/settings-store'
import { cn } from '@/lib/utils'
import { waitingGlowAttribute } from './composer-waiting-glow'
import './composer-waiting-glow.css'

/** A composer in miniature, always waiting, showing `pattern` (Settings → Waiting glow). */
export function WaitingGlowPreview({ pattern, className }: { pattern: ChatWaitingGlow; className?: string }) {
  return (
    <span
      aria-hidden
      data-waiting-glow-preview={pattern}
      data-waiting-glow={waitingGlowAttribute(true, pattern)}
      className={cn('inline-block h-4 w-8 shrink-0 rounded-md border border-chat-composer-border bg-chat-composer-surface', className)}
    />
  )
}
