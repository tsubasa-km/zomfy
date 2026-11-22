import { SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureBot } from '../src/contract/fixtures'
import { toMrkdwn } from '../src/slack/format'
import { BASE, hubStub } from './helpers'
import { apiCalls, cleanHub, fakeApi, hmacHex, pairWith, type Paired, until } from './sources-helpers'

// docs/specs/bots/sources/slack.md: recorded Events API and Block Kit payloads, signed with the
// marker signing secret of vitest.config.ts, against fake Slack APIs.
const SECRET = 'marker-slack-signing-5e1a'
const TEAM = 'T0001'
const SELF_ID = 'U0BOT'

const reviewer = {
  ...fixtureBot,
  owner: { slack: 'U_OWNER' },
  askers: { slack: [{ id: 'U_MEMBER', role: 'member' as const }] },
  places: ['slack:T0001:C0001']
}
const second = { ...reviewer, id: 'bot-second', handle: 'second', name: 'Second', isDefault: false }

async function signed(path: string, body: string, opts: { at?: number; bad?: boolean; contentType?: string; retry?: number } = {}) {
  const timestamp = String(Math.floor((opts.at ?? Date.now()) / 1000))
  let sig = `v0=${await hmacHex(SECRET, `v0:${timestamp}:${body}`)}`
  if (opts.bad) sig = `v0=${'0'.repeat(64)}`
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': opts.contentType ?? 'application/json',
      'X-Slack-Signature': sig,
      'X-Slack-Request-Timestamp': timestamp,
      ...(opts.retry ? { 'X-Slack-Retry-Num': String(opts.retry) } : {})
    },
    body
  })
}

let nextTs = Math.floor(Date.now() / 1000)
const ts = () => `${++nextTs}.000200`
let nextEvent = 0

/** An `event_callback` as Slack sends it. */
function callback(event: Record<string, unknown>, eventId = `Ev${++nextEvent}`) {
  return JSON.stringify({
    token: 'x',
    team_id: TEAM,
    api_app_id: 'A1',
    type: 'event_callback',
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    authorizations: [{ team_id: TEAM, user_id: SELF_ID, is_bot: true }],
    event
  })
}

const mention = (text: string, user = 'U_OWNER', extra: Record<string, unknown> = {}) => ({
  type: 'app_mention',
  user,
  text: `<@${SELF_ID}> ${text}`,
  ts: ts(),
  channel: 'C0001',
  channel_type: 'channel',
  event_ts: String(nextTs),
  ...extra
})

async function press(actionId: string, user: string, extra: Record<string, unknown> = {}) {
  const payload = {
    type: 'block_actions',
    user: { id: user, username: user.toLowerCase(), team_id: TEAM },
    team: { id: TEAM },
    channel: { id: 'C0001' },
    container: { type: 'message', message_ts: '1.1', channel_id: 'C0001' },
    response_url: 'https://hooks.slack.com/actions/T0001/1/abc',
    actions: [{ action_id: actionId, block_id: 'b', type: 'button', value: 'v' }],
    ...extra
  }
  return signed('/slack/interactivity', `payload=${encodeURIComponent(JSON.stringify(payload))}`, { contentType: 'application/x-www-form-urlencoded' })
}

const slackCalls = (method: string) => apiCalls((c) => c.host === 'slack.com' && c.path === `/api/${method}`)
const responds = () => apiCalls((c) => c.host === 'hooks.slack.com')

let p: Paired

async function startThread(text = 'reviewer fix the typo in README') {
  const m = mention(text)
  expect((await signed('/slack/events', callback(m))).status).toBe(200)
  const start = await p.next('start')
  return { m, start, conversation: start.conversation as { source: 'slack'; externalId: string } }
}

afterEach(cleanHub)

