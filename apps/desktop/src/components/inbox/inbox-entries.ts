import type { Session, StoreState, ThreadItem } from '@/session-store'

// What waits on the person, derived from the hosts' session status (daemon-owned) plus this
// window's pending approvals and unread marks. Presentation only: nothing here decides status.

export type Approval = Extract<ThreadItem, { kind: 'permission' }>

export type InboxEntry =
  /** An approval or question this window can answer inline. */
  | { kind: 'approval'; session: Session; approval: Approval }
  /** Needs the person, but the request is held elsewhere (another window) or not loaded here. */
  | { kind: 'needs-you'; session: Session }
  /** A turn ended (or failed) and the person has not looked yet. */
  | { kind: 'finished'; session: Session }

export function pendingApprovals(session: Session): Approval[] {
  return session.items.filter((i): i is Approval => i.kind === 'permission' && i.chosen === null)
}

export function inboxEntries(sessions: Session[], unread: StoreState['unread']): InboxEntry[] {
  const entries: InboxEntry[] = []
  for (const session of sessions) {
    const approvals = pendingApprovals(session)
    for (const approval of approvals) entries.push({ kind: 'approval', session, approval })
    if (approvals.length === 0 && session.status === 'needs-you') entries.push({ kind: 'needs-you', session })
  }
  for (const session of sessions) {
    if (unread[session.id] && session.status !== 'working' && session.status !== 'needs-you') {
      entries.push({ kind: 'finished', session })
    }
  }
  return entries
}

/** AskUserQuestion-style requests carry `questions`; they read as questions, not tool approvals. */
export function questionsOf(approval: Approval): string[] {
  const input = approval.input
  if (typeof input !== 'object' || input === null || !('questions' in input) || !Array.isArray(input.questions)) return []
  return input.questions.flatMap((q: unknown) =>
    typeof q === 'object' && q !== null && 'question' in q && typeof q.question === 'string' ? [q.question] : []
  )
}
