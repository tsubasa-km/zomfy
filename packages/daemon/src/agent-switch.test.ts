import { expect, mock, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, HARNESS_METHODS, type ChatAgentId, type SessionInfo } from '@acp-harness/protocol'
import * as launchSpecs from './chat-agent-launch-specs.ts'
import { agentSwitchNotice } from './agent-handoff.ts'
import { DEFAULT_SESSION_OPTIONS, type SessionRecord } from './session-registry.ts'
import type { HandlerContext } from './handlers/handler-context.ts'

// Changing a chat's agent (`_harness/sessions/setAgent`) against a stand-in registry: no agent runs.
mock.module('./chat-agent-launch-specs.ts', () => ({
  ...launchSpecs,
  resolveChatAgent: async (agent: ChatAgentId) =>
    agent === 'goose' ? { status: 'missing', detail: '`goose` is not on this host’s PATH' } : { status: 'ready', argv: [], env: {}, display: 'fake' }
}))
const { registerSessionHandlers } = await import('./handlers/session-handlers.ts')

let nextId = 0
const user = (text: string, messageId = `m${nextId++}`): acp.SessionUpdate => ({ sessionUpdate: 'user_message_chunk', messageId, content: { type: 'text', text } })
const agent = (text: string): acp.SessionUpdate => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })

function chat(fields: Partial<SessionRecord> = {}, transcript: acp.SessionUpdate[] = []) {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>()
  const session = {
    id: 's1',
    workspaceId: 'w1',
    cwd: '/work/project',
    title: 'Fix the login bug',
    status: 'idle',
    createdAt: 0,
    turnStartedAt: null,
    claudeSessionId: null,
    options: { ...DEFAULT_SESSION_OPTIONS },
    ...fields
  } as SessionRecord
  const seen = { released: 0, started: [] as (ChatAgentId | undefined)[], autoResumeOff: 0 }
  const pendingTurns = new Map<string, AbortController>()
  const ctx = {
    handle: (method: string, run: (params: unknown) => Promise<unknown>) => handlers.set(method, run),
    sessions: {
      get: (id: string) => (id === session.id ? session : undefined),
      update: (_id: string, patch: Partial<SessionRecord>) => Object.assign(session, patch),
      transcript: async () => [...transcript],
      replaceTranscript: async (_id: string, updates: acp.SessionUpdate[]) => void transcript.splice(0, transcript.length, ...updates)
    },
    pendingTurns,
    acpAgents: {
      release: () => seen.released++,
      for: (record: SessionRecord) =>
        record.agent && record.agent !== 'claude' ? { ensureStarted: async () => void seen.started.push(record.agent) } : null
    },
    autoResume: { disable: () => seen.autoResumeOff++ },
    emit: async (_id: string, update: acp.SessionUpdate) => void transcript.push(update),
    workspaceRoot: () => session.cwd,
    moveSession: async () => {
      throw new Error('not here')
    }
  } as unknown as HandlerContext
  registerSessionHandlers(ctx)
  const call = <T = SessionInfo>(method: string, params: unknown) => handlers.get(method)?.(params) as Promise<T>
  return {
    session,
    transcript,
    seen,
    pendingTurns,
    setAgent: (to: string, extra: object = {}) => call(HARNESS_METHODS.sessionSetAgent, { sessionId: 's1', agent: to, ...extra }),
    rewind: (messageId: string) => call<{ text: string }>(HARNESS_METHODS.sessionRewind, { sessionId: 's1', messageId }),
    fork: (fromMessageId: string) => call(HARNESS_METHODS.sessionFork, { sessionId: 's1', fromMessageId })
  }
}

const noticeTitles = (transcript: acp.SessionUpdate[]) => transcript.flatMap((u) => (u.sessionUpdate === 'notice' ? [u.title] : []))