describe('signatures', () => {
  it('answers url_verification, accepts a good signature and refuses a bad or old one', async () => {
    const challenge = await signed('/slack/events', JSON.stringify({ type: 'url_verification', challenge: 'abc123', token: 'x' }))
    expect(challenge.status).toBe(200)
    expect(await challenge.json()).toEqual({ challenge: 'abc123' })
    expect((await signed('/slack/events', '{"type":"url_verification","challenge":"x"}', { bad: true })).status).toBe(401)
    expect((await signed('/slack/events', '{"type":"url_verification","challenge":"x"}', { at: Date.now() - 6 * 60 * 1000 })).status).toBe(401)
    const unsigned = await SELF.fetch(`${BASE}/slack/events`, { method: 'POST', body: '{}' })
    expect(unsigned.status).toBe(401)
    expect((await press('z1r:bot-reviewer', 'U_X').then((r) => r.status))).toBe(200)
  })
})

describe('asking', () => {
  it('turns a mention into one start for the named bot; a retried event and the matching message event make no second', async () => {
    p = await pairWith([reviewer, second])
    await fakeApi('config', {
      answers: {
        'slack:conversations.history': { ok: true, messages: [] }
      }
    })
    const m = mention('second look at the build')
    const body = callback(m, 'EvSame')
    const started = Date.now()
    expect((await signed('/slack/events', body)).status).toBe(200)
    expect(Date.now() - started).toBeLessThan(3000)
    expect((await signed('/slack/events', body, { retry: 1 })).status).toBe(200)
    // Slack also sends the mention as a plain `message` event, with another event id.
    await signed('/slack/events', callback({ ...m, type: 'message' }))
    const start = await p.next('start')
    expect(start).toMatchObject({
      id: `slack-C0001-${m.ts}`,
      botId: 'bot-second',
      text: 'look at the build',
      conversation: { source: 'slack', externalId: `${TEAM}:C0001:${m.ts}` },
      asker: { source: 'slack', id: 'U_OWNER', role: 'owner' },
      placeId: 'slack:T0001:C0001',
      placeKind: 'public_channel'
    })
    await p.link.settle(300)
    expect(p.deliveries('start')).toHaveLength(0)
  })

  it('makes a thread reply by an asker a send, keeps a non-asker’s as context, and takes a DM to the default bot', async () => {
    p = await pairWith([reviewer])
    const { m, conversation } = await startThread()
    const reply = (user: string, text: string) => ({ type: 'message', user, text, ts: ts(), thread_ts: m.ts, channel: 'C0001', channel_type: 'channel' })
    await signed('/slack/events', callback(reply('U_STRANGER', 'ignore the bot')))
    await p.link.settle(200)
    expect(p.deliveries('send')).toHaveLength(0)
    await signed('/slack/events', callback(reply('U_MEMBER', 'and CONTRIBUTING too')))
    const send = await p.next('send')
    expect(send).toMatchObject({ conversation, text: 'and CONTRIBUTING too', asker: { id: 'U_MEMBER', role: 'member' } })
    expect(send.context).toEqual([expect.objectContaining({ label: 'no_access', text: 'ignore the bot' })])

    const dm = { type: 'message', user: 'U_OWNER', text: 'hello there', ts: ts(), channel: 'D0001', channel_type: 'im' }
    await signed('/slack/events', callback(dm))
    expect(await p.next('start')).toMatchObject({ botId: 'bot-reviewer', placeKind: 'direct_message', text: 'hello there', conversation: { externalId: `${TEAM}:D0001:${dm.ts}` } })
  })

  it('carries a bare mention’s earlier own messages as the request', async () => {
    p = await pairWith([reviewer])
    await fakeApi('config', {
      answers: {
        'slack:conversations.history': {
          ok: true,
          messages: [
            { user: 'U_OWNER', text: 'second part', ts: '1699999999.000300' },
            { user: 'U_OTHER', text: 'unrelated', ts: '1699999999.000250' },
            { user: 'U_OWNER', text: 'first part', ts: '1699999999.000200', files: [{ id: 'F1', name: 'log.txt', permalink: 'https://files.test/F1' }] },
            { bot_id: 'B1', user: SELF_ID, text: 'earlier answer', ts: '1699999999.000100' },
            { user: 'U_OWNER', text: 'too old', ts: '1699999999.000050' }
          ]
        }
      }
    })
    await signed('/slack/events', callback(mention('')))
    const start = await p.next('start')
    expect(start.text).toBe('')
    expect(start.context.map((c: any) => [c.label, c.text])).toEqual([
      ['earlier', 'first part'],
      ['earlier', 'second part']
    ])
    expect(start.attachments).toEqual([expect.objectContaining({ name: 'log.txt' })])
  })

  it('gives a non-asker an ephemeral note with Request access, and no delivery; the press becomes an access request', async () => {
    p = await pairWith([reviewer])
    await signed('/slack/events', callback(mention('reviewer do something', 'U_STRANGER')))
    const [note] = await until(() => slackCalls('chat.postEphemeral'))
    expect(note!.body).toMatchObject({ channel: 'C0001', user: 'U_STRANGER' })
    expect(note!.body.text).toContain('Ask its owner')
    const button = note!.body.blocks[1].elements[0]
    expect(button.action_id).toBe('z1r:bot-reviewer')
    await p.link.settle(200)
    expect(p.deliveries()).toHaveLength(0)
    expect((await press(button.action_id, 'U_STRANGER')).status).toBe(200)
    expect(await p.next('access_request')).toMatchObject({ botId: 'bot-reviewer', requester: { source: 'slack', id: 'U_STRANGER' } })
    const [replaced] = await until(responds)
    expect(replaced!.body).toMatchObject({ replace_original: true })
  })

  it('queues a matching rule as a trigger, and runs the asked bot’s own rule inside its turn', async () => {
    const rules = [
      { id: 'r-msg', botId: 'bot-second', source: 'slack', kinds: ['message'], places: ['slack:T0001:C0001'], textContains: 'deploy', graceMs: 60_000 },
      { id: 'r-own', botId: 'bot-reviewer', source: 'slack', kinds: ['mentioned'], places: [], graceMs: 60_000 }
    ]
    p = await pairWith([reviewer, second], rules)
    const plain = { type: 'message', user: 'U_STRANGER', text: 'the deploy failed', ts: ts(), channel: 'C0001', channel_type: 'channel' }
    await signed('/slack/events', callback(plain))
    const trigger = await p.next('trigger')
    expect(trigger).toMatchObject({ botId: 'bot-second', ruleId: 'r-msg', event: { source: 'slack', kind: 'message', actorId: 'U_STRANGER', text: 'the deploy failed' } })
    await signed('/slack/events', callback(mention('reviewer check it')))
    const start = await p.next('start')
    expect(start.ruleIds).toEqual(['r-own'])
    await p.link.settle(200)
    expect(p.deliveries('trigger')).toHaveLength(0)
  })
})

