import { expect, test } from 'bun:test'
import { PROMPT_ORIGIN_META, promptOrigin } from '@acp-harness/protocol'

// The chat tells the harness's prompts from the person's: by the marker, or for older records by the
// words the harness wrote.

test('the marker says who a prompt is from', () => {
  const origin = { kind: 'step-question', from: 'the workflow "W" (run r)', question: 'A or B?' } as const
  expect(promptOrigin({ [PROMPT_ORIGIN_META]: origin }, 'anything')).toEqual(origin)
  expect(promptOrigin({ [PROMPT_ORIGIN_META]: { kind: 'step-task', workflow: 'W', step: 'Dev' } }, '')).toEqual({
    kind: 'step-task',
    workflow: 'W',
    step: 'Dev'
  })
})

test("an older record's question and step instructions are recognised by their words", () => {
  const question = [
    '[Question from "Dev · W" (session 971a)]',
    'Line one?',
    '',
    'Line two.',
    '',
    "Answer it if you can from this conversation, the project and the person's intent (look things up if that helps).",
    'Give your result as the structured output: ...'
  ].join('\n')
  expect(promptOrigin(undefined, question)).toEqual({ kind: 'step-question', from: '"Dev · W" (session 971a)', question: 'Line one?\n\nLine two.' })
  expect(promptOrigin(undefined, 'You are the Reviewer in the workflow "W", step "Review", run by Zomfy.\n\nTask')).toEqual({
    kind: 'step-task',
    workflow: 'W',
    step: 'Review'
  })
  expect(promptOrigin(undefined, 'Next step in the workflow "W": "Fix". You are now the Developer')).toEqual({
    kind: 'step-task',
    workflow: 'W',
    step: 'Fix'
  })
  expect(promptOrigin(undefined, 'You are a helper agent in the workflow "W", step "Dev", run by Zomfy.')).toEqual({
    kind: 'step-task',
    workflow: 'W',
    step: 'Dev'
  })
})

test("the person's own messages have no origin", () => {
  expect(promptOrigin(undefined, 'Please fix the [Question from] parser')).toBeNull()
  expect(promptOrigin({}, 'You are great')).toBeNull()
})
