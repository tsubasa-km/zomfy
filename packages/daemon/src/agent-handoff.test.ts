import { expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, type ChatAgentId } from '@acp-harness/protocol'
import {
  HANDOFF_CHAR_BUDGET,
  HANDOFF_CLOSE,
  HANDOFF_MESSAGE_CHAR_LIMIT,
  HANDOFF_OPEN,
  agentEras,
  agentSwitchNotice,
  answeredBefore,
  pendingHandoff,
  restartHandoff
} from './agent-handoff.ts'
import { conversationMessages } from './conversation-messages.ts'
import { savedAgentSessionIds } from './session-registry.ts'

// A chat's agent can be changed mid-conversation. The agent taking over is handed the conversation
// as text, built from the daemon's transcript: these pin what that text holds.

let nextId = 0
const user = (text: string): acp.SessionUpdate => ({
  sessionUpdate: 'user_message_chunk',
  messageId: `m${nextId++}`,
  content: { type: 'text', text }
})
const agent = (text: string): acp.SessionUpdate => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
const thought = (text: string): acp.SessionUpdate => ({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } })
const ran = (command: string): acp.SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: `t${nextId++}`,
  title: command,
  kind: 'execute',
  rawInput: { command }
})
const edited = (path: string): acp.SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: `t${nextId++}`,
  title: `Edit ${path}`,
  kind: 'edit',
  rawInput: { file_path: path }
})
const output = (text: string): acp.SessionUpdate => ({
  sessionUpdate: 'tool_call_update',
  toolCallId: 't',
  status: 'completed',
  content: [{ type: 'content', content: { type: 'text', text } }]
})
const switched = (from: ChatAgentId, to: ChatAgentId): acp.SessionUpdate => agentSwitchNotice(from, to, false)

const cwd = '/work/project'
const handoff = (transcript: acp.SessionUpdate[], to: ChatAgentId, resumes = false) =>
  pendingHandoff(transcript, { agent: to, cwd, resumes })

test('an agent new to the chat is handed the whole conversation, attributed, and told whom it takes over from', () => {
  const text = handoff([user('Fix the login bug'), agent('Found it in auth.ts.'), user('Add a test too'), agent('Done.'), switched('claude', 'codex')], 'codex')
  expect(text).not.toBeNull()
  expect(text?.startsWith(HANDOFF_OPEN)).toBe(true)
  expect(text?.endsWith(HANDOFF_CLOSE)).toBe(true)
  expect(text).toContain('taking over this conversation from Claude')
  expect(text).toContain('(Codex)')
  expect(text).toContain(`same working directory: ${cwd}`)
  expect(text).toContain("not Claude's full context")
  expect(text).toContain('User:\nFix the login bug\n\nAssistant (Claude):\nFound it in auth.ts.\n\nUser:\nAdd a test too\n\nAssistant (Claude):\nDone.')
  expect(text).not.toContain('left out]')
})

test('thoughts and tool output stay out; commands run and files changed are short lines', () => {
  const text = handoff(
    [
      user('Fix it'),
      thought('SECRET REASONING'),
      agent('Looking.'),
      ran('bun test'),
      output('RAW TOOL OUTPUT'),
      edited('src/auth.ts'),
      edited('src/auth.ts'),
      agent('Fixed.'),
      switched('claude', 'gemini')
    ],
    'gemini'
  )
  expect(text).not.toContain('SECRET REASONING')
  expect(text).not.toContain('RAW TOOL OUTPUT')
  expect(text).toContain('Assistant (Claude):\nLooking.\n\nFixed.\n[Claude ran: bun test]\n[Claude changed: src/auth.ts]')
})

test('a returning agent that resumes its own conversation gets only what happened since it last answered', () => {
  const transcript = [
    user('First request'),
    agent('Claude did the first part.'),
    switched('claude', 'codex'),
    user('Now the second part'),
    agent('Codex did the second part.'),
    switched('codex', 'claude')
  ]
  const text = handoff(transcript, 'claude', true)
  expect(text).toContain("You are this chat's agent again (Claude)")
  expect(text).toContain('went on with Codex')
  expect(text).toContain('User:\nNow the second part\n\nAssistant (Codex):\nCodex did the second part.')
  expect(text).not.toContain('First request')
  expect(text).not.toContain('Claude did the first part.')
})

test('a returning agent whose own conversation is gone is handed the whole conversation again', () => {
  const transcript = [user('First request'), agent('Claude did the first part.'), switched('claude', 'codex'), user('Second'), agent('Codex.'), switched('codex', 'claude')]
  const text = handoff(transcript, 'claude', false)
  expect(text).toContain('taking over this conversation from Codex')
  expect(text).toContain('User:\nFirst request\n\nAssistant (Claude):\nClaude did the first part.')
  expect(text).toContain('Assistant (Codex):\nCodex.')
})