describe('replies, status and Stop', () => {
  it('posts a status with Stop in the thread and replaces it with the answer once', async () => {
    p = await pairWith([reviewer])
    const { m, conversation } = await startThread()
    p.events([
      { kind: 'linked', conversation, sessionId: 's1', botId: 'bot-reviewer' },
      { kind: 'turn-started', conversation, sessionId: 's1', turnId: 't1' }
    ])
    const [status] = await until(() => slackCalls('chat.postMessage'))
    expect(status!.body).toMatchObject({ channel: 'C0001', thread_ts: m.ts })
    const stop = status!.body.blocks.find((b: any) => b.type === 'actions').elements[0]
    expect(stop).toMatchObject({ action_id: 'z1s:t1', style: 'danger' })
    const reply = { kind: 'reply', conversation, sessionId: 's1', turnId: 't1', text: 'Fixed **the typo**. See [docs](https://x.test).', outcome: 'answered', idempotencyKey: 's1:t1' }
    p.events([{ kind: 'activity', conversation, turnId: 't1', text: 'Running bun test', steps: [] }])
    p.events([reply])
    p.events([reply])
    p.events([{ kind: 'turn-ended', conversation, turnId: 't1', outcome: 'answered' }])
    const answer = await until(async () => (await slackCalls('chat.update')).find((c) => String(c.body.text).includes('Fixed')))
    expect(answer.body.blocks[0].text.text).toBe('Fixed *the typo*. See <https://x.test|docs>.')
    await new Promise((r) => setTimeout(r, 300))
    expect((await slackCalls('chat.update')).filter((c) => String(c.body.text).includes('Fixed'))).toHaveLength(1)
    expect((await slackCalls('chat.update')).filter((c) => String(c.body.text).includes('Running'))).toHaveLength(0)
    expect(await slackCalls('chat.postMessage')).toHaveLength(1)
  })

  it('stops a turn only for the asker or the owner', async () => {
    p = await pairWith([reviewer])
    const { conversation } = await startThread()
    p.events([{ kind: 'turn-started', conversation, sessionId: 's1', turnId: 't2' }])
    await until(() => slackCalls('chat.postMessage'))
    await press('z1s:t2', 'U_STRANGER')
    const [only] = await until(responds)
    expect(only!.body).toMatchObject({ response_type: 'ephemeral' })
    expect(only!.body.text).toContain('Only')
    await press('z1s:t2', 'U_OWNER')
    expect(await p.next('cancel')).toMatchObject({ turnId: 't2', conversation })
  })

  it('uploads a very long answer as a file, and waits out a 429', async () => {
    p = await pairWith([reviewer])
    const { conversation } = await startThread()
    await fakeApi('config', { failNext: [{ host: 'slack.com', path: '/api/chat.postMessage', status: 429, headers: { 'Retry-After': '0' } }] })
    const para = 'word '.repeat(700).trim()
    p.events([{ kind: 'reply', conversation, sessionId: 's1', turnId: 't3', text: Array(12).fill(para).join('\n\n').slice(0, 32_000), outcome: 'answered', idempotencyKey: 's1:t3' }])
    const [upload] = await until(() => slackCalls('files.completeUploadExternal'), 8000)
    expect(upload!.body.channel_id).toBe('C0001')
    const posts = await slackCalls('chat.postMessage')
    expect(posts.length).toBe(2) // the 429, then the post
    expect(posts[1]!.body.blocks[0].text.text.length).toBeLessThanOrEqual(3000)
  })

  it('tells the asker in the thread when a start expired', async () => {
    p = await pairWith([reviewer])
    p.link.close()
    const m = mention('reviewer while you sleep')
    await signed('/slack/events', callback(m))
    const id = `slack-C0001-${m.ts}`
    await until(async () => (await hubStub().deliveryState(id)) !== null)
    const { runDurableObjectAlarm, runInDurableObject } = await import('cloudflare:test')
    await runInDurableObject(hubStub(), (_h, state) => {
      state.storage.sql.exec('UPDATE due SET at = ? WHERE key = ?', Date.now() - 1, `expire:${id}`)
    })
    await runDurableObjectAlarm(hubStub())
    const [note] = await until(() => slackCalls('chat.postMessage'))
    expect(note!.body).toMatchObject({ thread_ts: m.ts, text: 'Your computer was offline; this expired.' })
  })
})

