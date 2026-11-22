import { describe, expect, test } from 'bun:test'
import { BOT_NOTIFICATIONS, type Bot, type ConnectorStatus } from '@zomfy/protocol'
import { botActivity, botChats, INITIAL_BOTS_STATE, reduceBotsNotification } from '../src/lib/bot-state'
import { parseBotMention } from '../src/lib/bot-mention'
import type { Session } from '../src/session-store'

function bot(handle: string, extra: Partial<Bot> = {}): Bot {
  return {
    id: `b-${handle}`,
    name: handle,
    handle,
    avatar: null,
    purpose: null,
    agent: 'claude',
    model: null,
    permissionMode: 'default',
    homeWorkspaceId: `w-${handle}`,
    owner: {},
    askers: {},
    paused: false,
    createdAt: 1,
    ...extra
  }
}

function chat(id: string, extra: Partial<Session>): Session {
  return { id, hostId: 'local', workspaceId: 'w', title: id, status: 'idle', createdAt: 1, items: [], loaded: true, ...extra } as Session
}

describe('the bots store', () => {
  test('botsChanged replaces the list, and a deleted bot closes its page', () => {
    const shown = { ...INITIAL_BOTS_STATE, bots: [bot('reviewer'), bot('writer')], selectedId: 'b-writer' }
    const next = reduceBotsNotification(shown, BOT_NOTIFICATIONS.botsChanged, { bots: [bot('reviewer')] })
    expect(next.bots?.map((b) => b.handle)).toEqual(['reviewer'])
    expect(next.selectedId).toBeNull()
    const kept = reduceBotsNotification({ ...shown, selectedId: 'b-reviewer' }, BOT_NOTIFICATIONS.botsChanged, { bots: [bot('reviewer')] })
    expect(kept.selectedId).toBe('b-reviewer')
  })

  test('connectorStatusChanged and accessRequestsChanged replace their parts', () => {
    const status: ConnectorStatus = {
      state: 'online',
      relayUrl: 'https://relay.example',
      hostId: 'h_1',
      sources: ['discord'],
      lastConnectedAt: 5,
      retryAt: null,
      error: null
    }
    const online = reduceBotsNotification(INITIAL_BOTS_STATE, BOT_NOTIFICATIONS.connectorStatusChanged, status)
    expect(online.connector).toEqual(status)
    const request = { id: 'r1', botId: 'b-reviewer', source: 'discord' as const, requester: { id: 'u1', name: 'Alex' }, message: null, createdAt: 2 }
    const asked = reduceBotsNotification(online, BOT_NOTIFICATIONS.accessRequestsChanged, { requests: [request] })
    expect(asked.accessRequests).toEqual([request])
    expect(asked.connector).toEqual(status)
    expect(reduceBotsNotification(asked, 'other', {})).toBe(asked)
  })

  test("a bot's chats are its own top-level chats, newest first, and its dot says what they need", () => {
    const reviewer = bot('reviewer')
    const sessions = [
      chat('old', { origin: 'bot', botId: reviewer.id, createdAt: 1 }),
      chat('new', { origin: 'bot', botId: reviewer.id, createdAt: 2 }),
      chat('worker', { origin: 'bot', botId: reviewer.id, parentId: 'new', createdAt: 3, status: 'working' }),
      chat('plain', { createdAt: 4 })
    ]
    expect(botChats(sessions, reviewer.id).map((s) => s.id)).toEqual(['new', 'old'])
    expect(botActivity(reviewer, sessions)).toBe('running')
    expect(botActivity(reviewer, [...sessions, chat('ask', { origin: 'bot', botId: reviewer.id, status: 'needs-you' })])).toBe('waiting')
    expect(botActivity({ ...reviewer, paused: true }, [])).toBe('paused')
    expect(botActivity(reviewer, [])).toBe('idle')
  })
})

describe('the @handle parser', () => {
  const bots = [bot('reviewer'), bot('ops-bot')]

  test('finds a bot handle at the start of a prompt', () => {
    expect(parseBotMention('@reviewer summarise this chat', bots)).toMatchObject({ bot: { handle: 'reviewer' }, text: 'summarise this chat' })
    expect(parseBotMention('  @Ops-Bot\nrestart it', bots)).toMatchObject({ bot: { handle: 'ops-bot' }, text: 'restart it' })
    expect(parseBotMention('@reviewer', bots)).toMatchObject({ text: '' })
  })

  test('finds nothing elsewhere, for unknown handles, or for file mentions', () => {
    expect(parseBotMention('please ask @reviewer', bots)).toBeNull()
    expect(parseBotMention('@nobody hello', bots)).toBeNull()
    expect(parseBotMention('@reviewer.md look', bots)).toBeNull()
    expect(parseBotMention('@src/reviewer look', bots)).toBeNull()
  })
})
