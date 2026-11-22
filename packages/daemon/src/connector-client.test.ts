import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectorStatus } from '@zomfy/protocol'
import { deliveryFixtures, fixtureBot } from '@zomfy/relay-contract/src/fixtures'
import type { Delivery, HelloBot } from '@zomfy/relay-contract'
import { ConnectorClient, type DeliveryResult } from './connector-client'
import { ReceiptStore, receiptsPath } from './connector-receipts'
import { backoffDelay } from './relay-link'
import { eventually, FakeHub } from './relay-fake-hub.fixture'
import { loadOrCreateHostKey, pairWithRelay, readRelayConfig, RelayPairingError, relayDir, unpairRelay } from './relay-pairing'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'zomfy-connector-'))
  cleanups.push(() => rmSync(home, { recursive: true, force: true }))
  return home
}

async function fakeHub() {
  const hub = new FakeHub()
  cleanups.push(() => hub.stop())
  return hub
}

function start(id: string, extra: Partial<Delivery> = {}): Delivery {
  return { ...deliveryFixtures.start, id, askedAt: Date.now(), expiresAt: Date.now() + 60_000, ...extra } as Delivery
}

interface Setup {
  hub: FakeHub
  home: string
  client: ConnectorClient
  handled: string[]
  statuses: ConnectorStatus[]
  receipts: ReceiptStore
}

async function setup(
  options: {
    hub?: FakeHub
    home?: string
    bots?: HelloBot[]
    handle?: (d: Delivery) => Promise<DeliveryResult>
    pingIntervalMs?: number
  } = {}
): Promise<Setup> {
  const hub = options.hub ?? (await fakeHub())
  const home = options.home ?? tempHome()
  const config = readRelayConfig(home) ?? (await pairWithRelay(home, { relayUrl: hub.url, setupCode: hub.setupCode, hostName: 'Desk' }))
  const receipts = new ReceiptStore(receiptsPath(home))
  const handled: string[] = []
  const statuses: ConnectorStatus[] = []
  const client = new ConnectorClient({
    config,
    key: loadOrCreateHostKey(home),
    host: { id: config.hostId, name: 'Desk', kind: 'desktop' },
    receipts,
    bots: () => options.bots ?? [fixtureBot],
    handle:
      options.handle ??
      (async (d) => {
        handled.push(d.id)
        return { outcome: 'accepted' }
      }),
    onStatus: (s) => statuses.push(s),
    link: { backoff: { minMs: 10, maxMs: 40 }, pingIntervalMs: options.pingIntervalMs }
  })
  cleanups.push(() => {
    client.stop()
    receipts.close()
  })
  return { hub, home, client, handled, statuses, receipts }
}

async function online(s: Setup, connections = 1) {
  s.client.start()
  await eventually(() => s.hub.connections >= connections && s.client.rev > 0, 5000, 'hello-ok')
}

describe('pairing', () => {
  test('registers the host key once and keeps it', async () => {
    const hub = await fakeHub()
    const home = tempHome()
    const config = await pairWithRelay(home, { relayUrl: `${hub.url}/`, setupCode: ` ${hub.setupCode} `, hostName: 'Desk' })
    expect(config.relayUrl).toBe(hub.url)
    expect(config.hostId).toMatch(/^h_/)
    expect(readRelayConfig(home)).toEqual(config)
    expect(existsSync(join(relayDir(home), 'host-key'))).toBe(true)
    expect(loadOrCreateHostKey(home).publicKey).toBe(loadOrCreateHostKey(home).publicKey)

    const again = pairWithRelay(home, { relayUrl: hub.url, setupCode: hub.setupCode, hostName: 'Desk' })
    await expect(again).rejects.toBeInstanceOf(RelayPairingError)
    await expect(again).rejects.toMatchObject({ code: 'setup_code_used' })
    await expect(pairWithRelay(tempHome(), { relayUrl: hub.url, setupCode: 'wrong', hostName: 'X' })).rejects.toMatchObject({
      code: 'bad_setup_code'
    })
  })

  test('refuses a relay URL that is not http(s), and unpairing forgets the key', async () => {
    const home = tempHome()
    await expect(pairWithRelay(home, { relayUrl: 'ftp://x', setupCode: 'a', hostName: 'X' })).rejects.toThrow()
    const before = loadOrCreateHostKey(home).publicKey
    unpairRelay(home)
    expect(readRelayConfig(home)).toBeNull()
    expect(loadOrCreateHostKey(home).publicKey).not.toBe(before)
  })
})