describe('questions and approvals', () => {
  async function approval() {
    p = await pairWith([reviewer])
    const { conversation } = await startThread()
    p.events([
      {
        kind: 'prompt',
        conversation,
        sessionId: 's1',
        turnId: 't4',
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
    const [message] = await until(() => slackCalls('chat.postMessage'))
    return { conversation, buttons: message!.body.blocks.find((b: any) => b.type === 'actions').elements }
  }

  it('shows Allow once, Allow always, Deny and Answer in Zomfy; a non-asker’s press gets a note and no answer', async () => {
    const { buttons } = await approval()
    expect(buttons.map((b: any) => b.text.text)).toEqual(['Allow once', 'Allow always', 'Deny', 'Answer in Zomfy'])
    expect(buttons[0]).toMatchObject({ action_id: 'z1:p1:0', style: 'primary' })
    expect(buttons[2].style).toBe('danger')
    await press('z1:p1:0', 'U_STRANGER')
    const [note] = await until(responds)
    expect(note!.body.text).toContain('Only')
    await p.link.settle(200)
    expect(p.deliveries('answer')).toHaveLength(0)
  })

  it('queues the asker’s press as an answer and replaces the buttons', async () => {
    const { conversation } = await approval()
    await press('z1:p1:0', 'U_OWNER')
    expect(await p.next('answer')).toMatchObject({ promptId: 'p1', optionId: 'allow_once', conversation })
    const edit = await until(async () => (await slackCalls('chat.update'))[0])
    expect(edit.body.blocks.some((b: any) => b.type === 'actions')).toBe(false)
    expect(JSON.stringify(edit.body.blocks)).toContain('chose')
  })

  it('takes a by-reply question’s answer from the asker’s next thread message', async () => {
    p = await pairWith([reviewer])
    const { m, conversation } = await startThread()
    p.events([
      { kind: 'prompt', conversation, sessionId: 's1', turnId: 't5', promptId: 'p2', prompt: { kind: 'question', text: 'Which branch?', options: [{ id: 'o1', label: 'main' }, { id: 'o2', label: 'dev' }], byReply: true } }
    ])
    await until(() => slackCalls('chat.postMessage'))
    await signed('/slack/events', callback({ type: 'message', user: 'U_OWNER', text: '2', ts: ts(), thread_ts: m.ts, channel: 'C0001', channel_type: 'channel' }))
    expect(await p.next('answer')).toMatchObject({ promptId: 'p2', optionId: 'o2' })
  })
})

describe('actions', () => {
  it('posts once per idempotency key, mirrors as the owner, pins and schedules', async () => {
    p = await pairWith([reviewer])
    const { m } = await startThread()
    const ref = `slack:${TEAM}:C0001:${m.ts}`
    const first = await p.action('post', ref, { text: 'from Zomfy', mirror: true }, 'mirror-1')
    const again = await p.action('post', ref, { text: 'from Zomfy', mirror: true }, 'mirror-1')
    expect(first.ok).toBe(true)
    expect(again.result).toEqual(first.result)
    const posts = await slackCalls('chat.postMessage')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.body).toMatchObject({ username: 'Name U_OWNER', icon_url: 'https://avatars.test/U_OWNER.png', thread_ts: m.ts })
    expect((await p.action('pin', ref, {})).ok).toBe(true)
    expect((await slackCalls('pins.add'))[0]!.body).toMatchObject({ channel: 'C0001', timestamp: m.ts })
    const scheduled = await p.action('post', `slack:${TEAM}:C0001`, { text: 'later', postAt: Math.floor(Date.now() / 1000) + 3600 })
    expect(scheduled.result.scheduledId).toMatch(/^Q/)
    const tooFar = await p.action('post', `slack:${TEAM}:C0001`, { text: 'much later', postAt: Math.floor(Date.now() / 1000) + 200 * 86400 })
    expect(tooFar.ok).toBe(false)
    const caps = await p.action('capabilities', undefined)
    expect(caps.result.verbs).toEqual(expect.arrayContaining(['pin', 'canvas', 'list', 'scheduled', 'post']))
  })
})

describe('format', () => {
  it('turns Markdown into mrkdwn and leaves code alone', () => {
    expect(toMrkdwn('# Title\n**bold** and ~~gone~~ <tag> & [x](https://x.test)\n- item\n```\n**raw** <b>\n```')).toBe(
      '*Title*\n*bold* and ~gone~ &lt;tag&gt; &amp; <https://x.test|x>\n• item\n```\n**raw** &lt;b&gt;\n```'
    )
  })
})

describe('secrets', () => {
  it('keeps the bot token and signing secret out of Hub storage', async () => {
    p = await pairWith([reviewer])
    await startThread()
    const dump = await hubStub().dumpStorage()
    expect(dump).not.toContain('marker-slack-token-77d0')
    expect(dump).not.toContain('marker-slack-signing-5e1a')
  })
})
