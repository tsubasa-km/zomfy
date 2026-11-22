import { SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureBot } from '../src/contract/fixtures'
import { BASE, hubStub } from './helpers'
import { apiCalls, cleanHub, fakeApi, hmacHex, pairWith, type Paired, until } from './sources-helpers'

// docs/specs/bots/sources/linear.md: webhook payloads in Linear's shapes, signed with the marker
// secret of vitest.config.ts, against a fake Linear GraphQL API (its app user is `lin-app`).
const SECRET = 'marker-linear-hook-0a2f'
const ORG = 'org-1'

const reviewer = { ...fixtureBot, owner: { linear: 'lin-owner' }, askers: { linear: [{ id: 'lin-member', role: 'member' as const }] }, places: [] }
const second = { ...reviewer, id: 'bot-second', handle: 'second', name: 'Second', isDefault: false }

let nextDelivery = 0
async function hook(payload: Record<string, unknown>, opts: { bad?: boolean; at?: number; id?: string } = {}) {
  const body = JSON.stringify({ organizationId: ORG, webhookTimestamp: opts.at ?? Date.now(), createdAt: new Date().toISOString(), ...payload })
  const sig = opts.bad ? '0'.repeat(64) : await hmacHex(SECRET, body)
  return SELF.fetch(`${BASE}/linear/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Linear-Signature': sig, 'Linear-Delivery': opts.id ?? `ld-${Date.now()}-${++nextDelivery}`, 'Linear-Event': String(payload.type) },
    body
  })
}

const issue = { id: 'iss-1', identifier: 'ENG-1', title: 'Fix the login page', description: 'It 500s', url: 'https://linear.app/acme/issue/ENG-1', team: { key: 'ENG' }, state: { name: 'Todo' } }
const actor = (id: string, name = id) => ({ id, name, type: 'user' })
const comment = (body: string, by = 'lin-owner') => ({ type: 'Comment', action: 'create', actor: actor(by, by === 'lin-owner' ? 'Owner' : by), data: { id: `c-${++nextDelivery}`, body, issueId: issue.id, issue: { ...issue } } })

const gql = (field: string) => apiCalls((c) => c.host === 'api.linear.app' && c.path === '/graphql' && String(c.body?.query).includes(field))

let p: Paired
afterEach(cleanHub)

describe('signatures', () => {
  it('accepts a good signature, refuses a bad one and a timestamp more than 60 s off', async () => {
    expect((await hook(comment('hello'), { bad: true })).status).toBe(401)
    expect((await hook(comment('hello'), { at: Date.now() - 2 * 60 * 1000 })).status).toBe(401)
    const started = Date.now()
    expect((await hook(comment('hello'))).status).toBe(200)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('asking', () => {
  it('turns a comment mention into a start, once per delivery', async () => {
    p = await pairWith([reviewer, second])
    const payload = comment('@zomfy second please look at this')
    await hook(payload, { id: 'ld-same' })
    await hook(payload, { id: 'ld-same' })
    const start = await p.next('start')
    expect(start).toMatchObject({
      botId: 'bot-second',
      text: 'please look at this',
      conversation: { source: 'linear', externalId: `${ORG}:ENG-1` },
      asker: { source: 'linear', id: 'lin-owner', role: 'owner' },
      placeId: `linear:${ORG}:ENG-1`,
      placeKind: 'issue'
    })
    expect(start.context[0]).toMatchObject({ label: 'issue', text: expect.stringContaining('ENG-1: Fix the login page') })
    await p.link.settle(300)
    expect(p.deliveries('start')).toHaveLength(0)
  })

  it('starts the labelled bot when bot:<handle> is added, and does nothing when it is removed', async () => {
    p = await pairWith([reviewer, second])
    const labels = [{ id: 'l-bot', name: 'bot:reviewer' }]
    await hook({ type: 'Issue', action: 'update', actor: actor('lin-member', 'Mia'), data: { ...issue, labelIds: ['l-bot'], labels }, updatedFrom: { labelIds: [] } })
    expect(await p.next('start')).toMatchObject({ botId: 'bot-reviewer', text: 'Fix the login page', asker: { id: 'lin-member', role: 'member' } })
    await hook({ type: 'Issue', action: 'update', actor: actor('lin-member', 'Mia'), data: { ...issue, id: 'iss-2', identifier: 'ENG-2', labelIds: [], labels: [] }, updatedFrom: { labelIds: ['l-bot'] } })
    await p.link.settle(300)
    expect(p.deliveries()).toHaveLength(0)
  })

  it('answers a non-asker with a public note and no delivery', async () => {
    p = await pairWith([reviewer])
    await hook(comment('@zomfy do it', 'lin-stranger'))
    const [note] = await until(() => gql('commentCreate'))
    expect(note!.body.variables.input).toMatchObject({ issueId: 'iss-1' })
    expect(note!.body.variables.input.body).toContain('you can’t ask Reviewer yet')
    await p.link.settle(200)
    expect(p.deliveries()).toHaveLength(0)
  })

  it('takes an asker’s plain reply as the answer to an open question', async () => {
    p = await pairWith([reviewer])
    await hook(comment('@zomfy fix it'))
    const { conversation } = await p.next('start')
    p.events([{ kind: 'prompt', conversation, sessionId: 's1', turnId: 't1', promptId: 'q1', prompt: { kind: 'question', text: 'Which env?', options: [{ id: 'p', label: 'prod' }, { id: 's', label: 'staging' }], byReply: false } }])
    const [question] = await until(() => gql('commentCreate'))
    expect(question!.body.variables.input.body).toContain('2. staging')
    await hook(comment('staging', 'lin-member'))
    expect(await p.next('answer')).toMatchObject({ promptId: 'q1', optionId: 's' })
  })
})

describe('replies', () => {
  it('posts "On it…", edits it with the plan, and replaces it with the reply, with one asked-by line for a member', async () => {
    p = await pairWith([reviewer])
    await hook(comment('@zomfy fix it', 'lin-member'))
    const { conversation } = await p.next('start')
    p.events([{ kind: 'turn-started', conversation, sessionId: 's1', turnId: 't1' }])
    const [status] = await until(() => gql('commentCreate'))
    expect(status!.body.variables.input.body).toBe('On it…')
    const reply = { kind: 'reply', conversation, sessionId: 's1', turnId: 't1', text: 'Fixed the 500.', outcome: 'answered', idempotencyKey: 's1:t1' }
    p.events([reply])
    p.events([reply])
    const edit = await until(async () => (await gql('commentUpdate')).find((c) => String(c.body.variables.input.body).startsWith('Fixed')))
    expect(edit.body.variables.input.body).toBe('Fixed the 500.\n\nasked by lin-member via Reviewer')
    await new Promise((r) => setTimeout(r, 200))
    expect((await gql('commentUpdate')).filter((c) => String(c.body.variables.input.body).startsWith('Fixed'))).toHaveLength(1)
    expect(await gql('commentCreate')).toHaveLength(1)
  })

  it('adds no asked-by line for the owner', async () => {
    p = await pairWith([reviewer])
    await hook(comment('@zomfy fix it'))
    const { conversation } = await p.next('start')
    p.events([{ kind: 'reply', conversation, sessionId: 's1', turnId: 't2', text: 'Done here.', outcome: 'answered', idempotencyKey: 's1:t2' }])
    const [posted] = await until(() => gql('commentCreate'))
    expect(posted!.body.variables.input.body).toBe('Done here.')
  })
})

describe('triggers', () => {
  it('fires assigned when the app’s user is assigned, and issue_moved only into the named state', async () => {
    const rules = [
      { id: 'r-assigned', botId: 'bot-reviewer', source: 'linear', kinds: ['assigned'], places: [], graceMs: 60_000 },
      { id: 'r-moved', botId: 'bot-reviewer', source: 'linear', kinds: ['issue_moved'], places: [], team: 'ENG', states: ['In Review'], graceMs: 60_000 }
    ]
    p = await pairWith([reviewer], rules)
    await hook({ type: 'Issue', action: 'update', actor: actor('lin-member'), data: { ...issue, assigneeId: 'lin-app' }, updatedFrom: { assigneeId: null } })
    expect(await p.next('trigger')).toMatchObject({ ruleId: 'r-assigned', event: { source: 'linear', kind: 'assigned', subject: 'ENG-1' } })
    await hook({ type: 'Issue', action: 'update', actor: actor('lin-member'), data: { ...issue, assigneeId: 'lin-someone' }, updatedFrom: { assigneeId: null } })
    await hook({ type: 'Issue', action: 'update', actor: actor('lin-member'), data: { ...issue, state: { name: 'Done' } }, updatedFrom: { stateId: 's-old' } })
    await hook({ type: 'Issue', action: 'update', actor: actor('lin-member'), data: { ...issue, state: { name: 'In Review' } }, updatedFrom: { stateId: 's-old' } })
    expect(await p.next('trigger')).toMatchObject({ ruleId: 'r-moved', event: { kind: 'issue_moved' } })
    await p.link.settle(300)
    expect(p.deliveries('trigger')).toHaveLength(0)
  })
})

describe('actions and secrets', () => {
  it('finds members for Who can ask, comments once per key, and keeps tokens out of storage', async () => {
    p = await pairWith([reviewer])
    const found = await p.action('find', undefined, { source: 'linear', text: 'own' })
    expect(found.result.members).toEqual([{ id: 'lin-owner', name: 'Owner', handle: 'owner' }])
    await fakeApi('config', {})
    const first = await p.action('post', `linear:${ORG}:ENG-1`, { text: 'A note' }, 'lp-1')
    const again = await p.action('post', `linear:${ORG}:ENG-1`, { text: 'A note' }, 'lp-1')
    expect(again.result).toEqual(first.result)
    expect(await gql('commentCreate')).toHaveLength(1)
    expect((await gql('commentCreate'))[0]!.auth).toBe('Bearer marker-linear-token-c4d1')
    const dump = await hubStub().dumpStorage()
    expect(dump).not.toContain('marker-linear-token-c4d1')
    expect(dump).not.toContain('marker-linear-hook-0a2f')
  })
})
