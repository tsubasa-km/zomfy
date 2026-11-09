import { expect, test } from 'bun:test'
import { structuredProse } from './claude-turn.ts'

// A turn that answers through its output format shows the answer's prose in the chat, not JSON.

test('the text or summary of a structured answer is what the chat shows', () => {
  expect(structuredProse({ decision: 'answer', text: 'Go with A.' })).toBe('Go with A.')
  expect(structuredProse({ outcome: 'approve', summary: 'Approved.' })).toBe('Approved.')
})

test('an answer with no prose shows nothing', () => {
  expect(structuredProse({ outcome: 'next' })).toBe('')
  expect(structuredProse(null)).toBe('')
  expect(structuredProse('raw')).toBe('')
})
