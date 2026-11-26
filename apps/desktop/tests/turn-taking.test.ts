import { describe, expect, test } from 'bun:test'
import { foldedTurnPhase, turnPhase, DEFAULT_QUIET_AFTER_MS } from '@zomfy/protocol'
import type { Session } from '../src/session-store.ts'
import { chatSections, chatTree } from '../src/lib/chat-list.ts'
import { openNextStepsQuestion, waitingGlowTarget } from '../src/components/native-chat/waiting-glow-target.ts'
import type { NextStepsRow, TranscriptRowModel } from '../src/components/native-chat/native-chat-transcript-model.ts'

// docs/specs/turn-taking-states.md and docs/specs/composer-waiting-glow.md

const NOW = 1_000_000_000_000
const HOUR = 60 * 60_000

let clock = 0
const chat = (id: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    title: id,
    status: 'idle',
    createdAt: ++clock,
    turnStartedAt: null,
    hostId: 'local',
    workspaceId: 'w',
    items: [],
    loaded: true,
    ...extra
  }) as Session

describe('turnPhase', () => {
  test('a question, an approval or a failure needs an answer; a turn is working', () => {
    expect(turnPhase(chat('a', { status: 'needs-you' }), NOW)).toBe('needs-answer')
    expect(turnPhase(chat('a', { status: 'error' }), NOW)).toBe('needs-answer')
    expect(turnPhase(chat('a', { status: 'working', yourTurnSince: null }), NOW)).toBe('working')
  })

  test('background tasks or a wake-up after the turn are background work, not the person’s turn', () => {
    const ended = { yourTurnSince: NOW - 1000, lastActivityAt: NOW - 1000 }
    expect(turnPhase(chat('a', { ...ended, background: { tasks: ['bun test'], wakeUps: [] } }), NOW)).toBe('background')
    expect(turnPhase(chat('a', { ...ended, background: { tasks: [], wakeUps: [{ id: 'w', at: NOW + HOUR, recurring: false, prompt: 'p' }] } }), NOW)).toBe(
      'background'
    )
    expect(turnPhase(chat('a', { ...ended, background: null }), NOW)).toBe('your-turn')
  })

  test('Your turn lasts until seen and left alone for the quiet time', () => {
    const handed = { yourTurnSince: NOW - 2 * DEFAULT_QUIET_AFTER_MS, lastActivityAt: NOW - 2 * DEFAULT_QUIET_AFTER_MS }
    // Never seen: still the person's turn, however old.
    expect(turnPhase(chat('a', handed), NOW)).toBe('your-turn')
    // Seen since it was handed back, and old: quiet.
    expect(turnPhase(chat('a', { ...handed, seenAt: handed.yourTurnSince + 1 }), NOW)).toBe('quiet')
    // Seen, but recent: still the person's turn.
    expect(turnPhase(chat('a', { yourTurnSince: NOW - HOUR, lastActivityAt: NOW - HOUR, seenAt: NOW - 1 }), NOW)).toBe('your-turn')
    // Seen only before the latest hand-back: not seen since.
    expect(turnPhase(chat('a', { ...handed, seenAt: handed.yourTurnSince - 1 }), NOW)).toBe('your-turn')
    // Never quiet when the setting says so.
    expect(turnPhase(chat('a', { ...handed, seenAt: NOW }), NOW, null)).toBe('your-turn')
  })

  test('a thread that never ran a turn is quiet; an older daemon’s idle thread goes by its last turn', () => {
    expect(turnPhase(chat('a', { yourTurnSince: null }), NOW)).toBe('quiet')
    expect(turnPhase(chat('a', { lastActivityAt: NOW - HOUR }), NOW)).toBe('your-turn')
    expect(turnPhase(chat('a', { lastActivityAt: NOW - 2 * DEFAULT_QUIET_AFTER_MS }), NOW)).toBe('quiet')
    expect(turnPhase(chat('a', {}), NOW)).toBe('quiet')
  })

  test('a child that needs an answer, works or has background work lifts its parent; its own Your turn does not', () => {
    expect(foldedTurnPhase('quiet', ['your-turn', 'quiet'])).toBe('quiet')
    expect(foldedTurnPhase('your-turn', ['working'])).toBe('working')
    expect(foldedTurnPhase('working', ['needs-answer'])).toBe('needs-answer')
    expect(foldedTurnPhase('quiet', ['background'])).toBe('background')
  })
})

describe('the sidebar groups', () => {
  test('by whose turn it is, background work with Working after the turns that run', () => {
    const at = (h: number) => NOW - h * HOUR
    const sessions = [
      chat('asking', { status: 'needs-you', lastActivityAt: at(1) }),
      chat('handed', { yourTurnSince: at(2), lastActivityAt: at(2) }),
      chat('running', { status: 'working', turnStartedAt: at(0.1), yourTurnSince: null }),
      chat('waiting', { yourTurnSince: at(0.5), lastActivityAt: at(0.5), background: { tasks: ['build'], wakeUps: [] } }),
      chat('old', { yourTurnSince: at(48), lastActivityAt: at(48), seenAt: at(47) }),
      chat('helper', { parentId: 'old', status: 'working', turnStartedAt: at(0.2) }),
      chat('fresh', { yourTurnSince: null })
    ]
    const sections = chatSections(chatTree(sessions, (s) => turnPhase(s, NOW)), [])
    expect(sections.map((s) => [s.id, s.nodes.map((n) => n.chat.id)])).toEqual([
      ['needs-answer', ['asking']],
      ['your-turn', ['handed']],
      // A quiet thread with a working helper is working.
      ['working', ['running', 'old', 'waiting']],
      ['quiet', ['fresh']]
    ])
  })
})

describe('where the glow goes', () => {
  const nextSteps = (question: boolean, followUp?: string): NextStepsRow => ({
    kind: 'next-steps',
    card: { summary: 'Done', steps: [{ owner: 'you', text: 'Check it' }], ...(question ? { question: { text: 'Ship it?', options: ['Yes', 'No'] } } : {}) },
    ...(followUp !== undefined ? { followUp } : {})
  })
  const user: TranscriptRowModel = { kind: 'user', item: { kind: 'user', text: 'go' } as never }

  test('a waiting card wins over everything', () => {
    expect(waitingGlowTarget('needs-answer', true, [])).toEqual({ at: 'card' })
    // A helper's ask shown in a thread that is itself working.
    expect(waitingGlowTarget('working', true, [])).toEqual({ at: 'card' })
  })

  test('on Your turn: the open Next steps question, else the composer', () => {
    const asked = nextSteps(true)
    expect(waitingGlowTarget('your-turn', false, [user, asked])).toEqual({ at: 'next-steps', row: asked })
    expect(waitingGlowTarget('your-turn', false, [user, nextSteps(false)])).toEqual({ at: 'composer' })
    expect(waitingGlowTarget('your-turn', false, [user, nextSteps(true, 'Yes')])).toEqual({ at: 'composer' })
    expect(waitingGlowTarget('your-turn', false, [nextSteps(true), user])).toEqual({ at: 'composer' })
  })

  test('nothing glows while the agent works, in the background or when quiet', () => {
    expect(waitingGlowTarget('working', false, [])).toBeNull()
    expect(waitingGlowTarget('background', false, [nextSteps(true)])).toBeNull()
    expect(waitingGlowTarget('quiet', false, [])).toBeNull()
  })

  test('only the last Next steps card counts', () => {
    expect(openNextStepsQuestion([nextSteps(true), { kind: 'agent', text: 'more' }, nextSteps(false)])).toBeNull()
  })
})
