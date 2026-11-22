import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fixtureBot } from '../src/contract/fixtures'
import type { DiscordGateway } from '../src/discord-gateway'
import { splitMessage } from '../src/discord/format'
import type { Hub } from '../src/hub'
import { BASE, connectAndHello, hubStub, type Link, registerHost, testEnv } from './helpers'

// A test-only key pair; its public half is DISCORD_PUBLIC_KEY in vitest.config.ts.
const PRIVATE_KEY_PKCS8 = 'MC4CAQAwBQYDK2VwBCIEIOxzvVTiRMLBQFFYbEWwyiGMWc8LxjWTPxF6h86a2XMt'
const APP = '1000'

const fake = async (what: string, body?: unknown): Promise<any> => {
  const res = await testEnv.DISCORD_TRANSPORT!.fetch(`https://fake.test/_test/${what}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return res.json()
}

const gatewayStub = () => testEnv.DISCORD_GATEWAY.get(testEnv.DISCORD_GATEWAY.idFromName('discord'))

async function until<T>(check: () => Promise<T | undefined | null | false>, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value && !(Array.isArray(value) && value.length === 0)) return value
    if (Date.now() > deadline) throw new Error(`timed out; rest: ${JSON.stringify((await rest()).map((c) => [c.method, c.path, c.body?.content]))}`)
    await new Promise((r) => setTimeout(r, 30))
  }
}

const rest = async () => ((await fake('state')).rest as { method: string; path: string; body: any }[])
const calls = async (method: string, pattern: RegExp) => (await rest()).filter((c) => c.method === method && pattern.test(c.path))

async function signed(body: unknown, opts: { badSignature?: boolean; at?: number } = {}): Promise<Response> {
  const text = JSON.stringify(body)
  const timestamp = String(Math.floor((opts.at ?? Date.now()) / 1000))
  const raw = Uint8Array.from(atob(PRIVATE_KEY_PKCS8), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'Ed25519' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(timestamp + text)))
  if (opts.badSignature) sig[0] = sig[0]! ^ 0xff
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
  return SELF.fetch(`${BASE}/discord/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': hex, 'X-Signature-Timestamp': timestamp },
    body: text
  })
}

let nextId = 9_000_000
const snowflake = () => String(++nextId)
const user = (id: string, name = id) => ({ id, username: name, global_name: name })

function mention(content: string, author = 'u-owner', extra: Record<string, unknown> = {}) {
  return { id: snowflake(), channel_id: 'c1', guild_id: 'g1', author: user(author), content: `<@${APP}> ${content}`, mentions: [{ id: APP }], timestamp: new Date().toISOString(), attachments: [], ...extra }
}

const secondBot = { ...fixtureBot, id: 'bot-second', handle: 'second', name: 'Second', isDefault: false }

let link: Link
let helloRev: number
let seq = 0
const links: Link[] = []

async function pair() {
  const { hostId, key } = await registerHost()
  const opened = await connectAndHello(hostId, key, [fixtureBot, secondBot])
  link = opened.link
  helloRev = opened.helloRev
  seq = 0
  links.push(link)
}

const deliveries = (kind?: string) => link.frames.filter((f) => f.type === 'delivery').flatMap((f) => f.deliveries).filter((d: any) => !kind || d.kind === kind)
const nextDelivery = async (kind: string) => {
  const frame = await link.take((f) => f.type === 'delivery' && f.deliveries.some((d: any) => d.kind === kind))
  return frame.deliveries.find((d: any) => d.kind === kind)
}
const sendEvents = (events: unknown[]) => link.send({ ch: 'bots', type: 'events', helloRev, seq: seq++, events })

async function dispatch(d: unknown) {
  await fake('dispatch', { t: 'MESSAGE_CREATE', d })
}

/** Starts a conversation in #c1 and returns its delivery. */
async function startInChannel(text = 'reviewer fix the typo in README') {
  const msg = mention(text)
  await dispatch(msg)
  const start = await nextDelivery('start')
  return { msg, start, conversation: start.conversation as { source: 'discord'; externalId: string } }
}

