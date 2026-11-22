import { describe, expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, PERMISSION_ASK_META } from '@zomfy/protocol'
import { AskStore, optionResponse, questionResponse, questionsOf } from './asks'

const approval = (askId: string, sessionId = 's1'): acp.RequestPermissionRequest => ({
  sessionId,
  toolCall: { toolCallId: `t-${askId}`, title: 'rm -rf build', rawInput: { command: 'rm -rf build' }, _meta: { [CHAT_META.toolName]: 'Bash' } },
  options: [
    { kind: 'allow_once', name: 'Allow', optionId: 'allow' },
    { kind: 'reject_once', name: 'Reject', optionId: 'reject' }
  ],
  _meta: { [PERMISSION_ASK_META.askId]: askId }
})

const question: acp.RequestPermissionRequest = {
  sessionId: 's1',
  toolCall: {
    toolCallId: 'q',
    title: 'AskUserQuestion',
    rawInput: {
      questions: [
        { question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: 'Relational' }, { label: 'SQLite' }] },
        { question: 'Which features?', header: 'Features', multiSelect: true, options: [{ label: 'Auth' }, { label: 'Search' }] }
      ]
    },
    _meta: { [CHAT_META.toolName]: 'AskUserQuestion' }
  },
  options: [
    { kind: 'allow_once', name: 'Answer', optionId: 'answer' },
    { kind: 'reject_once', name: 'Skip', optionId: 'reject' }
  ],
  _meta: { [PERMISSION_ASK_META.askId]: 'ask-q' }
}

describe('asks', () => {
  test('answering sends the response once and removes the card', () => {
    const store = new AskStore()
    const sent: acp.RequestPermissionResponse[] = []
    const ask = store.add('h1', approval('a1'), (r) => sent.push(r))
    expect(ask.key).toBe('h1/a1')
    expect(ask.toolName).toBe('Bash')
    expect(store.asks.get()).toHaveLength(1)
    expect(store.answer(ask.key, optionResponse('allow'))).toBe(true)
    expect(sent).toEqual([{ outcome: { outcome: 'selected', optionId: 'allow' } }])
    expect(store.asks.get()).toHaveLength(0)
    expect(store.answer(ask.key, optionResponse('allow'))).toBe(false)
    expect(sent).toHaveLength(1)
  })

  test('a resolved notification closes the card answered elsewhere', () => {
    const store = new AskStore()
    const sent: unknown[] = []
    store.add('h1', approval('a1'), (r) => sent.push(r))
    store.add('h1', approval('a2'), (r) => sent.push(r))
    store.add('h2', approval('a1'), (r) => sent.push(r))
    let changes = 0
    store.asks.subscribe(() => changes++)
    store.resolved('h1', { sessionId: 's1', askId: 'a1', optionId: 'allow' })
    expect(store.asks.get().map((a) => a.key)).toEqual(['h1/a2', 'h2/a1'])
    expect(changes).toBe(1)
    expect(store.answer('h1/a1', optionResponse('allow'))).toBe(false)
    expect(sent).toHaveLength(0)
  })

  test('dropping a host removes its asks only', () => {
    const store = new AskStore()
    store.add('h1', approval('a1'), () => {})
    store.add('h2', approval('a2', 's9'), () => {})
    store.dropHost('h1')
    expect(store.asks.get().map((a) => a.key)).toEqual(['h2/a2'])
    expect(store.forSession('h2', 's9')).toHaveLength(1)
  })

  test('asks without an id from older daemons still get distinct keys', () => {
    const store = new AskStore()
    const request = { ...approval('x'), _meta: {} }
    const one = store.add('h1', request, () => {})
    const two = store.add('h1', request, () => {})
    expect(one.key).not.toBe(two.key)
    expect(one.askId).toBeNull()
  })

  test('an AskUserQuestion ask reads as questions and answers on _meta', () => {
    expect(questionsOf(approval('a1'))).toBeNull()
    expect(questionsOf(question)).toEqual([
      { question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: 'Relational' }, { label: 'SQLite' }] },
      { question: 'Which features?', header: 'Features', multiSelect: true, options: [{ label: 'Auth' }, { label: 'Search' }] }
    ])
    expect(new AskStore().add('h', question, () => {}).questions).toHaveLength(2)
    expect(questionResponse({ 'Which database?': 'SQLite', 'Which features?': 'Auth, Search' })).toEqual({
      outcome: { outcome: 'selected', optionId: 'answer' },
      _meta: { 'harness/answers': { answers: { 'Which database?': 'SQLite', 'Which features?': 'Auth, Search' } } }
    })
  })
})
