import { describe, expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { SESSION_REPLAY_META } from '@acp-harness/protocol'
import { spliceReplay } from '../src/lib/replay-splice.ts'

const text = (t: string, meta?: Record<string, unknown>): acp.SessionNotification => ({
  sessionId: 's',
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } },
  ...(meta ? { _meta: meta } : {})
})
const replay = (t: string) => text(t, { [SESSION_REPLAY_META.replay]: true })
const live = (t: string, seq: number) => text(t, { [SESSION_REPLAY_META.seq]: seq })
const words = (list: acp.SessionNotification[]) =>
  list.map((n) => (n.update.sessionUpdate === 'agent_message_chunk' && n.update.content.type === 'text' ? n.update.content.text : '?'))

describe('spliceReplay', () => {
  test('drops live updates the replay already holds and puts later ones after it', () => {
    const buffered = [live('a', 4), replay('a'), live('c', 6), replay('b'), live('b', 5)]
    expect(words(spliceReplay(buffered, 5))).toEqual(['a', 'b', 'c'])
  })

  test('an older daemon (no marker) keeps arrival order', () => {
    const buffered = [text('a'), text('b'), text('c')]
    expect(spliceReplay(buffered, undefined)).toEqual(buffered)
  })
})
