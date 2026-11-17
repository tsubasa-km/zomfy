import { useSyncExternalStore } from 'react'
import type { Session } from '@/session-store'
import { t } from '@/i18n/i18n'

// The sidebar's chat list: every chat of every project in one list, ordered by what needs the
// person rather than by where it lives. A workflow's step chats and a side chat stay folded under
// the chat they work for.

export type ChatSectionId = 'pinned' | 'needs-you' | 'working' | 'recent' | 'archived'

export interface ChatNode {
  chat: Session
  children: Session[]
  /** The most pressing state of the chat and the chats under it. */
  status: Session['status']
}

const RANK: Record<Session['status'], number> = { 'needs-you': 0, error: 1, working: 2, idle: 3 }

function parentOf(session: Session): string | undefined {
  return session.parentId ?? session.sideOf
}

/** When the chat last had the person's or the agent's attention, as far as this window knows. */
export function activityOf(session: Session): number {
  return session.turnStartedAt ?? session.createdAt
}

/** Top-level chats, each with the chats under it; a chat whose parent is not listed stands on its own. */
export function chatTree(sessions: Session[]): ChatNode[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  // The listed chat at the top of a chat's parents; a chat deeper than one level joins that one too.
  const rootOf = (s: Session): Session => {
    const seen = new Set([s.id])
    let at = s
    for (let up = byId.get(parentOf(at) ?? ''); up && !seen.has(up.id); up = byId.get(parentOf(at) ?? '')) {
      seen.add(up.id)
      at = up
    }
    return at
  }
  const roots = new Map(sessions.map((s) => [s.id, rootOf(s)]))
  return sessions
    .filter((s) => roots.get(s.id) === s && !s.sideOf)
    .map((chat) => {
      // Children read in the order they were started: a workflow's steps, then its helpers.
      const children = sessions.filter((s) => s !== chat && roots.get(s.id) === chat).sort((a, b) => a.createdAt - b.createdAt)
      const status = [chat, ...children].reduce<Session['status']>((top, s) => (RANK[s.status] < RANK[top] ? s.status : top), 'idle')
      return { chat, children, status }
    })
}

/** Most pressing first, then the most recently active. */
export function byUrgency(a: ChatNode, b: ChatNode): number {
  return RANK[a.status] - RANK[b.status] || activityOf(b.chat) - activityOf(a.chat)
}

/** The list cut by state. Pinned chats keep the order they were pinned in; archived ones sit in their own shelf. */
export function chatSections(nodes: ChatNode[], pinned: string[]): { id: ChatSectionId; nodes: ChatNode[] }[] {
  const pinOrder = new Map(pinned.map((id, i) => [id, i]))
  const live = nodes.filter((n) => !n.chat.archived)
  const rest = live.filter((n) => !pinOrder.has(n.chat.id))
  const recent = (list: ChatNode[]) => [...list].sort((a, b) => activityOf(b.chat) - activityOf(a.chat))
  return [
    { id: 'pinned' as const, nodes: live.filter((n) => pinOrder.has(n.chat.id)).sort((a, b) => pinOrder.get(a.chat.id)! - pinOrder.get(b.chat.id)!) },
    { id: 'needs-you' as const, nodes: recent(rest.filter((n) => n.status === 'needs-you' || n.status === 'error')) },
    { id: 'working' as const, nodes: recent(rest.filter((n) => n.status === 'working')) },
    { id: 'recent' as const, nodes: recent(rest.filter((n) => n.status === 'idle')) },
    { id: 'archived' as const, nodes: recent(nodes.filter((n) => n.chat.archived)) }
  ].filter((section) => section.nodes.length > 0)
}

export function chatSectionLabel(id: ChatSectionId): string {
  switch (id) {
    case 'pinned':
      return t('Pinned')
    case 'needs-you':
      return t('Needs you')
    case 'working':
      return t('Working')
    case 'recent':
      return t('Recent')
    case 'archived':
      return t('Archived')
  }
}

/** "now", "5m", "3h", "2d", then a date: short enough for a row's corner. */
export function compactAge(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return t('now')
  if (minutes < 60) return t('{n}m', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('{n}h', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('{n}d', { n: days })
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// One shared clock for every row's age, so a long list costs one timer.
const TICK_MS = 30_000
let now = Date.now()
const tickListeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const each of tickListeners) each()
    }, TICK_MS)
  }
  return () => {
    tickListeners.delete(listener)
    if (tickListeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** The time, refreshed twice a minute while something shows it. */
export function useCoarseNow(): number {
  return useSyncExternalStore(subscribeTick, () => now)
}