beforeAll(async () => {
  await fake('reset')
  await fake('config', {
    channels: { 'c1': 0, 'th-existing': 11 },
    messages: {
      c1: [
        { id: '3', channel_id: 'c1', author: user('u-stranger'), content: 'secret plans', timestamp: new Date().toISOString() },
        { id: '2', channel_id: 'c1', author: { id: APP, username: 'Zomfy', bot: true }, content: 'earlier answer' },
        { id: '1', channel_id: 'c1', author: user('u-member'), content: 'see line 3' }
      ]
    }
  })
  await gatewayStub().ensure()
  await until(async () => (await gatewayStub().status()).state === 'ready')
})

afterEach(async () => {
  for (const l of links.splice(0)) l.close()
  await runInDurableObject(hubStub(), async (_hub: Hub, state) => {
    const sql = state.storage.sql
    for (const { name } of sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").toArray()) {
      sql.exec(`DELETE FROM "${name}"`)
    }
    await state.storage.deleteAlarm()
  })
  await fake('config', { rest: [], failNext: [], replayAll: false })
})

describe('interactions endpoint', () => {
  it('answers a PING with a good signature with type 1, and a bad one with 401', async () => {
    const good = await signed({ type: 1, id: 'p1', application_id: APP })
    expect(good.status).toBe(200)
    expect(await good.json()).toEqual({ type: 1 })
    expect((await signed({ type: 1 }, { badSignature: true })).status).toBe(401)
    expect((await signed({ type: 1 }, { at: Date.now() - 10 * 60 * 1000 })).status).toBe(401)
    const unsigned = await SELF.fetch(`${BASE}/discord/interactions`, { method: 'POST', body: '{"type":1}' })
    expect(unsigned.status).toBe(401)
  })
})

