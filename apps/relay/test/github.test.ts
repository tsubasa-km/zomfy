import { SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureBot } from '../src/contract/fixtures'
import { matchesRule } from '../src/sources/triggers'
import { BASE, hubStub } from './helpers'
import { apiCalls, cleanHub, fakeApi, hmacHex, pairWith, type Paired, until } from './sources-helpers'

// docs/specs/bots/sources/github.md: webhook payloads in GitHub's shapes (trimmed to the fields the
// relay reads), signed with the marker secret of vitest.config.ts, against a fake GitHub API.
const SECRET = 'marker-github-hook-3b9c'
const SLUG = 'zomfy-test'

const reviewer = {
  ...fixtureBot,
  owner: { github: 'Octo-Owner' },
  askers: { github: [{ id: 'member-mia', role: 'member' as const }] },
  places: []
}

let nextDelivery = 0
const deliveryId = () => `d-${Date.now()}-${++nextDelivery}`

async function hook(event: string, payload: unknown, opts: { bad?: boolean; id?: string } = {}) {
  const body = JSON.stringify(payload)
  const sig = opts.bad ? `sha256=${'0'.repeat(64)}` : `sha256=${await hmacHex(SECRET, body)}`
  return SELF.fetch(`${BASE}/github/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': event, 'X-GitHub-Delivery': opts.id ?? deliveryId(), 'X-Hub-Signature-256': sig },
    body
  })
}

const repository = { id: 99, full_name: 'acme/app', name: 'app', owner: { login: 'acme' } }
const installation = (id = 42) => ({ id })
const user = (login: string, type = 'User') => ({ login, id: login.length, type })

let nextComment = 500
function issueComment(body: string, login = 'Octo-Owner', number = 7, extra: Record<string, unknown> = {}) {
  return {
    action: 'created',
    issue: { number, title: 'Typo in README', body: 'The README says teh.', user: user('reporter'), html_url: `https://github.com/acme/app/issues/${number}`, ...extra },
    comment: { id: ++nextComment, body, user: user(login), html_url: `https://github.com/acme/app/issues/${number}#issuecomment-${nextComment}` },
    repository,
    installation: installation(),
    sender: user(login)
  }
}

const ghCalls = (method: string, pattern: RegExp) => apiCalls((c) => c.host === 'api.github.com' && c.method === method && pattern.test(c.path.split('?')[0]!))

let p: Paired
afterEach(cleanHub)

describe('signatures', () => {
  it('accepts a good signature, refuses a bad one, answers ping, and ignores a repeated delivery id', async () => {
    expect((await hook('ping', { zen: 'hi' })).status).toBe(200)
    expect((await hook('issue_comment', issueComment(`@${SLUG} hi`), { bad: true })).status).toBe(401)
    p = await pairWith([reviewer])
    const id = deliveryId()
    const payload = issueComment(`@${SLUG} fix it`)
    const started = Date.now()
    expect((await hook('issue_comment', payload, { id })).status).toBe(202)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect((await hook('issue_comment', payload, { id })).status).toBe(202)
    await p.next('start')
    await p.link.settle(300)
    expect(p.deliveries('start')).toHaveLength(0)
  })
})