test('the chat stays and its agent changes: a notice marks it and the next prompt carries the conversation', async () => {
  const c = chat({ claudeSessionId: 'claude-1', autoResume: { fireAt: 1, resetKnown: true, attempt: 0 }, promptSuggestion: 'next?' }, [
    user('Fix the login bug'),
    agent('Found it in auth.ts.')
  ])
  const info = await c.setAgent('codex')
  expect(c.session.agent).toBe('codex')
  expect(c.session.agentState).toEqual({ phase: 'starting', error: null, options: [], commands: [] })
  expect(c.session.title).toBe('Fix the login bug')
  expect(c.session.promptSuggestion).toBeNull()
  // Claude's own conversation is kept for the way back.
  expect(c.session.claudeSessionId).toBe('claude-1')
  expect(c.session.handoffContext).toContain('taking over this conversation from Claude')
  expect(c.session.handoffContext).toContain('User:\nFix the login bug\n\nAssistant (Claude):\nFound it in auth.ts.')
  expect(noticeTitles(c.transcript)).toEqual(["Switched from Claude to Codex. Codex gets a selection of this conversation, not Claude's full context."])
  expect(c.transcript.at(-1)?._meta?.[CHAT_META.agentSwitch]).toEqual({ from: 'claude', to: 'codex' })
  expect(c.seen).toEqual({ released: 1, started: ['codex'], autoResumeOff: 1 })
  // What the windows get shows the new agent and none of the daemon's own fields.
  expect(info.agent).toBe('codex')
  expect(info).not.toHaveProperty('handoffContext')
  expect(info).not.toHaveProperty('claudeSessionId')
  expect(info).not.toHaveProperty('agentSessionIds')
})

test('changing to the agent the chat already has does nothing', async () => {
  const c = chat({ agent: 'codex' }, [user('Hi'), agent('Hello')])
  await c.setAgent('codex')
  expect(c.transcript).toHaveLength(2)
  expect(c.seen.released).toBe(0)
  expect(c.session.handoffContext).toBeUndefined()
  const claude = chat({}, [user('Hi')])
  await claude.setAgent('claude')
  expect(claude.transcript).toHaveLength(1)
})

test('refused while a turn runs or the agent waits for an answer', async () => {
  const running = chat({ status: 'working' }, [user('Hi')])
  await expect(running.setAgent('codex')).rejects.toThrow('Stop the agent')
  const asking = chat({ status: 'needs-you' }, [user('Hi')])
  await expect(asking.setAgent('codex')).rejects.toThrow('Stop the agent')
  const pending = chat({}, [user('Hi')])
  pending.pendingTurns.set('s1', new AbortController())
  await expect(pending.setAgent('codex')).rejects.toThrow('Stop the agent')
  for (const c of [running, asking, pending]) {
    expect(c.session.agent).toBeUndefined()
    expect(c.transcript).toHaveLength(1)
  }
})

test('refused for an unknown agent, one this host cannot run, the Manager chat and a chat holding local-only data', async () => {
  await expect(chat().setAgent('nope')).rejects.toThrow('Unknown agent nope')
  const missing = chat()
  await expect(missing.setAgent('goose')).rejects.toThrow('Goose cannot run on this host')
  expect(missing.session.agent).toBeUndefined()
  await expect(chat({ role: 'manager' }).setAgent('codex')).rejects.toThrow('Claude only')
  await expect(chat({ agent: 'codex', localOnly: true }).setAgent('claude')).rejects.toThrow('local-only data')
})

test('back on Claude: its conversation resumes, it is told only what it missed, and its options are as it left them', async () => {
  const options = { model: 'opus', permissionMode: 'plan', effort: 'high' } as const
  const c = chat({ agent: 'codex', claudeSessionId: 'claude-1', agentSessionIds: { codex: 'codex-1' }, options }, [
    user('First request'),
    agent('Claude did the first part.'),
    agentSwitchNotice('claude', 'codex', false),
    user('Second request'),
    agent('Codex did the second part.')
  ])
  await c.setAgent('claude', { permissionMode: 'bypassPermissions' })
  expect(c.session.agent).toBeUndefined()
  expect(c.session.agentState).toBeUndefined()
  expect(c.session.options).toEqual(options)
  expect(c.session.claudeSessionId).toBe('claude-1')
  expect(c.session.agentSessionIds).toEqual({ codex: 'codex-1' })
  expect(c.session.handoffContext).toContain("You are this chat's agent again (Claude)")
  expect(c.session.handoffContext).toContain('User:\nSecond request\n\nAssistant (Codex):\nCodex did the second part.')
  expect(c.session.handoffContext).not.toContain('First request')
  expect(noticeTitles(c.transcript).at(-1)).toBe(
    "Switched from Codex to Claude. Claude resumes its own conversation and gets a selection of what happened since, not Codex's full context."
  )
  expect(c.seen.started).toEqual([])
})

