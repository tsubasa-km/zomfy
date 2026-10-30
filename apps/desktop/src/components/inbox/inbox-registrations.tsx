import { useMemo } from 'react'
import { Inbox } from 'lucide-react'
import { useStore } from '@/session-store'
import { getInbox, setInboxOpen, useInbox } from '@/stores/inbox-store'
import { openManager } from '@/manager/open-manager'
import { registerStatusBarItem } from '@/components/status-bar/status-bar-registry'
import { Segment } from '@/components/status-bar/status-bar-segments'
import { registerCommandHandler, useShortcutLabel } from '@/keybindings/keybinding-registry'
import { cn } from '@/lib/utils'
import { inboxEntries } from './inbox-entries'
import { t } from '@/i18n/i18n'

/** Everything waiting on the person: approvals and questions, unread finishes, open todos. */
function useInboxCounts(): { total: number; urgent: number } {
  const sessions = useStore((s) => s.sessions)
  const unread = useStore((s) => s.unread)
  const openTodos = useInbox((s) => s.todos.filter((t) => !t.done).length)
  return useMemo(() => {
    const entries = inboxEntries(sessions, unread)
    const urgent = entries.filter((e) => e.kind !== 'finished').length
    return { total: entries.length + openTodos, urgent }
  }, [sessions, unread, openTodos])
}

function InboxSegment() {
  const { total, urgent } = useInboxCounts()
  const shortcut = useShortcutLabel('inbox.toggle')
  return (
    <Segment
      label={t(total === 1 ? 'Inbox, {n} item' : 'Inbox, {n} items', { n: total })}
      tooltip={`${t('Inbox: {urgent} waiting on you, {review} to review', { urgent, review: total - urgent })}${shortcut ? ` (${shortcut})` : ''}`}
      onClick={() => setInboxOpen(!getInbox().open)}
      className={cn(urgent > 0 && 'text-agent-question-text')}
    >
      <Inbox className="size-3" />
      <span className="tabular-nums" data-inbox-count>
        {total}
      </span>
    </Segment>
  )
}

/** Status bar badge and the inbox / manager shortcuts; called once at startup. */
export function installInbox(): void {
  registerStatusBarItem({ id: 'inbox', label: t('Inbox'), side: 'left', order: 15, render: () => <InboxSegment /> })
  registerCommandHandler('inbox.toggle', () => setInboxOpen(!getInbox().open))
  registerCommandHandler('manager.open', () => {
    void openManager()
  })
}
