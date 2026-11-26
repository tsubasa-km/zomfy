import type { SessionStatus } from '@zomfy/protocol'

// A thread another thread started (an agent's create_session or create_workspace, split_work's
// helpers, a workflow's steps, a bot's workers) works for that thread, which reports to the person.
// So it stays quiet toward the person unless it needs them (docs/specs/child-threads-report-home.md).

interface Thread {
  id: string
  title: string
  parentId?: string
}

export function isChildThread(session: Pick<Thread, 'parentId'>): boolean {
  return !!session.parentId
}

/**
 * Whether a status change raises a desktop notification or the tray's dot: always for the person's
 * own threads, for a child only when it needs the person, unless `helperNotifications` is on.
 */
export function speaksToPerson(session: Pick<Thread, 'parentId'>, to: SessionStatus, helperNotifications: boolean): boolean {
  return !isChildThread(session) || helperNotifications || to === 'needs-you'
}

/** Whether a finished or asking thread gets an unread mark (and so an Inbox "finished" entry). */
export function marksUnread(session: Pick<Thread, 'parentId'>, helperNotifications: boolean): boolean {
  return !isChildThread(session) || helperNotifications
}

/** The thread a child works for, as the person knows it; null for the person's own threads or a parent not listed. */
export function parentThread<T extends Thread>(session: Pick<Thread, 'parentId'>, sessions: readonly T[]): T | null {
  return session.parentId ? (sessions.find((s) => s.id === session.parentId) ?? null) : null
}
