import { describe, expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { encodePairingOffer, GATEWAY_CLOSE, PERMISSION_ASK_META, SESSION_REPLAY_META, type HarnessState, type SessionInfo } from '@zomfy/protocol'
import { AskStore, optionResponse } from './asks'
import { ChatSession } from './chat-session'
import { HostConnection } from './host-connection'
import { loadHosts, pairFromOffer, removeHost, saveHost, type KeyValueStore } from './host-registry'
import { readOffer } from './pairing'
import { FakeGateway, FakeTimers, flush, testRandomBytes } from './testing'

const LAN = 'http://192.168.1.20:7802'
const TAILNET = 'http://100.64.0.2:7802'

const harness: HarnessState = {
  host: { id: 'local', label: 'Desk', platform: 'win32' },
  projects: [],
  workspaces: [],
  floatingWorkspaceId: 'float'
}
const session = (id: string, status: SessionInfo['status'] = 'idle'): SessionInfo => ({
  id,
  workspaceId: 'w1',
  cwd: '/repo',
  title: id,
  status,
  createdAt: 0,
  turnStartedAt: null
})

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k)
  }
}

async function setup(live: string[] = [LAN, TAILNET]) {
  const g = new FakeGateway('host-1', 'Desk')
  for (const url of live) g.live.add(url)
  g.live.add(TAILNET)
  g.grants.add('grant-1')
  g.handlers.set('initialize', () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true } }))
  g.handlers.set('_harness/state/get', () => harness)
  g.handlers.set('_harness/sessions/list', () => [session('s1')])
  const link = encodePairingOffer({
    v: 1,
    hostId: 'host-1',
    hostName: 'Desk',
    routes: [
      { kind: 'lan', url: LAN },
      { kind: 'tailnet', url: TAILNET }
    ],
    hostBoxPublicKey: 'AAAA',
    grant: 'grant-1',
    expiresAt: Date.now() + 600_000,
    scopes: ['chats:read', 'chats:operate']
  })
  const host = await pairFromOffer({ offer: readOffer(link), name: 'Pixel', model: 'Pixel 9', fetch: g.fetch, randomBytes: testRandomBytes })
  const asks = new AskStore()
  const timers = new FakeTimers()
  const connection = new HostConnection(host, {
    fetch: g.fetch,
    createSocket: g.createSocket,
    asks,
    clientVersion: '0.1.0',
    timers,
    random: () => 0
  })
  return { g, host, asks, timers, connection }
}

async function until(check: () => boolean, label = 'condition'): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await flush(2)
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('pairing and the host registry', () => {
  test('pairs on the first live route and stores the host by id', async () => {
    const { host, g } = await setup()
    expect(host.deviceId).toBe('device-1')
    expect(host.routes.map((r) => r.kind)).toEqual(['lan', 'tailnet'])
    expect(g.grants.size).toBe(0)
    const store = memoryStore()
    await saveHost(store, host)
    await saveHost(store, { ...host, hostName: 'Desk 2' })
    const loaded = await loadHosts(store)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.hostName).toBe('Desk 2')
    await removeHost(store, host.hostId)
    expect(await loadHosts(store)).toEqual([])
    expect([...store.data.keys()]).toEqual(['zomfy.hosts'])
  })
})

