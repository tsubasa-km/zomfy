import { expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, QUESTION_OPTION_IDS } from '@zomfy/protocol'
import { CodexTurnEvents, codexServerRequest } from './codex-app-server-events.ts'

const outputs = (updates: acp.SessionUpdate[]) => updates.flatMap((update) =>
  update.sessionUpdate === 'tool_call_update' && !update.status
    ? (update.content ?? []).flatMap((content) => content.type === 'content' && content.content.type === 'text' ? [content.content.text] : [])
    : []
)

test('a command\'s streamed output reaches the chat at intervals, and completion carries all of it', async () => {
  const updates: acp.SessionUpdate[] = []
  const events = new CodexTurnEvents(async (update) => { updates.push(update) }, 50)
  await events.update('item/started', { item: { id: 'cmd', type: 'commandExecution', command: 'build', status: 'inProgress' } })
  for (let i = 0; i < 100; i++) await events.update('item/commandExecution/outputDelta', { itemId: 'cmd', delta: `${i}\n` })
  expect(outputs(updates)).toEqual(['0\n'])
  await Bun.sleep(80)
  expect(outputs(updates)).toHaveLength(2)
  expect(outputs(updates)[1]!.endsWith('99\n')).toBe(true)
  await events.update('item/commandExecution/outputDelta', { itemId: 'cmd', delta: 'last\n' })
  await events.update('item/completed', { item: { id: 'cmd', type: 'commandExecution', command: 'build', status: 'completed' } })
  await Bun.sleep(80)
  expect(outputs(updates)).toHaveLength(2)
  const done = updates.at(-1)
  expect(done?.sessionUpdate === 'tool_call_update' && done.status).toBe('completed')
  events.close()
})

test('questions with the same text are answered separately, each by its own ID', async () => {
  let shown: { question: string }[] = []
  const result = await codexServerRequest('item/tool/requestUserInput', {
    threadId: 't', turnId: 'u', itemId: 'q',
    questions: [
      { id: 'front', header: 'Front', question: 'Which color?', options: [{ label: 'Blue' }, { label: 'Red' }] },
      { id: 'back', header: 'Back', question: 'Which color?', options: [{ label: 'Blue' }, { label: 'Red' }] }
    ]
  }, async (request) => {
    shown = (request.toolCall.rawInput as { questions: { question: string }[] }).questions
    const [front, back] = shown.map((entry) => entry.question)
    return {
      outcome: { outcome: 'selected', optionId: QUESTION_OPTION_IDS.answer },
      _meta: { [CHAT_META.answers]: { answers: { [front!]: 'Blue', [back!]: 'Red' } } }
    }
  })
  expect(new Set(shown.map((entry) => entry.question)).size).toBe(2)
  expect(result).toEqual({ answers: { front: { answers: ['Blue'] }, back: { answers: ['Red'] } } })
})
