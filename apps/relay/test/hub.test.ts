import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { limits, linkSigningText, PING_FRAME } from '../src/contract'
import { deliveryFixtures, eventFixtures, fixtureBot } from '../src/contract/fixtures'
import { configuredSources, type Env } from '../src/env'
import type { Hub } from '../src/hub'
import {
  BASE,
  connect,
  connectAndHello,
  hello,
  hubStub,
  type Link,
  mintInvite,
  newHostKey,
  openLink,
  post,
  registerHost,
  SETUP_CODE
} from './helpers'

const links: Link[] = []
const track = <T extends { link: Link } | Link>(value: T): T => {
  links.push('link' in value ? value.link : value)
  return value
}

afterEach(async () => {
  for (const link of links.splice(0)) link.close()
  // Each test starts from an empty Hub.
  await runInDurableObject(hubStub(), async (_hub: Hub, state) => {
    const sql = state.storage.sql
    for (const { name } of sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").toArray()) {
      sql.exec(`DELETE FROM "${name}"`)
    }
    await state.storage.deleteAlarm()
  })
})

const now = () => Date.now()
const start = (id = 'dl-1', extra: Record<string, unknown> = {}) => {
  const { expiresAt: _e, ...rest } = deliveryFixtures.start
  return { ...rest, id, askedAt: now(), ...extra }
}

/** Makes the given `due` rows fire now, then runs the alarm. */
async function fireDue(keys: string[]) {
  const stub = hubStub()
  await runInDurableObject(stub, (_hub: Hub, state) => {
    for (const key of keys) state.storage.sql.exec('UPDATE due SET at = ? WHERE key = ?', Date.now() - 1, key)
  })
  await runDurableObjectAlarm(stub)
}

describe('health', () => {
  it('reports the version and only the configured sources, without secrets', async () => {
    const res = await SELF.fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(JSON.parse(body)).toMatchObject({ ok: true, contract: 1, sources: ['discord'] })
    expect(body).not.toContain(SETUP_CODE)
    expect(body).not.toContain('marker-discord-token-91c2')
  })

  it('answers 404 for routes of sources that are not configured', async () => {
    expect((await post('/slack/events', {})).status).toBe(404)
    expect((await post('/github/webhook', {})).status).toBe(404)
  })

  it('counts a source as configured only with all of its secrets', () => {
    expect(configuredSources({ DISCORD_APPLICATION_ID: '1', DISCORD_PUBLIC_KEY: 'k' } as Env)).toEqual([])
    expect(configuredSources({ DISCORD_APPLICATION_ID: '1', DISCORD_PUBLIC_KEY: 'k', DISCORD_BOT_TOKEN: 't' } as Env)).toEqual(['discord'])
  })
})

