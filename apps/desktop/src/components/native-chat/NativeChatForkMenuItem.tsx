import { GitFork } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { forkChat, forkUnavailableReason } from '@/chat-actions'
import type { Session } from '@/session-store'
import { t } from '@/i18n/i18n'

/** "Fork Chat" in a chat tab's menu; other agents' chats show it disabled, with the reason. */
export function ForkChatTabMenuItem({ session }: { session: Session }) {
  const reason = forkUnavailableReason(session)
  return (
    <DropdownMenuItem data-menu-action="fork-chat" disabled={reason !== null} onSelect={() => void forkChat(session.id)}>
      <GitFork className="size-3.5" />
      {t('Fork Chat')}
      {reason ? <span className="ml-auto pl-3 text-xs text-muted-foreground">{t('Claude only')}</span> : null}
    </DropdownMenuItem>
  )
}
