import { describe, expect, test } from 'bun:test'
import { encodePairingOffer, type Bot, type DeviceScope, type HarnessState, type SessionInfo } from '@zomfy/protocol'
import { AskStore } from './asks'
import { botAvatar, botColour, botOfChat, canTalk, NOTHING_TO_SEND, recentBotChats, sortBots, startBotChat } from './bots'
import { HostConnection } from './host-connection'
import { pairFromOffer } from './host-registry'
import { readOffer } from './pairing'
import { FakeGateway, FakeTimers, flush, testRandomBytes } from './testing'

const bot = (id: string, patch: Partial<Bot> = {}): Bot => ({
  id,
  name: `Bot ${id}`,
  handle: id,
  avatar: null,
  purpose: null,
  agent: 'claude',
  model: null,
  permissionMode: 'default',
  homeWorkspaceId: `home-${id}`,
  owner: {},
  askers: {},
  paused: false,
  createdAt: 0,
  ...patch
})

const chat = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  workspaceId: 'w1',
  cwd: '/repo',
  title: id,
  status: 'idle',
  createdAt: 0,
  turnStartedAt: null,
  ...patch
})

describe('bots', () => {
  test('an avatar is a picture for image URLs, else its first two characters, else the name initial', () => {
    expect(botAvatar(bot('a', { avatar: 'https://x/y.png' }))).toEqual({ kind: 'image', uri: 'https://x/y.png' })
    expect(botAvatar(bot('a', { avatar: 'data:image/png;base64,AAA' }))).toEqual({ kind: 'image', uri: 'data:image/png;base64,AAA' })
    expect(botAvatar(bot('a', { avatar: '🦊🐻🐼' }))).toEqual({ kind: 'text', text: '🦊🐻' })
    expect(botAvatar(bot('a', { name: 'reviewer' }))).toEqual({ kind: 'text', text: 'R' })
    expect(botAvatar(bot('a', { name: '  ', handle: 'ops' }))).toEqual({ kind: 'text', text: 'O' })
    expect(botColour('reviewer')).toBe(botColour('reviewer'))
  })

  test('a bot chat names its bot; other chats and unknown bots do not', () => {
    const bots = [bot('a'), bot('b')]
    expect(botOfChat(chat('c', { origin: 'bot', botId: 'b' }), bots)?.id).toBe('b')
    expect(botOfChat(chat('c', { origin: 'bot', botId: 'gone' }), bots)).toBeNull()
    expect(botOfChat(chat('c', { botId: 'b' }), bots)).toBeNull()
    expect(botOfChat(chat('c', { origin: 'bot', botId: 'b' }), null)).toBeNull()
  })

  test('recent chats per bot: newest first, archived left out, at most the limit', () => {
    const sessions = [
      chat('old', { origin: 'bot', botId: 'a', createdAt: 1 }),
      chat('new', { origin: 'bot', botId: 'a', createdAt: 2, lastActivityAt: 50 }),
      chat('mid', { origin: 'bot', botId: 'a', createdAt: 10 }),
      chat('archived', { origin: 'bot', botId: 'a', createdAt: 99, archived: true }),
      chat('plain', { createdAt: 100 }),
      chat('other', { origin: 'bot', botId: 'b', createdAt: 3 })
    ]
    const recent = recentBotChats(sessions, 2)
    expect(recent.get('a')?.map((s) => s.id)).toEqual(['new', 'mid'])
    expect(recent.get('b')?.map((s) => s.id)).toEqual(['other'])
    expect(recent.has('plain')).toBe(false)
  })

  test('the default bot is listed first, then by name; talking needs chats:operate and an unpaused bot', () => {
    expect(sortBots([bot('z', { name: 'Zed' }), bot('a', { name: 'Ann' }), bot('d', { name: 'Dee', isDefault: true })]).map((b) => b.id)).toEqual(['d', 'a', 'z'])
    expect(canTalk(bot('a'), ['chats:read', 'chats:operate'])).toBe(true)
    expect(canTalk(bot('a'), ['chats:read', 'bots:read'])).toBe(false)
    expect(canTalk(bot('a', { paused: true }), ['chats:operate'])).toBe(false)
  })

  test('starting a chat sends the trimmed first message and returns the new chat', async () => {
    const calls: { method: string; params: unknown }[] = []
    const connection = {
      request: async <T>(method: string, params?: unknown): Promise<T> => {
        calls.push({ method, params })
        return { sessionId: 'new-chat' } as T
      }
    }
    expect(await startBotChat(connection, 'a', '  hello  ')).toBe('new-chat')
    expect(calls).toEqual([{ method: '_harness/bots/chatCreate', params: { id: 'a', text: 'hello' } }])
    await expect(startBotChat(connection, 'a', '   ')).rejects.toThrow(NOTHING_TO_SEND)
    expect(calls).toHaveLength(1)
  })
})

const LAN = 'http://192.168.1.20:7802'
const harness: HarnessState = { host: { id: 'local', label: 'Desk', platform: 'win32' }, projects: [], workspaces: [], floatingWorkspaceId: 'float' }

async function connected(scopes: DeviceScope[], bots: Bot[] | 'missing' = [bot('a')]) {
  const g = new FakeGateway('host-1', 'Desk')
  g.live.add(LAN)
  g.grants.add('grant-1')
  g.scopes = scopes
  g.handlers.set('initialize', () => ({ protocolVersion: 1, agentCapabilities: {} }))
  g.handlers.set('_harness/state/get', () => harness)
  g.handlers.set('_harness/sessions/list', () => [])
  if (bots !== 'missing') g.handlers.set('_harness/bots/list', () => ({ bots }))
  const link = encodePairingOffer({
    v: 1,
    hostId: 'host-1',
    hostName: 'Desk',
    routes: [{ kind: 'lan', url: LAN }],
    hostBoxPublicKey: 'AAAA',
    grant: 'grant-1',
    expiresAt: Date.now() + 600_000,
    scopes
  })
  const host = await pairFromOffer({ offer: readOffer(link), name: 'Pixel', model: null, fetch: g.fetch, randomBytes: testRandomBytes })
  const connection = new HostConnection(host, { fetch: g.fetch, createSocket: g.createSocket, asks: new AskStore(), clientVersion: '0.1.0', timers: new FakeTimers(), random: () => 0 })
  connection.start()
  for (let i = 0; i < 100 && connection.state.get().status !== 'connected'; i++) await flush(2)
  expect(connection.state.get().status).toBe('connected')
  return { g, connection }
}

describe('the connection keeps the host bots', () => {
  test('loads them with bots:read and follows bots/changed', async () => {
    const { g, connection } = await connected(['chats:read', 'chats:operate', 'bots:read'])
    expect(connection.state.get().bots?.map((b) => b.id)).toEqual(['a'])
    g.notify('_harness/bots/changed', { bots: [bot('a', { paused: true }), bot('b')] })
    for (let i = 0; i < 50 && connection.state.get().bots?.length !== 2; i++) await flush(2)
    expect(connection.state.get().bots?.map((b) => [b.id, b.paused])).toEqual([['a', true], ['b', false]])
    connection.stop()
  })

  test('does not ask for them without bots:read', async () => {
    const { g, connection } = await connected(['chats:read', 'chats:operate'])
    expect(connection.state.get().bots).toBeNull()
    expect(g.received.some((m) => m.method === '_harness/bots/list')).toBe(false)
    connection.stop()
  })

  test('a host that cannot list bots still connects', async () => {
    const { connection } = await connected(['chats:read', 'bots:read'], 'missing')
    expect(connection.state.get().bots).toBeNull()
    connection.stop()
  })
})
