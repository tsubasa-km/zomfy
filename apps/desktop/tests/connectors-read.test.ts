import { describe, expect, test } from 'bun:test'
import type { ChatMcpServer } from '@zomfy/protocol'
import {
  CONNECTORS_FRESH_MS,
  connectorsReadNeeded,
  shownConnectors
} from '../src/components/right-sidebar/session-panel/connectors-read.ts'

const server = (name: string, status: ChatMcpServer['status'] = 'connected'): ChatMcpServer => ({
  name,
  status,
  scope: null,
  transport: null,
  tools: [],
  harness: false
})

describe('the Session panel’s connectors read', () => {
  const now = 1_000_000

  test('reads a chat it knows nothing of', () => {
    expect(connectorsReadNeeded(undefined, now)).toBe(true)
    expect(shownConnectors(undefined)).toBeNull()
  })

  test('shows a recent, settled list again without asking', () => {
    const known = { servers: [server('notion')], readAt: now - 5_000 }
    expect(connectorsReadNeeded(known, now)).toBe(false)
    expect(shownConnectors(known)?.map((s) => s.name)).toEqual(['notion'])
  })

  test('asks again once the list is old, failed or still connecting', () => {
    expect(connectorsReadNeeded({ servers: [server('notion')], readAt: now - CONNECTORS_FRESH_MS - 1 }, now)).toBe(true)
    expect(connectorsReadNeeded({ servers: [], readAt: now, stale: true }, now)).toBe(true)
    expect(connectorsReadNeeded({ servers: [server('github', 'pending')], readAt: now }, now)).toBe(true)
  })

  test('a list only being loaded (never answered) is not shown as read', () => {
    const known = { servers: [] }
    expect(shownConnectors(known)).toBeNull()
    expect(connectorsReadNeeded(known, now)).toBe(true)
  })
})
