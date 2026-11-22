import { describe, expect, test } from 'bun:test'
import { TURN_RECOVERY_META } from '@zomfy/protocol'
import { STOPPED_TOOL, stopOpenTools, updatedToolStatus } from '../src/stopped-tools.ts'

describe('stopped tool calls', () => {
  test("the daemon's stopped update reads as stopped, not failed", () => {
    expect(updatedToolStatus('failed', { [TURN_RECOVERY_META.toolStopped]: true })).toBe(STOPPED_TOOL)
    expect(updatedToolStatus('failed', undefined)).toBe('failed')
    expect(updatedToolStatus('completed', {})).toBe('completed')
  })

  test('a turn-end notice closes the calls an older transcript left open', () => {
    const items = [
      { kind: 'tool', id: 'done', status: 'completed' },
      { kind: 'tool', id: 'task', status: 'pending' },
      { kind: 'tool', id: 'child', status: 'in_progress' },
      { kind: 'tool', id: 'bad', status: 'failed' },
      { kind: 'agent', text: 'hi' }
    ]
    expect(stopOpenTools(items).map((i) => ('status' in i ? i.status : i.kind))).toEqual(['completed', STOPPED_TOOL, STOPPED_TOOL, 'failed', 'agent'])
    const closed = items.filter((i) => i.status !== 'pending' && i.status !== 'in_progress')
    expect(stopOpenTools(closed)).toBe(closed)
  })
})