test('a stretch an agent never answered in does not count as its own: what it was to be handed then comes again', () => {
  // Claude -> Codex (never prompted) -> Gemini answers -> back to Codex, whose ACP session exists but is empty.
  const transcript = [
    user('Request'),
    agent('Claude answer.'),
    switched('claude', 'codex'),
    switched('codex', 'gemini'),
    user('More'),
    agent('Gemini answer.'),
    switched('gemini', 'codex')
  ]
  const text = handoff(transcript, 'codex', true)
  expect(text).toContain('taking over this conversation from Claude and Gemini')
  expect(text).toContain('Assistant (Claude):\nClaude answer.')
  expect(text).toContain('Assistant (Gemini):\nGemini answer.')
})

test('nothing is pending once the agent has answered, when the agent never changed, or when nothing was said', () => {
  const answered = [user('A'), agent('B'), switched('claude', 'codex'), user('C'), agent('D')]
  expect(handoff(answered, 'codex')).toBeNull()
  expect(handoff([user('A'), agent('B')], 'claude', true)).toBeNull()
  expect(handoff([switched('claude', 'codex')], 'codex')).toBeNull()
  // Away and straight back: Claude missed nothing.
  expect(handoff([user('A'), agent('B'), switched('claude', 'codex'), switched('codex', 'claude')], 'claude', true)).toBeNull()
})

test('a prompt the new agent never answered keeps the handoff pending, with that prompt in it', () => {
  const text = handoff([user('A'), agent('B'), switched('claude', 'codex'), user('Unanswered')], 'codex')
  expect(text).toContain('Assistant (Claude):\nB\n\nUser:\nUnanswered')
})

test('a long conversation keeps the first request and the newest messages whole, and says how many it left out', () => {
  const transcript: acp.SessionUpdate[] = [user('FIRST REQUEST: build the importer')]
  for (let i = 0; i < 60; i++) {
    transcript.push(agent(`answer ${i} ${'x'.repeat(900)}`), user(`follow-up ${i} ${'y'.repeat(300)}`))
  }
  transcript.push(agent('LAST ANSWER'), switched('claude', 'codex'))
  const text = handoff(transcript, 'codex') ?? ''
  const body = text.slice(text.indexOf('The conversation so far:'))
  expect(body.length).toBeLessThanOrEqual(HANDOFF_CHAR_BUDGET + 500)
  expect(text.length).toBeLessThan(HANDOFF_CHAR_BUDGET + 1500)
  expect(text).toContain('FIRST REQUEST: build the importer')
  expect(text).toContain('LAST ANSWER')
  expect(text).toContain(`follow-up 59 ${'y'.repeat(300)}`)
  expect(text).not.toContain('answer 0 ')
  const left = /\[(\d+) earlier messages left out\]/.exec(text)
  expect(left).not.toBeNull()
  const kept = (text.match(/^(User:|Assistant \(Claude\):)$/gm) ?? []).length
  expect(kept + Number(left?.[1])).toBe(122)
  // In order: the first request, the note, then an unbroken tail ending with the newest message.
  expect(text.indexOf('FIRST REQUEST')).toBeLessThan(text.indexOf('earlier messages left out'))
  expect(text.indexOf('earlier messages left out')).toBeLessThan(text.indexOf('LAST ANSWER'))
  const tail = [...text.matchAll(/follow-up (\d+) /g)].map((m) => Number(m[1]))
  expect(tail).toEqual(tail.map((_, i) => 59 - (tail.length - 1) + i))
})

test('one enormous message is clipped in its middle, so it cannot push the rest out', () => {
  const huge = `START ${'z'.repeat(40_000)} END`
  const text = handoff([user('First'), agent('Short answer.'), user(huge), agent('Final.'), switched('claude', 'codex')], 'codex') ?? ''
  expect(text.length).toBeLessThan(HANDOFF_MESSAGE_CHAR_LIMIT + 2500)
  expect(text).toContain('START zzz')
  expect(text).toContain('zzz END')
  expect(text).toContain('characters left out')
  expect(text).toContain('User:\nFirst')
  expect(text).toContain('Assistant (Claude):\nShort answer.')
  expect(text).toContain('Assistant (Claude):\nFinal.')
})

