import { describe, expect, test } from 'bun:test'
import { BOT_NOTIFICATIONS, type Bot, type ConnectorStatus } from '@zomfy/protocol'
import { botActivity, botBadges, botChats, botFromLink, INITIAL_BOTS_STATE, reduceBotsNotification } from '../src/lib/bot-state'
import { parseBotMention } from '../src/lib/bot-mention'
import { automationInputOf, initialAutomationDraft } from '../src/lib/automation-draft'
import { automationsForBot, foundMembers, initialBotDraft, mintedHook } from '../src/lib/bot-automation'
import type { Automation } from '@zomfy/protocol'
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

describe('bot badges', () => {
  test('Master shows for a manager bot only, after Default', () => {
    expect(botBadges(bot('zomfy', { isDefault: true, manager: true }))).toEqual(['Default', 'Master'])
    expect(botBadges(bot('ops', { manager: true }))).toEqual(['Master'])
    expect(botBadges(bot('reviewer', { isDefault: true }))).toEqual(['Default'])
    expect(botBadges(bot('writer'))).toEqual([])
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

describe('where a bot chat came from', () => {
  test('links a Discord mention to its thread, a DM and /ask to their channel', () => {
    expect(botFromLink({ source: 'discord', externalId: 'g1:c1:m1' })).toBe('https://discord.com/channels/g1/m1')
    expect(botFromLink({ source: 'discord', externalId: '@me:d1:m1' })).toBe('https://discord.com/channels/@me/d1')
    expect(botFromLink({ source: 'discord', externalId: 'g1:c1:i99' })).toBe('https://discord.com/channels/g1/c1')
    expect(botFromLink({ source: 'zomfy', fromSessionId: 's1' })).toBeNull()
    expect(botFromLink(undefined)).toBeNull()
  })
})

describe('bot notices', () => {
  test('noticesChanged replaces the notices and leaves the rest', () => {
    const notice = { id: 'n1', botId: 'b-reviewer', kind: 'webhook_alert' as const, hookId: 'wh_1', condition: 'refusal_burst' as const, count: 20, createdAt: 3 }
    const before = { ...INITIAL_BOTS_STATE, bots: [bot('reviewer')] }
    const next = reduceBotsNotification(before, BOT_NOTIFICATIONS.noticesChanged, { notices: [notice] })
    expect(next.notices).toEqual([notice])
    expect(next.bots).toBe(before.bots)
    expect(reduceBotsNotification(next, BOT_NOTIFICATIONS.noticesChanged, { notices: [] }).notices).toEqual([])
  })
})

function automation(id: string, extra: Partial<Automation> = {}): Automation & { hostId: string } {
  return {
    id,
    name: id,
    prompt: 'p',
    agent: 'claude',
    effort: null,
    permissionMode: 'default',
    trigger: { kind: 'schedule', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
    workspaceId: 'w',
    reuseSession: false,
    enabled: true,
    missedRunGraceMinutes: 30,
    createdAt: 1,
    updatedAt: 1,
    hostId: 'local',
    ...extra
  } as Automation & { hostId: string }
}

describe("a bot's automations", () => {
  const reviewer = bot('reviewer', { permissionMode: 'plan' })

  test('are filtered by bot, newest first', () => {
    const list = [
      automation('a', { bot: { botId: 'b-reviewer', runsIn: 'new', resultsTo: 'chat' }, createdAt: 1 }),
      automation('b', { bot: { botId: 'b-writer', runsIn: 'new', resultsTo: 'chat' } }),
      automation('c'),
      automation('d', { bot: { botId: 'b-reviewer', runsIn: 'new', resultsTo: 'none' }, createdAt: 5 })
    ]
    expect(automationsForBot(list, 'b-reviewer').map((a) => a.id)).toEqual(['d', 'a'])
  })

  test("a new schedule runs in the bot's home with its agent", () => {
    const draft = initialAutomationDraft(null, { id: 'elsewhere', hostId: 'remote' }, 'local', { bot: reviewer, mode: 'schedule' })
    expect(draft.hostId).toBe('local')
    const input = automationInputOf({ ...draft, name: 'Daily', prompt: 'look around' })
    expect(input).toMatchObject({
      workspaceId: 'w-reviewer',
      agent: 'claude',
      permissionMode: 'plan',
      trigger: { kind: 'schedule' },
      bot: { botId: 'b-reviewer', runsIn: 'new', resultsTo: 'chat' }
    })
  })

  test('a new trigger saves its source, kinds, places, from, text and a place for results', () => {
    const draft = initialAutomationDraft(null, null, 'local', { bot: reviewer, mode: 'trigger' })
    const input = automationInputOf({
      ...draft,
      bot: {
        ...draft.bot!,
        source: 'github',
        kinds: ['ci_failed', 'nope'],
        places: 'github:1:me/repo\n\n github:1:me/other ',
        from: 'alex',
        textContains: ' flaky ',
        resultsTo: 'ref',
        resultsRef: 'discord:g:c'
      }
    })
    expect(input.trigger).toEqual({ kind: 'github-event', kinds: ['ci_failed'], places: ['github:1:me/repo', 'github:1:me/other'], from: 'alex', textContains: 'flaky' })
    expect(input.bot).toEqual({ botId: 'b-reviewer', runsIn: 'new', resultsTo: { ref: 'discord:g:c' } })
    expect(input.workspaceId).toBe('w-reviewer')
  })

  test('a webhook trigger puts its hook and text filter on webhook', () => {
    const draft = initialAutomationDraft(null, null, 'local', { bot: reviewer, mode: 'trigger' })
    const input = automationInputOf({ ...draft, bot: { ...draft.bot!, source: 'webhook', hookId: 'wh_1', textContains: 'deploy' } })
    expect(input.trigger).toEqual({ kind: 'webhook', kinds: [], places: [], webhook: { hookId: 'wh_1', textContains: 'deploy' } })
  })

  test('editing a bot automation round-trips its fields, the hidden ones too', () => {
    const saved = automation('t', {
      trigger: {
        kind: 'linear-event',
        kinds: ['issue_moved'],
        places: ['linear:o:ENG-1'],
        from: 'u1',
        states: ['Done'],
        team: 'ENG',
        textContains: 'ship'
      },
      workspaceId: 'w-reviewer',
      bot: { botId: 'b-reviewer', runsIn: 'chat', chat: 's1', resultsTo: 'thread' }
    })
    const draft = initialAutomationDraft(saved, null, 'local', { bot: reviewer, mode: 'schedule' })
    expect(draft.bot).toMatchObject({ mode: 'trigger', source: 'linear', runsIn: 'chat', chat: 's1', resultsTo: 'thread' })
    const input = automationInputOf(draft)
    expect(input.trigger).toEqual(saved.trigger)
    expect(input.bot).toEqual(saved.bot!)
    const hook = automation('h', {
      trigger: { kind: 'webhook', kinds: [], places: [], webhook: { hookId: 'wh_2', pick: ['a.b'], textContains: 'x' } },
      bot: { botId: 'b-reviewer', runsIn: 'new', resultsTo: 'none' }
    })
    expect(automationInputOf(initialAutomationDraft(hook, null, 'local', { bot: reviewer, mode: 'trigger' })).trigger).toEqual(hook.trigger)
    expect(initialBotDraft(reviewer, 'trigger', null).resultsTo).toBe('chat')
  })

  test('a plain automation saves as before, with no bot', () => {
    const plain = automation('p', { trigger: { kind: 'agent-finished', workspaceId: null }, workspaceId: null })
    const input = automationInputOf(initialAutomationDraft(plain, null, 'local'))
    expect(input.trigger).toEqual({ kind: 'agent-finished', workspaceId: null })
    expect(input.workspaceId).toBeNull()
    expect('bot' in input).toBe(false)
  })

  test('reads the mint and find results, plain or as an outcome', () => {
    const minted = { hookId: 'wh_1', url: 'https://r/webhooks/wh_1', key: 'k', urlWithKey: 'https://r/webhooks/wh_1/k' }
    expect(mintedHook(minted)).toEqual(minted)
    expect(mintedHook({ ok: true, result: minted })?.hookId).toBe('wh_1')
    expect(() => mintedHook({ ok: false, error: { message: 'not linked' } })).toThrow('not linked')
    expect(foundMembers({ members: [{ id: 'u1', name: 'Alex', handle: 'alex' }, { id: 2 }], complete: true })).toEqual([{ id: 'u1', name: 'Alex', handle: 'alex' }])
  })
})
