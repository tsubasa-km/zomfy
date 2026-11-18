import { describe, expect, test } from 'bun:test'
import { recallStep, sentPrompts } from '../src/components/native-chat/native-chat-prompt-recall.ts'

const prompts = ['first', 'second\nline two', 'third']

describe('sentPrompts', () => {
  test("keeps the person's prompts, oldest first, without repeats in a row", () => {
    expect(
      sentPrompts([
        { kind: 'user', text: 'first' },
        { kind: 'agent', text: 'reply' },
        { kind: 'user', text: 'first' },
        { kind: 'user', text: 'second' }
      ])
    ).toEqual(['first', 'second'])
  })

  test('leaves out what the person did not type', () => {
    expect(
      sentPrompts([
        { kind: 'user', text: 'mine' },
        { kind: 'user', text: 'continue', resumed: 'continue' },
        { kind: 'user', text: '<task-notification>\n<status>completed</status>\n<summary>Done</summary>\n</task-notification>' },
        { kind: 'user', text: '   ' }
      ])
    ).toEqual(['mine'])
  })
})

describe('recallStep', () => {
  test('ArrowUp in an empty composer brings back the newest prompt', () => {
    expect(recallStep('ArrowUp', '', 0, null, prompts)).toEqual({ text: 'third', recalled: { index: 2, text: 'third' } })
  })

  test('ArrowUp again goes further back, and holds at the oldest', () => {
    expect(recallStep('ArrowUp', 'third', 5, { index: 2, text: 'third' }, prompts)).toEqual({
      text: 'second\nline two',
      recalled: { index: 1, text: 'second\nline two' }
    })
    expect(recallStep('ArrowUp', 'first', 5, { index: 0, text: 'first' }, prompts)).toBe('hold')
  })

  test('the caret climbs a recalled prompt of several lines before the next recall', () => {
    const recalled = { index: 1, text: 'second\nline two' }
    expect(recallStep('ArrowUp', recalled.text, recalled.text.length, recalled, prompts)).toBeNull()
    expect(recallStep('ArrowUp', recalled.text, 3, recalled, prompts)).toEqual({ text: 'first', recalled: { index: 0, text: 'first' } })
    expect(recallStep('ArrowDown', recalled.text, 3, recalled, prompts)).toBeNull()
  })

  test('ArrowDown comes forward and empties the composer past the newest', () => {
    expect(recallStep('ArrowDown', 'first', 5, { index: 0, text: 'first' }, prompts)).toEqual({
      text: 'second\nline two',
      recalled: { index: 1, text: 'second\nline two' }
    })
    expect(recallStep('ArrowDown', 'third', 5, { index: 2, text: 'third' }, prompts)).toEqual({ text: '', recalled: null })
  })

  test('an edited or typed draft keeps the arrows for the caret', () => {
    expect(recallStep('ArrowUp', 'typed', 5, null, prompts)).toBeNull()
    expect(recallStep('ArrowUp', 'third!', 6, { index: 2, text: 'third' }, prompts)).toBeNull()
    expect(recallStep('ArrowDown', '', 0, null, prompts)).toBeNull()
  })

  test('nothing sent yet leaves the key alone', () => {
    expect(recallStep('ArrowUp', '', 0, null, [])).toBeNull()
  })
})