describe('the Gateway', () => {
  it('identifies with the intents for mentions, DMs and thread messages, and reports its uptime', async () => {
    const identify = (await fake('state')).frames.find((f: any) => f.op === 2)
    expect(identify.d.intents).toBe(1 | (1 << 9) | (1 << 12) | (1 << 15))
    expect(identify.d.token).toBe('marker-discord-token-91c2')
    const health = (await (await SELF.fetch(`${BASE}/health`)).json()) as any
    expect(health.sources).toEqual(['discord'])
    expect(typeof health.discordGatewayUptime).toBe('number')
    expect(health.discordGateway.state).toBe('ready')
  })

  it('registers /ask and Ask bot once', async () => {
    // Registered on READY in beforeAll; the rest log was cleared since, so read the commands stored.
    const stored = await runInDurableObject(gatewayStub(), (_g: DiscordGateway, state) => state.storage.kv.get<string>('commands'))
    expect(JSON.parse(stored ?? '[]').map((c: any) => c.name)).toEqual(['ask', 'Ask bot'])
  })

  it('turns a mention into one start for the named bot, with labelled context', async () => {
    await pair()
    const { msg, start } = await startInChannel()
    expect(start).toMatchObject({
      id: `discord-${msg.id}`,
      botId: 'bot-reviewer',
      conversation: { source: 'discord', externalId: `g1:c1:${msg.id}` },
      asker: { source: 'discord', id: 'u-owner', role: 'owner' },
      placeId: 'discord:g1:c1',
      text: 'fix the typo in README'
    })
    expect(start.context.map((c: any) => [c.label, c.text])).toEqual([
      ['earlier', 'see line 3'],
      ['bot', 'earlier answer'],
      ['no_access', 'secret plans']
    ])
  })

  it('sends a message without a handle to the default bot, and one naming another bot to it', async () => {
    await pair()
    await dispatch(mention('what changed?'))
    expect((await nextDelivery('start')).botId).toBe('bot-reviewer')
    await dispatch(mention('second look at this'))
    const second = await nextDelivery('start')
    expect(second).toMatchObject({ botId: 'bot-second', text: 'look at this' })
  })

  it('drops messages that neither mention the app nor are in a watched thread', async () => {
    await pair()
    await dispatch({ id: snowflake(), channel_id: 'c1', guild_id: 'g1', author: user('u-owner'), content: 'chatter', mentions: [] })
    await link.settle(300)
    expect(deliveries()).toHaveLength(0)
  })

  it('does not deliver the same message twice after a resume', async () => {
    await pair()
    await fake('config', { events: [] }) // replay only this test's messages
    const { msg } = await startInChannel()
    await fake('config', { replayAll: true })
    await fake('close', { code: 4000 })
    // The close reconnects after a backoff; the alarm is the timer.
    await runDurableObjectAlarm(gatewayStub())
    await until(async () => (await fake('state')).frames.some((f: any) => f.op === 6))
    const resume = (await fake('state')).frames.find((f: any) => f.op === 6)
    expect(resume.d.session_id).toMatch(/^sess-/)
    await until(async () => (await gatewayStub().status()).state === 'ready')
    const after = mention('reviewer one more thing')
    await dispatch(after)
    const next = await nextDelivery('start')
    expect(next.id).toBe(`discord-${after.id}`)
    expect(deliveries('start').filter((d: any) => d.id === `discord-${msg.id}`)).toHaveLength(0)
    await fake('config', { replayAll: false, events: [] })
  })

  it('makes a thread reply by an asker a send, and keeps a non-asker’s as context', async () => {
    await pair()
    const { msg, conversation } = await startInChannel()
    const thread = msg.id // a thread started from a message has its id
    await dispatch({ id: snowflake(), channel_id: thread, guild_id: 'g1', author: user('u-stranger'), content: 'ignore the bot', mentions: [] })
    await link.settle(200)
    expect(deliveries('send')).toHaveLength(0)
    await dispatch({ id: snowflake(), channel_id: thread, guild_id: 'g1', author: user('u-member'), content: 'and CONTRIBUTING too', mentions: [] })
    const send = await nextDelivery('send')
    expect(send).toMatchObject({ conversation, text: 'and CONTRIBUTING too', asker: { id: 'u-member', role: 'member' } })
    expect(send.context).toEqual([expect.objectContaining({ label: 'no_access', text: 'ignore the bot' })])
  })

  it('answers a non-asker’s mention with a DM offering an access request, and creates no delivery', async () => {
    await pair()
    await dispatch(mention('reviewer do something', 'u-stranger'))
    const [dm] = await until(() => calls('POST', /^\/channels\/dm-u-stranger\/messages$/))
    expect(dm!.body.content).toContain('Ask its owner')
    const button = dm!.body.components[0].components[0]
    expect(button.label).toBe('Request access')
    expect(deliveries()).toHaveLength(0)

    const press = await signed({ type: 3, id: 'press-access', application_id: APP, token: 't', user: user('u-stranger'), data: { custom_id: button.custom_id } })
    expect(((await press.json()) as any).type).toBe(7)
    const request = await nextDelivery('access_request')
    expect(request).toMatchObject({ botId: 'bot-reviewer', requester: { source: 'discord', id: 'u-stranger' } })
  })

  it('in a DM, keeps one conversation until `new`', async () => {
    await pair()
    const dm = (content: string) => ({ id: snowflake(), channel_id: 'dm-1', author: user('u-owner'), content, mentions: [] })
    await dispatch(dm('hello there'))
    const start = await nextDelivery('start')
    expect(start.conversation.externalId).toMatch(/^@me:dm-1:/)
    await dispatch(dm('follow up'))
    expect((await nextDelivery('send')).conversation).toEqual(start.conversation)
    await dispatch(dm('new something else'))
    const fresh = await nextDelivery('start')
    expect(fresh.text).toBe('something else')
    expect(fresh.conversation).not.toEqual(start.conversation)
  })
})