describe('the link', () => {
  test('proves the key, says hello with the bots, and reports online with the relay sources', async () => {
    const s = await setup()
    await online(s)
    expect(s.hub.hellos).toHaveLength(1)
    expect(s.hub.hellos[0]).toMatchObject({ contract: 1, bots: [{ id: fixtureBot.id }], pages: 1 })
    await eventually(() => s.client.status().sources.includes('discord'), 2000, 'sources')
    expect(s.client.status()).toMatchObject({ state: 'online', relayUrl: s.hub.url, hostId: expect.stringMatching(/^h_/) })
  })

  test('reconnects with backoff after a drop and says hello again', async () => {
    const s = await setup()
    await online(s)
    s.hub.dropAll()
    await eventually(() => s.statuses.some((st) => st.state === 'offline' && st.retryAt !== null), 2000, 'offline')
    await eventually(() => s.hub.connections === 2 && s.hub.hellos.length === 2, 5000, 'second hello')
    expect(s.client.status().state).toBe('online')
  })

  test('stops retrying when the relay refuses the key', async () => {
    const s = await setup()
    await online(s)
    s.hub.revokeAll()
    await eventually(() => s.client.status().state === 'unauthorized', 2000, 'unauthorized')
    await Bun.sleep(150)
    expect(s.hub.connections).toBe(1)
  })

  test('drops a link that stops answering pings, and comes back', async () => {
    const s = await setup({ pingIntervalMs: 40 })
    await online(s)
    s.hub.silent = true
    await eventually(() => s.statuses.some((st) => st.error === 'no answer to ping'), 3000, 'ping timeout')
    s.hub.silent = false
    await eventually(() => s.hub.connections >= 2, 5000, 'reconnect')
  })

  test('announces more than 20 bots in hello-bots pages', async () => {
    const bots = Array.from({ length: 45 }, (_, i) => ({ ...fixtureBot, id: `bot-${i}`, handle: `bot${i}` }))
    const s = await setup({ bots })
    await online(s)
    expect(s.hub.hellos[0]).toMatchObject({ pages: 3 })
    expect(s.hub.hellos[0]!.bots).toHaveLength(20)
    const pages = s.hub.frames.filter((f) => (f as { type: string }).type === 'hello-bots') as Array<{ page: number; bots: unknown[] }>
    expect(pages.map((p) => [p.page, p.bots.length])).toEqual([
      [2, 20],
      [3, 5]
    ])
  })

  test('says hello again when the relay answers hello_required, or bots change', async () => {
    const s = await setup()
    await online(s)
    s.hub.send({ ch: 'bots', type: 'error', code: 'hello_required', message: 'again' })
    await eventually(() => s.hub.hellos.length === 2, 2000, 'second hello')
    s.client.botsChanged()
    await eventually(() => s.hub.hellos.length === 3, 2000, 'third hello')
  })
})

describe('deliveries', () => {
  test('writes a receipt, acks received, runs the delivery once and acks done', async () => {
    const s = await setup()
    await online(s)
    s.hub.push(start('dl-1'))
    await eventually(() => s.hub.acksFor('dl-1').length === 2, 2000, 'acks')
    expect(s.hub.acksFor('dl-1')).toEqual(['received', 'done:accepted'])
    expect(s.handled).toEqual(['dl-1'])
    expect(s.receipts.get('dl-1')).toMatchObject({ kind: 'start', outcome: 'accepted' })

    // The Hub re-sends it (a lost ack): acked again from the receipt, not run again.
    s.hub.resend('dl-1')
    await eventually(() => s.hub.acksFor('dl-1').length === 4, 2000, 'second acks')
    expect(s.hub.acksFor('dl-1')).toEqual(['received', 'done:accepted', 'received', 'done:accepted'])
    expect(s.handled).toEqual(['dl-1'])
  })

  test('a delivery received before a crash is acked again after restart but not run again', async () => {
    const hub = await fakeHub()
    const home = tempHome()
    const first = await setup({ hub, home, handle: () => new Promise<DeliveryResult>(() => {}) })
    await online(first)
    hub.push(start('dl-crash'))
    await eventually(() => hub.acksFor('dl-crash').includes('received'), 2000, 'received')
    // Crash: the turn never finished, the process goes away.
    first.client.stop()
    first.receipts.close()

    const second = await setup({ hub, home })
    await online(second, 2)
    await eventually(() => hub.acksFor('dl-crash').length === 2, 2000, 'replayed ack')
    await Bun.sleep(50)
    expect(hub.acksFor('dl-crash')).toEqual(['received', 'received'])
    expect(second.handled).toEqual([])
  })

  test('re-sent open deliveries after a reconnect are settled from receipts', async () => {
    const s = await setup()
    await online(s)
    s.hub.push(start('dl-a'))
    await eventually(() => s.hub.acksFor('dl-a').length === 2, 2000, 'acks')
    s.hub.push(start('dl-b'))
    await eventually(() => s.hub.acksFor('dl-b').length === 2, 2000, 'acks b')
    s.hub.dropAll()
    await eventually(() => s.hub.hellos.length === 2, 5000, 'second hello')
    expect(s.handled).toEqual(['dl-a', 'dl-b'])
  })

  test('acks an unknown kind as unsupported and an expired one as expired, without running them', async () => {
    const s = await setup()
    await online(s)
    s.hub.push({ ...start('dl-new'), kind: 'teleport' } as unknown as Delivery)
    s.hub.push(start('dl-old', { expiresAt: Date.now() - 1 }))
    await eventually(() => s.hub.acksFor('dl-new').length === 2 && s.hub.acksFor('dl-old').length === 2, 2000, 'acks')
    expect(s.hub.acksFor('dl-new')).toEqual(['received', 'done:unsupported'])
    expect(s.hub.acksFor('dl-old')).toEqual(['received', 'done:expired'])
    expect(s.handled).toEqual([])
  })

  test('a handler that throws is acked done refused with agent_error', async () => {
    const s = await setup({
      handle: async () => {
        throw new Error('boom')
      }
    })
    await online(s)
    s.hub.push(start('dl-x'))
    await eventually(() => s.hub.acksFor('dl-x').length === 2, 2000, 'acks')
    expect(s.hub.acks.find((a) => a.deliveryId === 'dl-x' && a.step === 'done')).toMatchObject({
      outcome: 'refused',
      failure: { category: 'agent_error' }
    })
  })
})

test('backoff doubles from 1 s to 30 s with jitter in the upper half', () => {
  expect(backoffDelay(0, () => 0)).toBe(1000)
  expect(backoffDelay(0, () => 1)).toBe(1000)
  expect(backoffDelay(3, () => 0)).toBe(4000)
  expect(backoffDelay(3, () => 1)).toBe(8000)
  expect(backoffDelay(20, () => 1)).toBe(30_000)
  expect(backoffDelay(20, () => 0)).toBe(15_000)
})