describe('host registration', () => {
  it('registers once with the setup code and refuses a second time', async () => {
    const key = await newHostKey()
    const first = await post('/v1/hosts/register', { setupCode: SETUP_CODE, publicKey: key.publicKey, name: 'Desk' })
    expect(first.status).toBe(200)
    expect((await first.json()) as object).toHaveProperty('hostId')
    const again = await post('/v1/hosts/register', { setupCode: SETUP_CODE, publicKey: key.publicKey, name: 'Desk' })
    expect(again.status).toBe(403)
    expect(await again.json()).toEqual({ error: 'setup_code_used' })
  })

  it('refuses a wrong setup code and a malformed key', async () => {
    const key = await newHostKey()
    const wrong = await post('/v1/hosts/register', { setupCode: 'nope', publicKey: key.publicKey, name: 'Desk' })
    expect(await wrong.json()).toEqual({ error: 'bad_setup_code' })
    const bad = await post('/v1/hosts/register', { setupCode: SETUP_CODE, publicKey: 'x', name: 'Desk' })
    expect(bad.status).toBe(400)
  })

  it('allows one more registration after the setup code is reset', async () => {
    await registerHost()
    let original: Record<string, unknown> = {}
    await runInDurableObject(hubStub(), (hub: Hub) => {
      const self = hub as unknown as { env: Record<string, unknown> }
      original = self.env
      self.env = { ...self.env, SETUP_CODE: 'marker-setup-code-reset' }
    })
    try {
      const key = await newHostKey()
      const res = await post('/v1/hosts/register', { setupCode: 'marker-setup-code-reset', publicKey: key.publicKey, name: 'Laptop' })
      expect(res.status).toBe(200)
      const again = await post('/v1/hosts/register', { setupCode: 'marker-setup-code-reset', publicKey: key.publicKey, name: 'L2' })
      expect(again.status).toBe(403)
    } finally {
      await runInDurableObject(hubStub(), (hub: Hub) => {
        ;(hub as unknown as { env: Record<string, unknown> }).env = original
      })
    }
  })

  it('lets a registered host invite another, once', async () => {
    const { hostId, key } = await registerHost()
    const res = await mintInvite(hostId, key)
    expect(res.status).toBe(200)
    const { invite, expiresAt } = (await res.json()) as { invite: string; expiresAt: number }
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(limits.hostInviteTtlMs)
    const second = await newHostKey()
    expect((await post('/v1/hosts/register', { invite, publicKey: second.publicKey, name: 'Laptop' })).status).toBe(200)
    const third = await newHostKey()
    expect(await (await post('/v1/hosts/register', { invite, publicKey: third.publicKey, name: 'X' })).json()).toEqual({
      error: 'bad_invite'
    })
  })

  it('refuses an invite signed by another key or out of time', async () => {
    const { hostId, key } = await registerHost()
    const stranger = await newHostKey()
    expect((await mintInvite(hostId, stranger)).status).toBe(403)
    expect((await mintInvite(hostId, key, Date.now() - limits.signedRequestSkewMs - 1000)).status).toBe(403)
  })
})

describe('the host link', () => {
  it('closes with 4401 when the signature does not verify', async () => {
    const { hostId } = await registerHost()
    const link = track(await openLink(hostId))
    const challenge = await link.type('challenge')
    const impostor = await newHostKey()
    link.send({ ch: 'link', type: 'auth', signature: await impostor.sign(linkSigningText(hostId, challenge.nonce)) })
    expect((await link.waitClosed())?.code).toBe(limits.closeUnauthorized)
  })

  it('closes with 4401 for an unknown host and for a message before auth', async () => {
    const key = await newHostKey()
    const unknown = track(await openLink('h_nobodyhere1'))
    const challenge = await unknown.type('challenge')
    unknown.send({ ch: 'link', type: 'auth', signature: await key.sign(linkSigningText('h_nobodyhere1', challenge.nonce)) })
    expect((await unknown.waitClosed())?.code).toBe(limits.closeUnauthorized)

    const { hostId } = await registerHost()
    const early = track(await openLink(hostId))
    await early.type('challenge')
    early.send(hello(hostId))
    expect((await early.waitClosed())?.code).toBe(limits.closeUnauthorized)
  })

  it('refuses a revoked host', async () => {
    const { hostId, key } = await registerHost()
    const link = track(await connect(hostId, key))
    await hubStub().revokeHost(hostId)
    expect((await link.waitClosed())?.code).toBe(limits.closeUnauthorized)
    const again = track(await openLink(hostId))
    const challenge = await again.type('challenge')
    again.send({ ch: 'link', type: 'auth', signature: await key.sign(linkSigningText(hostId, challenge.nonce)) })
    expect((await again.waitClosed())?.code).toBe(limits.closeUnauthorized)
  })

  it('answers ping with pong and replaces an older link of the same host', async () => {
    const { hostId, key } = await registerHost()
    const first = track(await connect(hostId, key))
    first.send(PING_FRAME)
    await first.type('pong')
    const second = track(await connect(hostId, key))
    expect((await first.waitClosed())?.code).toBe(limits.closeReplaced)
    expect(second.closed).toBeNull()
  })
})