describe('asking', () => {
  it('turns an owner’s mention into a start with the issue as context', async () => {
    p = await pairWith([reviewer])
    await fakeApi('config', {
      answers: {
        'github:GET /repos/acme/app/issues/7/comments': [
          { id: 1, body: 'I can reproduce', user: { login: 'member-mia' }, created_at: '2026-11-20T00:00:00Z' },
          { id: 2, body: 'earlier answer', user: { login: `${SLUG}[bot]` } },
          { id: 3, body: 'random take', user: { login: 'passer-by' } }
        ]
      }
    })
    const payload = issueComment(`@${SLUG} reviewer please fix the typo`, 'octo-owner')
    await hook('issue_comment', payload)
    const start = await p.next('start')
    expect(start).toMatchObject({
      botId: 'bot-reviewer',
      text: 'please fix the typo',
      conversation: { source: 'github', externalId: '42:acme/app:7' },
      asker: { source: 'github', id: 'octo-owner', role: 'owner' },
      placeId: 'github:42:acme/app',
      placeKind: 'issue'
    })
    expect(start.context.map((c: any) => [c.label, c.text.split('\n')[0]])).toEqual([
      ['issue', 'Issue acme/app#7: Typo in README'],
      ['earlier', 'I can reproduce'],
      ['bot', 'earlier answer'],
      ['no_access', 'random take']
    ])
  })

  it('answers a non-asker’s mention with a public note and no delivery, and takes an access request by comment', async () => {
    p = await pairWith([reviewer])
    await hook('issue_comment', issueComment(`@${SLUG} do something`, 'stranger'))
    const [note] = await until(() => ghCalls('POST', /\/issues\/7\/comments$/))
    expect(note!.body.body).toContain('@stranger, you can’t ask Reviewer yet')
    expect(note!.body.body).toContain(`@${SLUG} reviewer request access`)
    await p.link.settle(200)
    expect(p.deliveries()).toHaveLength(0)
    await hook('issue_comment', issueComment(`@${SLUG} reviewer request access`, 'stranger'))
    const request = await p.next('access_request')
    expect(request).toMatchObject({ requester: { source: 'github', id: 'stranger' } })
    // The owner's answer in Zomfy comes back as access-answered, a comment on the same issue.
    const before = (await ghCalls('POST', /\/issues\/7\/comments$/)).length
    p.events([{ kind: 'access-answered', conversation: request.conversation, botId: request.botId, requester: { id: 'stranger', name: 'stranger' }, allowed: true }])
    const answered = await until(async () => {
      const list = await ghCalls('POST', /\/issues\/7\/comments$/)
      return list.length > before ? list : null
    })
    expect(answered.at(-1)!.body.body).toContain('@stranger The owner let you ask **Reviewer**')
  })

  it('makes a later mention a send, and a plain reply by an asker the answer to an open question', async () => {
    p = await pairWith([reviewer])
    await hook('issue_comment', issueComment(`@${SLUG} look at this`))
    const start = await p.next('start')
    const conversation = start.conversation
    p.events([{ kind: 'prompt', conversation, sessionId: 's1', turnId: 't1', promptId: 'q1', prompt: { kind: 'question', text: 'Which file?', options: [{ id: 'a', label: 'README' }, { id: 'b', label: 'CONTRIBUTING' }], byReply: false } }])
    const [question] = await until(() => ghCalls('POST', /\/issues\/7\/comments$/))
    expect(question!.body.body).toContain('1. README')
    expect(question!.body.body).toContain('Reply with the number')
    await hook('issue_comment', issueComment('2', 'member-mia'))
    expect(await p.next('answer')).toMatchObject({ promptId: 'q1', optionId: 'b', asker: { id: 'member-mia', role: 'member' } })
    await hook('issue_comment', issueComment(`@${SLUG} and the docs too`, 'member-mia'))
    expect(await p.next('send')).toMatchObject({ conversation, text: 'and the docs too' })
  })

  it('posts an approval as answer-in-Zomfy only, and takes no reply as its answer', async () => {
    p = await pairWith([reviewer])
    await hook('issue_comment', issueComment(`@${SLUG} run it`))
    const { conversation } = await p.next('start')
    p.events([{ kind: 'prompt', conversation, sessionId: 's1', turnId: 't1', promptId: 'ap1', prompt: { kind: 'approval', tool: 'Bash', summary: 'rm -rf build', options: [{ id: 'allow_once', label: 'Allow once' }] } }])
    const [comment] = await until(() => ghCalls('POST', /\/issues\/7\/comments$/))
    expect(comment!.body.body).toContain('answered in Zomfy only')
    await hook('issue_comment', issueComment('1'))
    await p.link.settle(300)
    expect(p.deliveries('answer')).toHaveLength(0)
  })
})

