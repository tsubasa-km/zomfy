import { createInterface } from 'node:readline'

// A real stdio child with App Server framing. It deliberately completes one turn before its
// start response and withholds a response during cancellation to exercise both event orderings.
let threadId = ''
let resume = false
let turnId = ''
let pendingStart: number | null = null
let sequence = 0

type Message = {
  id?: number | string
  method?: string
  params?: { threadId?: string; turnId?: string; input?: { text?: string }[]; effort?: string }
  result?: { decision?: string; answers?: Record<string, { answers: string[] }> }
}
const send = (message: Record<string, unknown>) => process.stdout.write(JSON.stringify(message) + '\n')
const reply = (id: Message['id'], result: Record<string, unknown> = {}) => send({ id, result })
const event = (method: string, params: Record<string, unknown>) => send({ method, params: { threadId, turnId, ...params } })

function finish(status: string, text?: string): void {
  if (text) {
    event('item/agentMessage/delta', { itemId: 'answer', delta: text.slice(0, 3) })
    event('item/agentMessage/delta', { itemId: 'answer', delta: text.slice(3) })
    event('item/completed', { item: { type: 'agentMessage', id: 'answer', text } })
  }
  event('turn/completed', { turn: { id: turnId, status } })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params = {}, result } = JSON.parse(line) as Message
  if (!method) {
    if (id === 'approval') {
      if (result?.decision === 'cancel') return
      send({ method: 'item/tool/requestUserInput', id: 'question', params: {
        threadId, turnId, itemId: 'choice',
        questions: [{ id: 'color', header: 'Color', question: 'Which color?', options: [{ label: 'Blue', description: 'A color' }] }]
      } })
    } else if (id === 'question') {
      event('item/completed', { item: { id: 'cmd', type: 'commandExecution', command: 'echo preview', status: 'completed', aggregatedOutput: 'preview' } })
      finish('completed', `choice ${result?.answers?.color?.answers?.[0] ?? 'skipped'}`)
    }
    return
  }

  switch (method) {
    case 'initialize':
      reply(id)
      break
    case 'initialized':
      break
    case 'thread/resume':
      if (params.threadId === 'missing') {
        send({ id, error: { code: -32600, message: 'Thread does not exist' } })
        break
      }
      resume = true
      if (!params.threadId) throw new Error('Missing thread ID')
      threadId = params.threadId
      reply(id, { thread: { id: threadId }, model: 'test-model', reasoningEffort: 'low' })
      break
    case 'thread/start':
      threadId = 'direct-thread'
      reply(id, { thread: { id: threadId }, model: 'test-model', reasoningEffort: 'low' })
      break
    case 'model/list':
      reply(id, { data: [{ model: 'test-model', displayName: 'Test model', defaultReasoningEffort: 'low', supportedReasoningEfforts: [
        { reasoningEffort: 'low' }, { reasoningEffort: 'high' }
      ] }] })
      break
    case 'turn/start': {
      if (params.threadId !== threadId) throw new Error('Wrong thread')
      turnId = `turn-${++sequence}`
      const text = params.input?.[0]?.text
      event('turn/started', { turn: { id: turnId, status: 'inProgress' } })
      if (text === 'exit') process.exit(9)
      if (text === 'wait') {
        if (typeof id !== 'number') throw new Error('Wrong start ID')
        pendingStart = id
        break
      }
      if (text === 'secret') {
        reply(id, { turn: { id: turnId } })
        send({ id: 'question', method: 'item/tool/requestUserInput', params: {
          threadId, turnId, itemId: 'secret',
          questions: [{ id: 'color', question: 'A secret answer', isSecret: true }]
        } })
        break
      }
      if (text === 'ask') {
        reply(id, { turn: { id: turnId } })
        event('item/started', { item: { id: 'cmd', type: 'commandExecution', command: 'echo preview', status: 'inProgress' } })
        send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {
          threadId, turnId, itemId: 'cmd', command: 'echo preview', availableDecisions: ['accept', 'decline']
        } })
        break
      }
      finish('completed', `${resume ? 'resume' : 'new'} ${threadId}: ${text}${params.effort ? ` (${params.effort})` : ''}`)
      reply(id, { turn: { id: turnId } })
      break
    }
    case 'turn/interrupt':
      if (params.turnId !== turnId) throw new Error('Wrong interrupt ID')
      reply(id)
      finish('interrupted')
      if (pendingStart !== null) reply(pendingStart, { turn: { id: turnId } })
      pendingStart = null
      break
    default:
      send({ id, error: { code: -32601, message: 'Unknown method' } })
  }
})