describe('replies and status', () => {
  it('opens the thread, shows a status with Stop, and replaces it with the answer once', async () => {
    await pair()
    const { msg, conversation } = await startInChannel()
    sendEvents([
      { kind: 'linked', conversation, sessionId: 's1', botId: 'bot-reviewer' },
      { kind: 'turn-started', conversation, sessionId: 's1', turnId: 't1' }
    ])
    const [status] = await until(() => calls('POST', new RegExp(`^/channels/${msg.id}/messages$`)))
    expect((await calls('POST', /\/threads$/))[0]!.path).toBe(`/channels/c1/messages/${msg.id}/threads`)
    expect(status!.body.content).toContain('Working')
    expect(status!.body.components[0].components[0]).toMatchObject({ label: 'Stop', style: 4 })

    sendEvents([{ kind: 'activity', conversation, turnId: 't1', text: 'Running bun test', steps: [] }])
    sendEvents([{ kind: 'activity', conversation, turnId: 't1', text: 'Running bun test again', steps: [] }])
    const reply = { kind: 'reply', conversation, sessionId: 's1', turnId: 't1', text: 'Fixed the typo.', outcome: 'answered', idempotencyKey: 's1:t1' }
    sendEvents([reply])
    sendEvents([reply])
    sendEvents([reply])
    sendEvents([{ kind: 'turn-ended', conversation, turnId: 't1', outcome: 'answered' }])
    const answer = await until(async () => (await calls('PATCH', /\/messages\/5\d+$/)).find((c) => c.body.content === 'Fixed the typo.'))
    expect(answer.body.components).toEqual([])
    await new Promise((r) => setTimeout(r, 300))
    const patches = await calls('PATCH', /\/messages\//)
    expect(patches.filter((c) => c.body.content === 'Fixed the typo.')).toHaveLength(1)
    // Activity edits come at most every 3 s, so none ran before the answer replaced the status.
    expect(patches.filter((c) => String(c.body.content).includes('Running'))).toHaveLength(0)
    const posts = await calls('POST', new RegExp(`^/channels/${msg.id}/messages$`))
    expect(posts).toHaveLength(1)
  })

  it('splits a long answer and attaches a very long one', async () => {
    await pair()
    const { msg, conversation } = await startInChannel()
    const para = 'word '.repeat(300).trim()
    sendEvents([{ kind: 'reply', conversation, sessionId: 's1', turnId: 't2', text: [para, para, para].join('\n\n'), outcome: 'answered', idempotencyKey: 's1:t2' }])
    const parts = await until(async () => {
      const c = await calls('POST', new RegExp(`^/channels/${msg.id}/messages$`))
      return c.length >= 2 && c
    })
    for (const p of parts) expect(p.body.content.length).toBeLessThanOrEqual(2000)
    sendEvents([{ kind: 'reply', conversation, sessionId: 's1', turnId: 't3', text: 'x'.repeat(30_000), outcome: 'answered', idempotencyKey: 's1:t3' }])
    const file = await until(async () => (await calls('POST', new RegExp(`^/channels/${msg.id}/messages$`))).find((c) => c.body?.file))
    expect(file.body.file).toHaveLength(30_000)
    expect(file.body.payload.content).toContain('attached')
  })

  it('waits out a 429 and posts once', async () => {
    await pair()
    const { msg, conversation } = await startInChannel()
    await fake('config', { failNext: [{ method: 'POST', path: `/channels/${msg.id}/messages`, status: 429, body: { retry_after: 0.05, global: false } }] })
    sendEvents([{ kind: 'reply', conversation, sessionId: 's1', turnId: 't4', text: 'after the limit', outcome: 'answered', idempotencyKey: 's1:t4' }])
    await until(async () => (await calls('POST', new RegExp(`^/channels/${msg.id}/messages$`))).length >= 1)
    await new Promise((r) => setTimeout(r, 120))
    await runDurableObjectAlarm(hubStub())
    const posts = await until(async () => {
      const c = await calls('POST', new RegExp(`^/channels/${msg.id}/messages$`))
      return c.length >= 2 && c
    })
    expect(posts.map((p) => p.body.content)).toEqual(['after the limit', 'after the limit'])
    const rows = await hubStub().outboundRows()
    expect(rows.find((r) => r.key === 'reply:s1:t4')?.state).toBe('done')
  })

  it('stops a turn from the Stop button, only for the asker or the owner', async () => {
    await pair()
    const { conversation } = await startInChannel()
    sendEvents([{ kind: 'turn-started', conversation, sessionId: 's1', turnId: 't5' }])
    const [status] = await until(() => calls('POST', /\/messages$/))
    const stopId = status!.body.components[0].components[0].custom_id
    const stranger = await signed({ type: 3, id: 'press-1', application_id: APP, token: 't', member: { user: user('u-stranger') }, guild_id: 'g1', data: { custom_id: stopId } })
    const note = (await stranger.json()) as any
    expect(note.type).toBe(4)
    expect(note.data.flags).toBe(64)
    const owner = await signed({ type: 3, id: 'press-2', application_id: APP, token: 't', member: { user: user('u-owner') }, guild_id: 'g1', data: { custom_id: stopId } })
    expect(((await owner.json()) as any).type).toBe(6)
    expect(await nextDelivery('cancel')).toMatchObject({ turnId: 't5', conversation })
    sendEvents([{ kind: 'turn-ended', conversation, turnId: 't5', outcome: 'cancelled' }])
    await until(async () => (await calls('PATCH', /\/messages\//)).find((c) => c.body.content === 'Stopped.'))
  })

  it('tells the asker when a start expired while the computer was offline', async () => {
    const { hostId, key } = await registerHost()
    await connectAndHello(hostId, key, [fixtureBot]).then(({ link: l }) => l.close())
    const msg = mention('reviewer while you sleep')
    await dispatch(msg)
    await until(async () => (await hubStub().deliveryState(`discord-${msg.id}`)) !== null)
    await runInDurableObject(hubStub(), (_h: Hub, state) => {
      state.storage.sql.exec('UPDATE due SET at = ? WHERE key = ?', Date.now() - 1, `expire:discord-${msg.id}`)
    })
    await runDurableObjectAlarm(hubStub())
    const note = await until(async () => (await calls('POST', new RegExp(`^/channels/${msg.id}/messages$`)))[0])
    expect(note.body.content).toBe('Your computer was offline; this expired.')
  })
})

describe('questions and approvals', () => {
  async function approval() {
    await pair()
    const { conversation } = await startInChannel()
    sendEvents([
      {
        kind: 'prompt',
        conversation,
        sessionId: 's1',
        turnId: 't6',
        promptId: 'p1',
        prompt: {
          kind: 'approval',
          tool: 'Bash',
          summary: 'bun test',
          options: [
            { id: 'allow_once', label: 'Allow once', kind: 'allow_once' },
            { id: 'allow_always', label: 'Allow always', kind: 'allow_always' },
            { id: 'reject_once', label: 'Deny', kind: 'reject_once' }
          ]
        }
      }
    ])
    const [message] = await until(() => calls('POST', /\/messages$/))
    return { conversation, buttons: message!.body.components.flatMap((r: any) => r.components) }
  }

  it('shows three buttons and Answer in Zomfy; a non-asker’s press gets a note and no answer', async () => {
    const { buttons } = await approval()
    expect(buttons.map((b: any) => b.label)).toEqual(['Allow once', 'Allow always', 'Deny', 'Answer in Zomfy'])
    expect(buttons[0].custom_id).toBe('z1:p1:0')
    const res = await signed({ type: 3, id: 'press-3', application_id: APP, token: 't', member: { user: user('u-stranger') }, guild_id: 'g1', data: { custom_id: 'z1:p1:0' } })
    const body = (await res.json()) as any
    expect(body).toMatchObject({ type: 4, data: { flags: 64 } })
    expect(body.data.content).toContain('Only')
    await link.settle(200)
    expect(deliveries('answer')).toHaveLength(0)
  })

  it('queues the asker’s press as an answer, and prompt-cleared takes the buttons away', async () => {
    const { conversation } = await approval()
    const res = await signed({ type: 3, id: 'press-4', application_id: APP, token: 't', member: { user: user('u-owner') }, guild_id: 'g1', data: { custom_id: 'z1:p1:0' } })
    expect(((await res.json()) as any).type).toBe(6)
    expect(await nextDelivery('answer')).toMatchObject({ promptId: 'p1', optionId: 'allow_once', conversation })
    sendEvents([{ kind: 'prompt-cleared', conversation, promptId: 'p1', by: 'source' }])
    const edit = await until(async () => (await calls('PATCH', /\/messages\//)).find((c) => String(c.body.content).includes('Answered')))
    expect(edit.body.components).toEqual([])
  })

  it('edits the buttons to "Answered in Zomfy" when answered there', async () => {
    const { conversation } = await approval()
    sendEvents([{ kind: 'prompt-cleared', conversation, promptId: 'p1', by: 'zomfy' }])
    const edit = await until(async () => (await calls('PATCH', /\/messages\//))[0])
    expect(edit.body.content).toContain('Answered in Zomfy')
    expect(edit.body.components).toEqual([])
  })
})

describe('/ask', () => {
  it('starts a conversation from the slash command and threads from its reply', async () => {
    await pair()
    const res = await signed({
      type: 2,
      id: 'int-ask-1',
      application_id: APP,
      token: 'tok1',
      guild_id: 'g1',
      channel_id: 'c1',
      channel: { id: 'c1', type: 0 },
      member: { user: user('u-member') },
      data: { name: 'ask', type: 1, options: [{ name: 'prompt', value: 'summarise #eng' }, { name: 'bot', value: 'second' }] }
    })
    const body = (await res.json()) as any
    expect(body.type).toBe(4)
    expect(body.data.content).toContain('asked **Second**')
    const start = await nextDelivery('start')
    expect(start).toMatchObject({ id: 'discord-iint-ask-1', botId: 'bot-second', text: 'summarise #eng', conversation: { externalId: 'g1:c1:iint-ask-1' } })
    sendEvents([{ kind: 'turn-started', conversation: start.conversation, sessionId: 's2', turnId: 't7' }])
    await until(() => calls('POST', /^\/channels\/orig-tok1\/messages$/).then((c) => c.length > 0))
    expect((await calls('GET', /@original$/))).toHaveLength(1)
    expect((await calls('POST', /\/threads$/))[0]!.path).toBe('/channels/c1/messages/orig-tok1/threads')
  })

  it('gives a non-asker an ephemeral note with Request access', async () => {
    await pair()
    const res = await signed({ type: 2, id: 'int-ask-2', application_id: APP, token: 'tok2', guild_id: 'g1', channel_id: 'c1', member: { user: user('u-stranger') }, data: { name: 'ask', type: 1, options: [{ name: 'prompt', value: 'hi' }] } })
    const body = (await res.json()) as any
    expect(body).toMatchObject({ type: 4, data: { flags: 64 } })
    expect(body.data.components[0].components[0].label).toBe('Request access')
    await link.settle(200)
    expect(deliveries()).toHaveLength(0)
  })

  it('works while the Gateway is down', async () => {
    await fake('close', { code: 4000 })
    await pair()
    const res = await signed({ type: 2, id: 'int-ask-3', application_id: APP, token: 'tok3', guild_id: 'g1', channel_id: 'th-existing', channel: { id: 'th-existing', type: 11 }, member: { user: user('u-owner') }, data: { name: 'ask', type: 1, options: [{ name: 'prompt', value: 'still there?' }] } })
    expect(((await res.json()) as any).type).toBe(4)
    expect(await nextDelivery('start')).toMatchObject({ text: 'still there?', placeId: 'discord:g1:th-existing' })
    await runDurableObjectAlarm(gatewayStub())
    await until(async () => (await gatewayStub().status()).state === 'ready')
  })
})

describe('message splitting', () => {
  it('keeps short text whole and cuts long text at paragraphs, under 2000 characters', () => {
    expect(splitMessage('hi')).toEqual(['hi'])
    const para = 'a'.repeat(900)
    const parts = splitMessage([para, para, para].join('\n\n'))
    expect(parts.length).toBe(2)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000)
  })

  it('closes and reopens a code block it cuts', () => {
    const code = ['```ts', ...Array.from({ length: 200 }, (_, i) => `const line${i} = ${i}`), '```'].join('\n')
    const parts = splitMessage(code)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(2000)
      expect((p.match(/```/g) ?? []).length % 2).toBe(0)
    }
  })

  it('hard-cuts a single line longer than a message', () => {
    const parts = splitMessage('x'.repeat(4500))
    expect(parts.map((p) => p.length)).toEqual([2000, 2000, 500])
  })
})

describe('secrets', () => {
  it('keeps the bot token out of the Hub and the Gateway storage', async () => {
    await pair()
    await startInChannel()
    expect(await hubStub().dumpStorage()).not.toContain('marker-discord-token-91c2')
    const gatewayDump = await runInDurableObject(gatewayStub(), (_g: DiscordGateway, state) => JSON.stringify([...state.storage.kv.list()]))
    expect(gatewayDump).not.toContain('marker-discord-token-91c2')
  })
})
