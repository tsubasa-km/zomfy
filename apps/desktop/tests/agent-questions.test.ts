import { expect, test } from 'bun:test'
import { agentQuestionsOf, answersOf, EMPTY_PICK, togglePick } from '@/components/native-chat/agent-questions'

// An agent's questions are answered with the picked labels, or the person's own words.

const input = {
  questions: [
    { question: 'Which library?', header: 'Library', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] },
    { question: 'Which features?', header: 'Features', multiSelect: true, options: [{ label: 'X', description: '' }, { label: 'Y', description: '' }] }
  ]
}

test('reads the questions of an AskUserQuestion, and none from a tool approval', () => {
  expect(agentQuestionsOf(input).map((q) => [q.question, q.multiSelect, q.options.length])).toEqual([
    ['Which library?', false, 2],
    ['Which features?', true, 2]
  ])
  expect(agentQuestionsOf({ command: 'ls' })).toEqual([])
  expect(agentQuestionsOf(null)).toEqual([])
})

test('a single choice takes one label, or "Other" in its place', () => {
  let pick = togglePick(EMPTY_PICK, 'A', false)
  pick = togglePick(pick, 'B', false)
  expect(pick.labels).toEqual(['B'])
  pick = { ...togglePick(pick, null, false), otherText: ' my own ' }
  const questions = agentQuestionsOf(input)
  expect(answersOf(questions.slice(0, 1), [pick])).toEqual({ 'Which library?': 'my own' })
})

test('several choices join in the options order, with "Other" last', () => {
  const questions = agentQuestionsOf(input)
  let pick = togglePick(EMPTY_PICK, 'Y', true)
  pick = togglePick(pick, 'X', true)
  pick = { ...togglePick(pick, null, true), otherText: 'Z' }
  expect(answersOf(questions, [togglePick(EMPTY_PICK, 'A', false), pick])).toEqual({ 'Which library?': 'A', 'Which features?': 'X, Y, Z' })
})

test('no answers while a question is unanswered', () => {
  const questions = agentQuestionsOf(input)
  expect(answersOf(questions, [togglePick(EMPTY_PICK, 'A', false), EMPTY_PICK])).toBeNull()
  expect(answersOf(questions, [togglePick(EMPTY_PICK, null, false), togglePick(EMPTY_PICK, 'X', true)])).toBeNull()
})