describe('hello', () => {
  it('stores the bots and gives a new helloRev on every hello', async () => {
    const { hostId, key } = await registerHost()
    const { link, helloRev } = track(await connectAndHello(hostId, key))
    expect(helloRev).toBe(1)
    expect((await hubStub().hostSummary(hostId))?.bots).toEqual([fixtureBot.id])
    link.send(hello(hostId, [{ ...fixtureBot, id: 'bot-2', handle: 'two' }]))
    expect((await link.type('hello-ok')).helloRev).toBe(2)
    expect((await hubStub().hostSummary(hostId))?.bots).toEqual(['bot-2'])
  })

  it('waits for every hello-bots page before hello-ok', async () => {
    const { hostId, key } = await registerHost()
    const link = track(await connect(hostId, key))
    link.send(hello(hostId, [fixtureBot], { pages: 2 }))
    expect(await link.settle()).toBe(0)
    link.send({ ch: 'bots', type: 'hello-bots', page: 2, bots: [{ ...fixtureBot, id: 'bot-2', handle: 'two' }] })
    await link.type('hello-ok')
    expect((await hubStub().hostSummary(hostId))?.bots).toEqual(['bot-2', fixtureBot.id])
  })

  it('answers a stale helloRev with hello_required', async () => {
    const { hostId, key } = await registerHost()
    const { link, helloRev } = track(await connectAndHello(hostId, key))
    link.send({ ch: 'bots', type: 'ack', helloRev: helloRev + 5, deliveryId: 'x', step: 'received' })
    expect((await link.type('error')).code).toBe('hello_required')
  })

  it('ignores unknown types and reports malformed known ones', async () => {
    const { hostId, key } = await registerHost()
    const { link } = track(await connectAndHello(hostId, key))
    link.send({ ch: 'bots', type: 'from-the-future' })
    link.send({ ch: 'video', type: 'frame' })
    expect(await link.settle()).toBe(0)
    link.send({ ch: 'bots', type: 'ack' })
    expect((await link.type('error')).code).toBe('bad_message')
  })
})

describe('deliveries', () => {
  it('delivers once per id, and settles on received then done', async () => {
    const { hostId, key } = await registerHost()
    const { link, helloRev } = track(await connectAndHello(hostId, key))
    const hub = hubStub()
    expect(await hub.enqueue(start())).toEqual({ id: 'dl-1', created: true })
    expect(await hub.enqueue(start())).toEqual({ id: 'dl-1', created: false })
    const message = await link.type('delivery')
    expect(message.helloRev).toBe(helloRev)
    expect(message.deliveries.map((d: { id: string }) => d.id)).toEqual(['dl-1'])
    expect(await link.settle()).toBe(0)

    link.send({ ch: 'bots', type: 'ack', helloRev, deliveryId: 'dl-1', step: 'received' })
    await link.settle(50)
    expect((await hub.deliveryState('dl-1'))?.state).toBe('received')
    link.send({ ch: 'bots', type: 'ack', helloRev, deliveryId: 'dl-1', step: 'done', outcome: 'accepted' })
    await link.settle(50)
    expect(await hub.deliveryState('dl-1')).toMatchObject({ state: 'done', outcome: 'accepted', attempts: 1 })
  })

  it('re-sends a delivery with no received after the lease, with the same id', async () => {
    const { hostId, key } = await registerHost()
    const { link } = track(await connectAndHello(hostId, key))
    await hubStub().enqueue(start())
    await link.type('delivery')
    await fireDue(['lease:dl-1'])
    const again = await link.type('delivery')
    expect(again.deliveries[0].id).toBe('dl-1')
    expect((await hubStub().deliveryState('dl-1'))?.attempts).toBe(2)
  })

  it('does not re-send a received delivery on the lease, but lists it as unsettled after a reconnect', async () => {
    const { hostId, key } = await registerHost()
    const first = await connectAndHello(hostId, key)
    await hubStub().enqueue(start())
    await first.link.type('delivery')
    first.link.send({ ch: 'bots', type: 'ack', helloRev: first.helloRev, deliveryId: 'dl-1', step: 'received' })
    await first.link.settle(50)
    await runDurableObjectAlarm(hubStub())
    expect(await first.link.settle()).toBe(0)
    first.link.close()

    const second = track(await connectAndHello(hostId, key))
    expect(second.unsettled).toEqual(['dl-1'])
    expect((await second.link.type('delivery')).deliveries[0].id).toBe('dl-1')
  })

  it('waits for a host that lists the bot, then delivers on its hello', async () => {
    const { hostId, key } = await registerHost()
    await hubStub().enqueue(start())
    const { link, unsettled } = track(await connectAndHello(hostId, key))
    expect(unsettled).toEqual(['dl-1'])
    expect((await link.type('delivery')).deliveries[0].id).toBe('dl-1')
  })

  it('expires a start after 24 h and an answer after 5 minutes, once', async () => {
    const hub = hubStub()
    const askedAt = now()
    await hub.enqueue(start('dl-start', { askedAt }))
    const { expiresAt: _e, ...answer } = deliveryFixtures.answer
    await hub.enqueue({ ...answer, id: 'dl-answer', askedAt })
    await runInDurableObject(hub, (_h: Hub, state) => {
      const rows = state.storage.sql.exec<{ id: string; expires_at: number }>('SELECT id, expires_at FROM deliveries ORDER BY id').toArray()
      expect(rows).toEqual([
        { id: 'dl-answer', expires_at: askedAt + limits.deliveryTtlMs },
        { id: 'dl-start', expires_at: askedAt + limits.requestWaitMs }
      ])
    })
    await fireDue(['expire:dl-start'])
    expect(await hub.deliveryState('dl-start')).toMatchObject({ state: 'done', outcome: 'expired' })
    expect((await hub.deliveryState('dl-answer'))?.state).toBe('pending')
    await fireDue(['expire:dl-answer'])
    expect(await hub.deliveryState('dl-answer')).toMatchObject({ state: 'done', outcome: 'expired' })

    // A late host gets neither.
    const { hostId, key } = await registerHost()
    const { link, unsettled } = track(await connectAndHello(hostId, key))
    expect(unsettled).toEqual([])
    expect(await link.settle()).toBe(0)
  })

  it('batches at most 20 deliveries per message', async () => {
    const hub = hubStub()
    for (let i = 0; i < 25; i++) await hub.enqueue(start(`dl-${String(i).padStart(2, '0')}`))
    const { hostId, key } = await registerHost()
    const { link } = track(await connectAndHello(hostId, key))
    const first = await link.type('delivery')
    const second = await link.type('delivery')
    expect([first.deliveries.length, second.deliveries.length]).toEqual([20, 5])
  })
})

