import { describe, expect, test } from 'bun:test'
import { isChildThread, marksUnread, parentThread, speaksToPerson } from '../src/lib/child-threads'
import { inboxEntries } from '../src/components/inbox/inbox-entries'
import type { Session } from '../src/session-store'

// A thread another thread started is quiet toward the person: no finish notification, unread mark,
// Inbox entry or tray dot; its asks still reach them once, named by the thread it works for.

const lead = { id: 'lead', title: 'Lead' }
const helper = { id: 'helper', title: 'Helper', parentId: 'lead' }

describe('child threads', () => {
  test('a thread with a parent is a child; side chats and the person’s own threads are not', () => {
    expect(isChildThread(helper)).toBe(true)
    expect(isChildThread(lead)).toBe(false)
    expect(isChildThread({ ...lead, sideOf: 'lead' } as typeof lead)).toBe(false)
  })

  test('a child speaks to the person only when it needs them', () => {
    expect(speaksToPerson(helper, 'idle', false)).toBe(false)
    expect(speaksToPerson(helper, 'error', false)).toBe(false)
    expect(speaksToPerson(helper, 'needs-you', false)).toBe(true)
    expect(speaksToPerson(lead, 'idle', false)).toBe(true)
  })

  test('a child gets no unread mark', () => {
    expect(marksUnread(helper, false)).toBe(false)
    expect(marksUnread(lead, false)).toBe(true)
  })

  test('Helper threads brings a child’s own notifications and unread marks back', () => {
    expect(speaksToPerson(helper, 'idle', true)).toBe(true)
    expect(marksUnread(helper, true)).toBe(true)
  })

  test('a child’s ask is named by its parent', () => {
    expect(parentThread(helper, [lead, helper])).toBe(lead)
    expect(parentThread(lead, [lead, helper])).toBeNull()
    expect(parentThread(helper, [helper])).toBeNull()
  })

  test('a child without an unread mark leaves no finished entry in the Inbox; its ask stays', () => {
    const session = (fields: Partial<Session>) => ({ hostId: 'local', workspaceId: 'w', status: 'idle', items: [], loaded: true, ...fields }) as Session
    const unread = marksUnread(helper, false) ? { helper: true as const } : {}
    expect(inboxEntries([session(helper)], unread)).toEqual([])
    const asking = session({ ...helper, status: 'needs-you' })
    expect(inboxEntries([asking], unread).map((e) => e.kind)).toEqual(['needs-you'])
  })
})
