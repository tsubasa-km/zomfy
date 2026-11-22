import { describe, expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { TURN_RECOVERY_META } from '@zomfy/protocol'
import type { Session } from '../src/session-store.ts'

// The session store reads the window it runs in; a bare stand-in is enough for the transcript.
const store = new Map<string, string>()
Object.assign(globalThis, {
  window: globalThis.window ?? { location: { search: '' }, addEventListener: () => undefined, removeEventListener: () => undefined },
  localStorage: globalThis.localStorage ?? {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  }
})
const { applyChatUpdate } = await import('../src/chat-transcript.ts')
const { addSession, getState, STOPPED_TOOL } = await import('../src/session-store.ts')

function chat(id: string): void {
  addSession({ id, hostId: 'local', workspaceId: 'w', title: 'Chat', status: 'working', items: [], loaded: true } as unknown as Session, false)
}
const send = (sessionId: string, update: acp.SessionUpdate) => applyChatUpdate({ sessionId, update })
const statuses = (sessionId: string) =>
  Object.fromEntries(
    getState()
      .sessions.find((s) => s.id === sessionId)!
      .items.flatMap((i) => (i.kind === 'tool' ? [[i.id, i.status]] : []))
  )

describe('stopped tool calls', () => {
  test("the daemon's stopped update reads as stopped, not failed", () => {
    chat('a')
    send('a', { sessionUpdate: 'tool_call', toolCallId: 'bash', title: 'Bash', status: 'in_progress' })
    send('a', { sessionUpdate: 'tool_call', toolCallId: 'bad', title: 'Read', status: 'in_progress' })
    send('a', { sessionUpdate: 'tool_call_update', toolCallId: 'bash', status: 'failed', _meta: { [TURN_RECOVERY_META.toolStopped]: true } })
    send('a', { sessionUpdate: 'tool_call_update', toolCallId: 'bad', status: 'failed' })
    expect(statuses('a')).toEqual({ bash: STOPPED_TOOL, bad: 'failed' })
  })

  test('a turn-end notice closes the calls an older transcript left open', () => {
    chat('b')
    send('b', { sessionUpdate: 'tool_call', toolCallId: 'done', title: 'Read', status: 'completed' })
    send('b', { sessionUpdate: 'tool_call', toolCallId: 'task', title: 'Task' })
    send('b', { sessionUpdate: 'tool_call', toolCallId: 'child', title: 'Bash', status: 'in_progress' })
    send('b', { sessionUpdate: 'notice', severity: 'info', title: 'Note' } as acp.SessionUpdate)
    expect(statuses('b')).toEqual({ done: 'completed', task: 'pending', child: 'in_progress' })
    send('b', {
      sessionUpdate: 'notice',
      severity: 'warning',
      title: 'Stopped: the daemon restarted during this turn',
      _meta: { [TURN_RECOVERY_META.turnEnd]: { reason: 'interrupted' } }
    } as acp.SessionUpdate)
    expect(statuses('b')).toEqual({ done: 'completed', task: STOPPED_TOOL, child: STOPPED_TOOL })
  })
})