describe('replies', () => {
  it('reacts 👀 while the turn runs, posts one reply with an asked-by line for a member, and removes the reaction', async () => {
    p = await pairWith([reviewer])
    await hook('issue_comment', issueComment(`@${SLUG} fix the typo`, 'member-mia'))
    const { conversation } = await p.next('start')
    p.events([{ kind: 'turn-started', conversation, sessionId: 's1', turnId: 't1' }])
    const [reaction] = await until(() => ghCalls('POST', /\/issues\/comments\/\d+\/reactions$/))
    expect(reaction!.body).toEqual({ content: 'eyes' })
    const reply = { kind: 'reply', conversation, sessionId: 's1', turnId: 't1', text: 'Fixed in #8.', outcome: 'answered', idempotencyKey: 's1:t1' }
    p.events([reply])
    p.events([reply])
    p.events([{ kind: 'turn-ended', conversation, turnId: 't1', outcome: 'answered' }])
    const [comment] = await until(() => ghCalls('POST', /\/issues\/7\/comments$/))
    expect(comment!.body.body).toBe('Fixed in #8.\n\nasked by member-mia via Reviewer')
    await until(() => ghCalls('DELETE', /\/reactions\/\d+$/))
    await new Promise((r) => setTimeout(r, 200))
    expect(await ghCalls('POST', /\/issues\/7\/comments$/)).toHaveLength(1)
  })

  it('adds no asked-by line for the owner, and posts three review notes as one review', async () => {
    p = await pairWith([reviewer])
    const pr = issueComment(`@${SLUG} review this`, 'Octo-Owner', 9, { pull_request: { url: 'https://api.github.com/repos/acme/app/pulls/9' } })
    await hook('issue_comment', pr)
    const { conversation } = await p.next('start')
    p.events([
      {
        kind: 'reply',
        conversation,
        sessionId: 's1',
        turnId: 't2',
        text: 'Three notes.',
        outcome: 'answered',
        idempotencyKey: 's1:t2',
        reviewNotes: [
          { path: 'src/a.ts', line: 3, body: 'rename this' },
          { path: 'src/b.ts', line: 10, side: 'LEFT', body: 'was this needed?' },
          { path: 'README.md', line: 1, body: 'typo' }
        ]
      }
    ])
    const [review] = await until(() => ghCalls('POST', /\/pulls\/9\/reviews$/))
    expect(review!.body).toMatchObject({ event: 'COMMENT', body: 'Three notes.' })
    expect(review!.body.comments).toHaveLength(3)
    expect(review!.body.comments[1]).toEqual({ path: 'src/b.ts', line: 10, side: 'LEFT', body: 'was this needed?' })
    expect(await ghCalls('POST', /\/issues\/9\/comments$/)).toHaveLength(0)
  })

  it('fetches an installation token once for several calls, signed by the app’s JWT', async () => {
    p = await pairWith([reviewer])
    const payload = { ...issueComment(`@${SLUG} hello`), installation: installation(777) }
    await hook('issue_comment', payload)
    const { conversation } = await p.next('start')
    for (const turn of ['a', 'b', 'c']) {
      p.events([{ kind: 'reply', conversation, sessionId: 's1', turnId: turn, text: `answer ${turn}`, outcome: 'answered', idempotencyKey: `s1:${turn}` }])
    }
    await until(async () => (await ghCalls('POST', /\/issues\/7\/comments$/)).length >= 3)
    const tokenCalls = await ghCalls('POST', /^\/app\/installations\/777\/access_tokens$/)
    expect(tokenCalls).toHaveLength(1)
    const jwt = tokenCalls[0]!.auth!.replace('Bearer ', '')
    const claims = JSON.parse(atob(jwt.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/')))
    expect(claims.iss).toBe('424242')
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)
    const comments = await ghCalls('POST', /\/issues\/7\/comments$/)
    expect(comments.every((c) => c.auth === 'Bearer ghs_fake1_777' || /^Bearer ghs_fake\d+_777$/.test(c.auth ?? ''))).toBe(true)
  })
})

describe('PR events', () => {
  const pull = (login: string, fork = false) => ({
    number: 12,
    title: 'Fix typo',
    body: '',
    user: user(login),
    html_url: 'https://github.com/acme/app/pull/12',
    head: { ref: 'bot/fix-typo', sha: 'abc1234def5678abc1234def5678abc1234def56', repo: { full_name: fork ? 'someone/app' : 'acme/app' } },
    base: { ref: 'main', repo: { full_name: 'acme/app' } },
    merged: false
  })

  it('wakes the worker on a failed check of the owner’s own pull request, then on its pass', async () => {
    p = await pairWith([reviewer])
    await fakeApi('config', { answers: { 'github:GET /repos/acme/app/pulls/12': pull('octo-owner') } })
    const run = (conclusion: string) => ({
      action: 'completed',
      check_run: { name: 'test', conclusion, html_url: 'https://github.com/acme/app/runs/1', pull_requests: [{ number: 12 }], output: { title: '3 failed' } },
      repository,
      installation: installation(),
      sender: user('github-actions[bot]', 'Bot')
    })
    await hook('check_run', run('success'))
    await p.link.settle(300)
    expect(p.deliveries('pr_event')).toHaveLength(0) // a pass with no failure before is nothing
    await hook('check_run', run('failure'))
    expect(await p.next('pr_event')).toMatchObject({ botId: 'bot-reviewer', repo: 'acme/app', number: 12, branch: 'bot/fix-typo', event: 'check_failed', check: 'test', headSha: 'abc1234def5678abc1234def5678abc1234def56' })
    await hook('check_run', run('success'))
    expect(await p.next('pr_event')).toMatchObject({ event: 'check_passed' })
  })

  it('ignores pull requests by others and from forks', async () => {
    p = await pairWith([reviewer])
    await hook('pull_request', { action: 'closed', pull_request: { ...pull('someone-else'), merged: true }, repository, installation: installation(), sender: user('octo-owner') })
    await hook('pull_request', { action: 'closed', pull_request: { ...pull('octo-owner', true), merged: true }, repository, installation: installation(), sender: user('octo-owner') })
    await hook('pull_request', { action: 'closed', pull_request: { ...pull('octo-owner'), merged: true }, repository, installation: installation(), sender: user('maintainer') })
    const merged = await p.next('pr_event')
    expect(merged).toMatchObject({ event: 'merged', actor: 'maintainer' })
    await p.link.settle(200)
    expect(p.deliveries('pr_event')).toHaveLength(0)
  })
})

describe('triggers', () => {
  const rule = (kinds: string[], extra: Record<string, unknown> = {}) => ({ id: `r-${kinds.join('-')}-${Object.keys(extra).join('-')}`, botId: 'bot-reviewer', source: 'github', kinds, places: ['github:1:acme/app'], graceMs: 60_000, ...extra })

  it('fires the owner’s pr_opened only with fromOwner, nothing for the owner’s comment, and ci_failed whoever pushed', async () => {
    p = await pairWith([reviewer], [rule(['pr_opened']), rule(['pr_opened'], { fromOwner: true }), rule(['comment']), rule(['ci_failed'])])
    const opened = { action: 'opened', pull_request: { number: 20, title: 'New thing', body: 'no mention', user: user('octo-owner'), html_url: 'https://github.com/acme/app/pull/20', head: { ref: 'x', sha: 'a'.repeat(40) }, base: { ref: 'main' } }, repository, installation: installation(), sender: user('Octo-Owner') }
    await hook('pull_request', opened)
    const fired = await p.next('trigger')
    expect(fired).toMatchObject({ ruleId: 'r-pr_opened-fromOwner', event: { kind: 'pr_opened', actorId: 'Octo-Owner', fromOwner: true, subject: 'acme/app#20' } })
    await hook('issue_comment', issueComment('just a note', 'Octo-Owner'))
    await hook('check_run', { action: 'completed', check_run: { name: 'ci', conclusion: 'failure', html_url: 'https://github.com/acme/app/runs/2', pull_requests: [{ number: 20 }] }, repository, installation: installation(), sender: user('Octo-Owner') })
    const ci = await p.next('trigger')
    expect(ci).toMatchObject({ ruleId: 'r-ci_failed-', event: { kind: 'ci_failed' } })
    await p.link.settle(300)
    expect(p.deliveries('trigger')).toHaveLength(0)
  })

  it('never fires on the app’s own doings; matches places by repository whatever the installation', () => {
    const bot = { ...reviewer, paused: false } as never
    const r = { id: 'r', botId: 'bot-reviewer', source: 'github' as const, kinds: ['comment'], places: ['github:1:ACME/app'], graceMs: 0 }
    const event = { source: 'github' as const, kind: 'comment', key: 'k', actorId: 'someone', placeRef: 'github:42:acme/app', occurredAt: 1, selfIds: [`${SLUG}[bot]`] }
    expect(matchesRule(r, bot, event)).toBe(true)
    expect(matchesRule(r, bot, { ...event, actorId: `${SLUG}[bot]` })).toBe(false)
    expect(matchesRule(r, bot, { ...event, placeRef: 'github:42:acme/other' })).toBe(false)
    expect(matchesRule({ ...r, from: 'alice, bob' }, bot, { ...event, actorId: 'bob' })).toBe(true)
    expect(matchesRule({ ...r, from: 'alice' }, bot, event)).toBe(false)
  })
})

describe('actions and secrets', () => {
  it('comments once per idempotency key and reads an issue', async () => {
    p = await pairWith([reviewer])
    await fakeApi('config', { answers: { 'github:GET /repos/acme/app/issues/7': { title: 'Typo', body: 'teh', state: 'open', user: { login: 'reporter' } } } })
    const first = await p.action('post', 'github:42:acme/app:7', { text: 'A note' }, 'post-1')
    const again = await p.action('post', 'github:42:acme/app:7', { text: 'A note' }, 'post-1')
    expect(first.ok).toBe(true)
    expect(again.result).toEqual(first.result)
    expect(await ghCalls('POST', /\/issues\/7\/comments$/)).toHaveLength(1)
    const read = await p.action('read', 'github:42:acme/app:7')
    expect(read.result).toMatchObject({ title: 'Typo', body: 'teh', state: 'open' })
  })

  it('keeps the app key, webhook secret and installation tokens out of Hub storage', async () => {
    p = await pairWith([reviewer])
    await hook('issue_comment', issueComment(`@${SLUG} hi`))
    const { conversation } = await p.next('start')
    p.events([{ kind: 'reply', conversation, sessionId: 's1', turnId: 't9', text: 'ok', outcome: 'answered', idempotencyKey: 's1:t9' }])
    await until(() => ghCalls('POST', /\/issues\/7\/comments$/))
    const dump = await hubStub().dumpStorage()
    expect(dump).not.toContain('marker-github-hook-3b9c')
    expect(dump).not.toContain('PRIVATE KEY')
    expect(dump).not.toContain('ghs_fake')
  })
})