test('an agent whose own conversation could not be reopened is handed the whole chat, its own part included', () => {
  // Never changed agent: the conversation was Codex's alone.
  const alone = restartHandoff([user('Request'), agent('Codex answer.'), user('More'), agent('Codex again.')], { agent: 'codex', cwd })
  expect(alone).toContain('Your earlier conversation in this chat could not be reopened')
  expect(alone).toContain(`same working directory: ${cwd}`)
  expect(alone).toContain('User:\nRequest\n\nAssistant (Codex):\nCodex answer.\n\nUser:\nMore\n\nAssistant (Codex):\nCodex again.')
  // Back from Claude, and already answering again: still everything, since nothing of it is left on its side.
  const transcript = [user('A'), agent('Codex one.'), switched('codex', 'claude'), user('B'), agent('Claude two.'), switched('claude', 'codex'), user('C'), agent('Codex three.')]
  expect(pendingHandoff(transcript, { agent: 'codex', cwd, resumes: true })).toBeNull()
  const back = restartHandoff(transcript, { agent: 'codex', cwd })
  expect(back).toContain('taking over this conversation from Claude')
  expect(back).toContain('Assistant (Codex):\nCodex one.')
  expect(back).toContain('Assistant (Claude):\nClaude two.')
  expect(back).toContain('Assistant (Codex):\nCodex three.')
  expect(restartHandoff([], { agent: 'codex', cwd })).toBeNull()
})

test('the notices in the transcript say which agent ran each stretch', () => {
  const transcript = [user('A'), agent('B'), switched('claude', 'codex'), user('C'), agent('D'), switched('codex', 'claude'), user('E')]
  expect(agentEras(transcript, 'claude')).toEqual([
    { agent: 'claude', start: 0, end: 2, replied: true },
    { agent: 'codex', start: 3, end: 5, replied: true },
    { agent: 'claude', start: 6, end: 7, replied: false }
  ])
  expect(answeredBefore(transcript.slice(0, 5), 'codex', 'claude')).toBe(true)
  expect(answeredBefore(transcript.slice(0, 5), 'codex', 'gemini')).toBe(false)
  // A chat that never changed agent is all its agent's.
  expect(agentEras([user('A'), agent('B')], 'codex')).toEqual([{ agent: 'codex', start: 0, end: 2, replied: true }])
})

test('the notice tells the reader the new agent gets a selection, not the old context', () => {
  const fresh = agentSwitchNotice('claude', 'codex', false)
  const back = agentSwitchNotice('codex', 'claude', true)
  expect(fresh.sessionUpdate === 'notice' && fresh.title).toBe(
    "Switched from Claude to Codex. Codex gets a selection of this conversation, not Claude's full context."
  )
  expect(back.sessionUpdate === 'notice' && back.title).toBe(
    "Switched from Codex to Claude. Claude resumes its own conversation and gets a selection of what happened since, not Codex's full context."
  )
  // The windows word the notice in their own language from this mark.
  expect(fresh._meta).toEqual({ [CHAT_META.agentSwitch]: { from: 'claude', to: 'codex' } })
  expect(back._meta).toEqual({ [CHAT_META.agentSwitch]: { from: 'codex', to: 'claude', resumed: true } })
})

test('streamed chunks join into one message per prompt and per turn', () => {
  const prompt: acp.SessionUpdate[] = [
    { sessionUpdate: 'user_message_chunk', messageId: 'p', content: { type: 'text', text: 'line one' } },
    { sessionUpdate: 'user_message_chunk', messageId: 'p', content: { type: 'image', data: '', mimeType: 'image/png' } },
    { sessionUpdate: 'user_message_chunk', messageId: 'p', content: { type: 'text', text: 'line two' } }
  ]
  expect(conversationMessages([...prompt, agent('Hel'), agent('lo'), ran('ls'), agent('Done')])).toEqual([
    { role: 'User', text: 'line one\nline two', commands: [], edits: [] },
    { role: 'Assistant', text: 'Hello\n\nDone', commands: ['ls'], edits: [] }
  ])
  // Two prompts in a row (the first went unanswered) stay two messages.
  expect(conversationMessages([user('one'), user('two')]).map((m) => m.text)).toEqual(['one', 'two'])
})

test("a record saved with one agent's session id keeps it under that agent", () => {
  expect(savedAgentSessionIds({ agent: 'codex', agentSessionId: 'abc' })).toEqual({ codex: 'abc' })
  expect(savedAgentSessionIds({ agent: 'codex', agentSessionId: 'old', agentSessionIds: { codex: 'new', gemini: 'g' } })).toEqual({ codex: 'new', gemini: 'g' })
  expect(savedAgentSessionIds({ agentSessionId: null })).toBeUndefined()
  expect(savedAgentSessionIds({})).toBeUndefined()
})
