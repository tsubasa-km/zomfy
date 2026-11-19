import { SquareTerminal } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { continueInTerminal, continueInTerminalUnavailableReason } from '@/chat-actions'
import type { Session } from '@/session-store'
import { t } from '@/i18n/i18n'

// "Continue in Terminal": the thread's conversation in the `claude` CLI, which is reported to use
// less of the usage limit than a chat does for the same work. Offered beside "Fork Thread".

const HINT = () => t('Run this conversation in the claude CLI, which is reported to use less of the usage limit. The thread picks it up again on its next message.')

function Label({ reason }: { reason: string | null }) {
  return (
    <>
      <SquareTerminal className="size-3.5" />
      {t('Continue in Terminal')}
      {reason ? <span className="ml-auto pl-3 text-xs text-muted-foreground">{reason}</span> : null}
    </>
  )
}

/** In a chat tab's menu. */
export function ContinueInTerminalTabMenuItem({ session }: { session: Session }) {
  const reason = continueInTerminalUnavailableReason(session)
  return (
    <DropdownMenuItem data-menu-action="continue-in-terminal" title={HINT()} disabled={reason !== null} onSelect={() => void continueInTerminal(session.id)}>
      <Label reason={reason} />
    </DropdownMenuItem>
  )
}

/** In the thread's own right-click menu. */
export function ContinueInTerminalContextMenuItem({ session }: { session: Session }) {
  const reason = continueInTerminalUnavailableReason(session)
  return (
    <ContextMenuItem data-native-chat-continue-in-terminal title={HINT()} disabled={reason !== null} onSelect={() => void continueInTerminal(session.id)}>
      <Label reason={reason} />
    </ContextMenuItem>
  )
}