describe('events and actions', () => {
  it('ignores a batch whose seq was already seen', async () => {
    const { hostId, key } = await registerHost()
    const { link, helloRev } = track(await connectAndHello(hostId, key))
    link.send({ ch: 'bots', type: 'events', helloRev, seq: 0, events: [eventFixtures.linked] })
    await link.settle(50)
    expect((await hubStub().hostSummary(hostId))?.conversations).toEqual([{ external_id: 'g1:c1:t1', session_id: 's-1' }])
    link.send({ ch: 'bots', type: 'events', helloRev, seq: 0, events: [eventFixtures.unlinked] })
    await link.settle(50)
    expect((await hubStub().hostSummary(hostId))?.conversations).toHaveLength(1)
    link.send({ ch: 'bots', type: 'events', helloRev, seq: 1, events: [{ kind: 'from-the-future' }, eventFixtures.unlinked] })
    await link.settle(50)
    expect(await hubStub().hostSummary(hostId)).toMatchObject({ lastSeq: 1, conversations: [] })
  })

  it('answers capabilities and refuses verbs it does not have yet', async () => {
    const { hostId, key } = await registerHost()
    const { link, helloRev } = track(await connectAndHello(hostId, key))
    link.send({ ch: 'bots', type: 'action', helloRev, reqId: 'r1', verb: 'capabilities' })
    expect(await link.type('action-result')).toMatchObject({ reqId: 'r1', ok: true })
    link.send({ ch: 'bots', type: 'action', helloRev, reqId: 'r2', verb: 'post', ref: 'discord:g1:c1', idempotencyKey: 'k' })
    expect(await link.type('action-result')).toMatchObject({ reqId: 'r2', ok: false, error: { code: 'unsupported' } })
  })
})

describe('secrets', () => {
  it('keeps no secret value in storage', async () => {
    const { hostId, key } = await registerHost()
    const { link, helloRev } = track(await connectAndHello(hostId, key))
    await hubStub().enqueue(start())
    await link.type('delivery')
    link.send({ ch: 'bots', type: 'ack', helloRev, deliveryId: 'dl-1', step: 'done', outcome: 'accepted' })
    await link.settle(50)
    const dump = await hubStub().dumpStorage()
    expect(dump).toContain(hostId)
    expect(dump).not.toContain(SETUP_CODE)
  })
})