test('Claude taking over a chat it never ran starts on default options, in the mode the window asks for', async () => {
  const c = chat({ agent: 'codex', title: 'Codex', options: { ...DEFAULT_SESSION_OPTIONS } }, [user('Request'), agent('Codex answer.')])
  await c.setAgent('claude', { permissionMode: 'acceptEdits' })
  expect(c.session.options).toEqual({ ...DEFAULT_SESSION_OPTIONS, permissionMode: 'acceptEdits' })
  // An older daemon named it after its agent, which would now be the wrong one.
  expect(c.session.title).toBe('New chat')
  expect(c.session.handoffContext).toContain('taking over this conversation from Codex')
})

test('changing away before the new agent answered, then on: nothing of the conversation is lost on the way', async () => {
  const c = chat({ claudeSessionId: 'claude-1' }, [user('Request'), agent('Claude answer.')])
  await c.setAgent('codex')
  await c.setAgent('gemini')
  expect(c.session.agent).toBe('gemini')
  expect(c.session.handoffContext).toContain('taking over this conversation from Claude')
  expect(c.session.handoffContext).toContain('Assistant (Claude):\nClaude answer.')
  await c.setAgent('claude')
  // Claude missed nothing: no one said anything while it was away.
  expect(c.session.handoffContext).toBeNull()
})

test('rewind and fork-from-here refuse a message another agent answered, and say so', async () => {
  const c = chat({}, [
    user('To Codex', 'codex-prompt'),
    agent('Codex answer.'),
    agentSwitchNotice('codex', 'claude', false),
    user('To Claude', 'claude-prompt'),
    agent('Claude answer.')
  ])
  await expect(c.rewind('codex-prompt')).rejects.toThrow('Rewinding works for messages sent to Claude; this one went to Codex')
  expect(c.transcript).toHaveLength(5)
  const forking = chat({ claudeSessionId: 'claude-1' }, [...c.transcript])
  await expect(forking.fork('codex-prompt')).rejects.toThrow('Forking from a message works for messages sent to Claude; this one went to Codex')
  // And both stay Claude-only for the chat as a whole.
  const external = chat({ agent: 'codex' }, [user('Hi', 'p')])
  await expect(external.rewind('p')).rejects.toThrow('Rewinding works in Claude chats only')
})

test('rewinding the message Claude took the chat back with makes its next one carry the handoff again', async () => {
  const c = chat({ agentSessionIds: { codex: 'codex-1' } }, [
    user('To Codex'),
    agent('Codex answer.'),
    agentSwitchNotice('codex', 'claude', false),
    user('To Claude', 'claude-prompt'),
    agent('Claude answer.')
  ])
  expect(await c.rewind('claude-prompt')).toEqual({ text: 'To Claude' })
  expect(c.transcript).toHaveLength(3)
  expect(c.session.handoffContext).toContain('taking over this conversation from Codex')
  expect(c.session.handoffContext).toContain('Assistant (Codex):\nCodex answer.')
  // Codex ran only before that message: its conversation still matches the chat.
  expect(c.session.agentSessionIds).toEqual({ codex: 'codex-1' })
})

test('rewinding past another agent’s stretch drops that agent’s conversation, which holds what was dropped', async () => {
  const c = chat({ agentSessionIds: { codex: 'codex-1', gemini: 'gemini-1' } }, [
    user('To Gemini'),
    agent('Gemini answer.'),
    agentSwitchNotice('gemini', 'claude', false),
    user('To Claude', 'claude-prompt'),
    agent('Claude answer.'),
    agentSwitchNotice('claude', 'codex', false),
    user('To Codex'),
    agent('Codex answer.'),
    agentSwitchNotice('codex', 'claude', true)
  ])
  await c.rewind('claude-prompt')
  expect(c.session.agentSessionIds).toEqual({ gemini: 'gemini-1' })
  expect(c.session.handoffContext).toContain('Assistant (Gemini):\nGemini answer.')
  expect(c.session.handoffContext).not.toContain('Codex answer.')
})
