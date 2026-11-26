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
import { useBots } from '@/stores/bots-store'
import { t } from '@/i18n/i18n'

/** Everything waiting on the person: approvals and questions, unread finishes, open todos. */
function useInboxCounts(): { total: number; urgent: number; requests: number } {
  // Counted in the selector and handed out as a string, so a chat streaming does not redraw the status bar.
  const counts = useStore((s) => {
    const entries = inboxEntries(s.sessions, s.unread)
    return `${entries.length} ${entries.filter((e) => e.kind !== 'finished').length}`
  })
  const openTodos = useInbox((s) => s.todos.filter((t) => !t.done).length)
  const accessRequests = useBots((s) => s.accessRequests.length + s.notices.length)
  return useMemo(() => {
    const [entries, urgent] = counts.split(' ').map(Number)
    return { total: entries! + openTodos + accessRequests, urgent: urgent! + accessRequests, requests: accessRequests }
  }, [counts, openTodos, accessRequests])
}

function InboxSegment() {
  const { total, urgent, requests } = useInboxCounts()
  const shortcut = useShortcutLabel('inbox.toggle')
  return (
    <Segment
      label={t(total === 1 ? 'Inbox, {n} item' : 'Inbox, {n} items', { n: total })}
      tooltip={`${t('Inbox: {urgent} waiting on you, {review} to review', { urgent, review: total - urgent })}${shortcut ? ` (${shortcut})` : ''}`}
      onClick={() => setInboxOpen(!getInbox().open)}
      // The agents segment beside it already turns orange for chats waiting on the person; two orange
      // counts for one fact read as twice as urgent. Only bots' requests, which nothing else shows, colour it.
      className={cn(requests > 0 && 'text-agent-question-text')}
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
