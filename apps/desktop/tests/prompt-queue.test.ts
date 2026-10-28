import { expect, test } from 'bun:test'
import { QUEUE_PAUSED_BY_FAILURE, queueOnStatus } from '../src/stores/prompt-queue.ts'

const queued = { queue: [{ id: 'm', text: 'next', images: [] }], queuePaused: false }

test('a turn that ends sends the next queued message', () => {
  expect(queueOnStatus(queued, 'idle')).toEqual({ kind: 'send' })
})

test('a failed turn pauses the queue and says why, instead of leaving it stuck', () => {
  expect(queueOnStatus(queued, 'error')).toEqual({ kind: 'pause', reason: QUEUE_PAUSED_BY_FAILURE })
})

test('a paused or empty queue, or a turn still going, does nothing', () => {
  expect(queueOnStatus({ ...queued, queuePaused: true }, 'idle')).toBeNull()
  expect(queueOnStatus({ queue: [], queuePaused: false }, 'error')).toBeNull()
  expect(queueOnStatus(queued, 'working')).toBeNull()
  expect(queueOnStatus(queued, 'needs-you')).toBeNull()
})