describe('host connection', () => {
  test('connects, initializes, and loads the host lists', async () => {
    const { g, connection } = await setup()
    connection.start()
    await until(() => connection.state.get().status === 'connected', 'connected')
    const state = connection.state.get()
    expect(state.route?.kind).toBe('lan')
    expect(state.sessions.map((s) => s.id)).toEqual(['s1'])
    expect(state.harness?.host.label).toBe('Desk')
    expect(state.generation).toBe(1)
    const init = g.received.find((m) => m.method === 'initialize')
    expect(init?.params).toEqual({ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'zomfy-android', version: '0.1.0' } })
    connection.stop()
  })

  test('follows sessions/changed and state/changed', async () => {
    const { g, connection } = await setup()
    connection.start()
    await until(() => connection.state.get().status === 'connected')
    g.notify('_harness/sessions/changed', [session('s1', 'working'), session('s2')])
    g.notify('_harness/state/changed', { ...harness, floatingWorkspaceId: 'f2' })
    await until(() => connection.state.get().sessions.length === 2)
    expect(connection.state.get().sessions[0]!.status).toBe('working')
    expect(connection.state.get().harness?.floatingWorkspaceId).toBe('f2')
    connection.stop()
  })

  test('falls back to the tailnet and moves back to the LAN when it recovers', async () => {
    const { g, connection, timers } = await setup()
    g.live.delete(LAN)
    connection.start()
    await until(() => connection.state.get().status === 'connected')
    expect(connection.state.get().route?.kind).toBe('tailnet')
    g.live.add(LAN)
    await timers.advance(10_000)
    await until(() => connection.state.get().status === 'connected' && connection.state.get().route?.kind === 'lan', 'back on lan')
    expect(connection.state.get().generation).toBe(2)
    connection.stop()
  })

  test('reconnects with backoff after the socket drops', async () => {
    const { g, connection, timers } = await setup()
    connection.start()
    await until(() => connection.state.get().status === 'connected')
    g.live.clear()
    g.openSocket!.close(1006)
    await until(() => connection.state.get().status === 'offline', 'offline')
    expect(connection.state.get().nextRetryAt).not.toBeNull()
    g.live.add(LAN)
    await timers.advance(1000)
    await until(() => connection.state.get().status === 'connected', 'reconnected')
    expect(connection.state.get().generation).toBe(2)
    connection.stop()
  })

  test('a revoke stops reconnecting and reads as unpaired', async () => {
    const { g, connection, timers } = await setup()
    connection.start()
    await until(() => connection.state.get().status === 'connected')
    g.openSocket!.close(GATEWAY_CLOSE.revoked)
    await until(() => connection.state.get().status === 'unpaired', 'unpaired')
    expect(connection.state.get().error).toContain('pair again')
    expect(timers.pending).toBe(0)
  })

  test('a permission request becomes an ask; the answer goes back on the socket', async () => {
    const { g, connection, asks } = await setup()
    connection.start()
    await until(() => connection.state.get().status === 'connected')
    const answer = g.ask('session/request_permission', {
      sessionId: 's1',
      toolCall: { toolCallId: 't1', title: 'Run rm' },
      options: [{ kind: 'allow_once', name: 'Allow', optionId: 'allow' }],
      _meta: { [PERMISSION_ASK_META.askId]: 'ask-1' }
    })
    await until(() => asks.asks.get().length === 1, 'ask')
    asks.answer('host-1/ask-1', optionResponse('allow'))
    expect(await answer).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })

    g.ask('session/request_permission', {
      sessionId: 's1',
      toolCall: { toolCallId: 't2', title: 'Run ls' },
      options: [],
      _meta: { [PERMISSION_ASK_META.askId]: 'ask-2' }
    })
    await until(() => asks.asks.get().length === 1, 'second ask')
    g.notify('_harness/permissions/resolved', { sessionId: 's1', askId: 'ask-2', optionId: 'allow' })
    await until(() => asks.asks.get().length === 0, 'resolved elsewhere')
    connection.stop()
  })
})

describe('chat session', () => {
  test('loads the replay from the response, splices racing updates, streams, and reloads after a reconnect', async () => {
    const { g, connection, timers } = await setup()
    let replay: acp.SessionUpdate[] = [
      { sessionUpdate: 'user_message_chunk', messageId: 'm1', content: { type: 'text', text: 'hi' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } }
    ]
    g.handlers.set('session/load', (params) => {
      const p = params as { _meta?: Record<string, unknown> }
      expect(p._meta?.[SESSION_REPLAY_META.inResponse]).toBe(true)
      // A live update that the replay already holds (seq 2) and one after it (seq 3) race the answer.
      g.notify('session/update', { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' dup' } }, _meta: { [SESSION_REPLAY_META.seq]: 2 } })
      g.notify('session/update', { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' there' } }, _meta: { [SESSION_REPLAY_META.seq]: 3 } })
      return new Promise((resolve) =>
        setTimeout(() => resolve({ _meta: { [SESSION_REPLAY_META.replayedThrough]: 2, [SESSION_REPLAY_META.updates]: replay } }), 5)
      )
    })
    g.handlers.set('session/prompt', () => ({ stopReason: 'end_turn' }))
    connection.start()
    await until(() => connection.state.get().status === 'connected')

    const chat = new ChatSession(connection, 's1')
    chat.open()
    await until(() => !chat.state.get().loading, 'loaded')
    expect(chat.state.get().items.map((i) => (i as { text: string }).text)).toEqual(['hi', 'Hello there'])

    // Live updates for other chats are ignored; this chat's stream in.
    g.notify('session/update', { sessionId: 's2', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } } })
    g.notify('session/update', { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '!' } } })
    await until(() => (chat.state.get().items.at(-1) as { text: string }).text === 'Hello there!', 'streamed')

    expect(await chat.send('  next  ')).toEqual({ sent: true })
    expect(g.received.find((m) => m.method === 'session/prompt')?.params).toEqual({ sessionId: 's1', prompt: [{ type: 'text', text: 'next' }] })
    chat.stop()
    await until(() => g.received.some((m) => m.method === 'session/cancel'), 'cancel')
    expect(g.received.find((m) => m.method === 'session/cancel')).toEqual({ method: 'session/cancel', params: { sessionId: 's1' } })

    // After a reconnect the transcript is replaced by a fresh replay.
    replay = [{ sessionUpdate: 'user_message_chunk', messageId: 'm1', content: { type: 'text', text: 'fresh' } }]
    g.openSocket!.close(1006)
    await until(() => connection.state.get().status === 'offline')
    await timers.advance(1000)
    await until(() => connection.state.get().generation === 2, 'reconnected')
    await until(() => !chat.state.get().loading && (chat.state.get().items[0] as { text: string } | undefined)?.text === 'fresh', 'reloaded')
    // The racing update after the replay (seq 3) is spliced on again; the one inside it (seq 2) is not.
    expect(chat.state.get().items.map((i) => (i as { text: string }).text)).toEqual(['fresh', ' there'])
    chat.close()
    connection.stop()
  })
})
