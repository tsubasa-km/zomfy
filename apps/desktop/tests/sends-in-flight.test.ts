import { expect, test } from 'bun:test'
import { SendsInFlight } from '../src/lib/sends-in-flight.ts'

const idle = { status: 'idle' as const, turnStartedAt: null }

test('a host report from before it took the prompt does not end the turn that is starting', () => {
  const sends = new SendsInFlight()
  sends.start('chat', 100)
  // Shown as idle, Stop would turn back into Send and the queue would send its next message.
  expect(sends.shown('chat', idle)).toEqual({ status: 'working', turnStartedAt: 100 })
  expect(sends.has('chat')).toBe(true)
})

test('the host reporting the turn takes over', () => {
  const sends = new SendsInFlight()
  const token = sends.start('chat', 100)
  expect(sends.shown('chat', { status: 'working', turnStartedAt: 120 })).toEqual({ status: 'working', turnStartedAt: 120 })
  expect(sends.has('chat')).toBe(false)
  expect(sends.shown('chat', idle)).toEqual(idle)
  expect(sends.finish('chat', token)).toBeNull()
})

test('a turn that ended before any report showed it running applies when its request settles', () => {
  const sends = new SendsInFlight()
  const token = sends.start('chat', 100)
  sends.shown('chat', { status: 'error', turnStartedAt: null })
  expect(sends.finish('chat', token)).toEqual({ status: 'error', turnStartedAt: null })
  expect(sends.has('chat')).toBe(false)
})

test('a send that a later one replaced leaves the later one in flight', () => {
  const sends = new SendsInFlight()
  const first = sends.start('chat', 100)
  sends.start('chat', 200)
  expect(sends.finish('chat', first)).toBeNull()
  expect(sends.shown('chat', idle)).toEqual({ status: 'working', turnStartedAt: 200 })
})

test('other chats are untouched', () => {
  const sends = new SendsInFlight()
  sends.start('chat', 100)
  expect(sends.shown('other', idle)).toEqual(idle)
})
