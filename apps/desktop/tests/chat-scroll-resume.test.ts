import { expect, test } from 'bun:test'
import { resumesAtLatest } from '@/lib/chat-scroll-resume'

test('a chat opens at its latest message unless it was left mid-way with nothing new since', () => {
  expect(resumesAtLatest(undefined, 10)).toBe(true)
  expect(resumesAtLatest({ stick: true, items: 10 }, 10)).toBe(true)
  expect(resumesAtLatest({ stick: false, items: 10 }, 12)).toBe(true)
  expect(resumesAtLatest({ stick: false, items: 10 }, 10)).toBe(false)
})
