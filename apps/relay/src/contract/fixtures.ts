// One valid example of every message, delivery kind and event kind. The contract's tests parse and
// round-trip each; the Worker's and the daemon's tests build on them.

import type { BotEvent, Delivery } from './bots'
import { CONTRACT_VERSION } from './version'

const KEY = 'A'.repeat(43) + '='
const SIG = 'B'.repeat(86) + '=='
const T0 = 1_790_000_000_000
const conversation = { source: 'discord', externalId: 'g1:c1:t1' } as const
const asker = { source: 'discord', id: 'u-owner', name: 'Owner', role: 'owner' } as const

export const fixtureBot = {
  id: 'bot-reviewer',
  name: 'Reviewer',
  handle: 'reviewer',
  agent: 'claude',
  paused: false,
  owner: { discord: 'u-owner' },
  askers: { discord: [{ id: 'u-member', role: 'member' as const }] },
  places: ['discord:g1:c1']
}

export const fixtureRule = {
  id: 'rule-1',
  botId: 'bot-reviewer',
  source: 'github' as const,
  kinds: ['workflow_run.failed'],
  places: ['github:42:acme/app:7'],
  fromOwner: true,
  graceMs: 60_000
}

export const deliveryFixtures: { [K in Delivery['kind']]: Extract<Delivery, { kind: K }> } = {
  start: {
    id: 'dl-start',
    kind: 'start',
    botId: 'bot-reviewer',
    conversation,
    askedAt: T0,
    expiresAt: T0 + 86_400_000,
    asker,
    placeId: 'discord:g1:c1',
    text: 'fix the typo in README',
    context: [{ label: 'earlier', author: { id: 'u-member', name: 'Member' }, text: 'see line 3', at: T0 - 1000 }],
    links: [{ url: 'https://example.com/readme', title: 'README' }],
    attachments: [{ name: 'shot.png', url: 'https://cdn.example.com/shot.png', mimeType: 'image/png', size: 1234 }]
  },
  send: {
    id: 'dl-send',
    kind: 'send',
    botId: 'bot-reviewer',
    conversation,
    askedAt: T0,
    expiresAt: T0 + 86_400_000,
    asker,
    text: 'and the one in CONTRIBUTING',
    context: []
  },
  answer: {
    id: 'dl-answer',
    kind: 'answer',
    botId: 'bot-reviewer',
    conversation,
    askedAt: T0,
    expiresAt: T0 + 300_000,
    asker,
    promptId: 'pr-1',
    optionId: 'allow'
  },
  cancel: {
    id: 'dl-cancel',
    kind: 'cancel',
    botId: 'bot-reviewer',
    conversation,
    askedAt: T0,
    expiresAt: T0 + 300_000,
    asker,
    turnId: 'turn-1'
  },
  trigger: {
    id: 'dl-trigger',
    kind: 'trigger',
    botId: 'bot-reviewer',
    conversation: { source: 'github', externalId: 'acme/app#7' },
    askedAt: T0,
    expiresAt: T0 + 86_400_000,
    ruleId: 'rule-1',
    event: { action: 'completed', conclusion: 'failure' },
    graceMs: 60_000
  },
  webhook_notice: {
    id: 'dl-hook',
    kind: 'webhook_notice',
    botId: 'bot-reviewer',
    conversation: { source: 'webhook', externalId: 'hook-1' },
    askedAt: T0,
    expiresAt: T0 + 86_400_000,
    hookId: 'hook-1',
    callId: 'call-1'
  },
  pr_event: {
    id: 'dl-pr',
    kind: 'pr_event',
    botId: 'bot-reviewer',
    conversation: { source: 'github', externalId: 'acme/app#7' },
    askedAt: T0,
    expiresAt: T0 + 86_400_000,
    repo: 'acme/app',
    number: 7,
    branch: 'bot/fix-typo',
    headSha: 'abc1234',
    event: 'check_failed'
  },
  access_request: {
    id: 'dl-access',
    kind: 'access_request',
    botId: 'bot-reviewer',
    conversation,
    askedAt: T0,
    expiresAt: T0 + 86_400_000,
    requester: { source: 'discord', id: 'u-stranger', name: 'Stranger' },
    message: 'may I use the reviewer?'
  }
}

export const eventFixtures: { [K in BotEvent['kind']]: Extract<BotEvent, { kind: K }> } = {
  snapshot: { kind: 'snapshot', conversations: [{ conversation, sessionId: 's-1', botId: 'bot-reviewer', lastActiveAt: T0 }] },
  linked: { kind: 'linked', conversation, sessionId: 's-1', botId: 'bot-reviewer' },
  unlinked: { kind: 'unlinked', conversation, sessionId: 's-1' },
  'chat-gone': { kind: 'chat-gone', conversation, sessionId: 's-1' },
  prompt: {
    kind: 'prompt',
    conversation,
    sessionId: 's-1',
    turnId: 'turn-1',
    promptId: 'pr-1',
    prompt: {
      kind: 'approval',
      tool: 'Bash',
      summary: 'git push',
      options: [
        { id: 'allow', label: 'Allow' },
        { id: 'deny', label: 'Deny' }
      ]
    }
  },
  'prompt-cleared': { kind: 'prompt-cleared', conversation, promptId: 'pr-1', by: 'zomfy' },
  'turn-started': { kind: 'turn-started', conversation, sessionId: 's-1', turnId: 'turn-1' },
  activity: { kind: 'activity', conversation, turnId: 'turn-1', text: 'Reading README.md', steps: [{ text: 'Find the typo', status: 'done' }] },
  workers: { kind: 'workers', conversation, workers: [{ sessionId: 's-2', title: 'Fix typo', status: 'running' }] },
  'turn-ended': { kind: 'turn-ended', conversation, turnId: 'turn-1', outcome: 'answered' },
  reply: {
    kind: 'reply',
    conversation,
    sessionId: 's-1',
    turnId: 'turn-1',
    text: 'Fixed in https://github.com/acme/app/pull/8',
    outcome: 'answered',
    prLinks: ['https://github.com/acme/app/pull/8'],
    reviewNotes: [{ path: 'README.md', line: 3, body: 'typo' }],
    idempotencyKey: 's-1:turn-1'
  }
}

/** Every message type on the host link, both directions, keyed `<ch>/<type>`. */
export const messageFixtures = {
  'link/challenge': { ch: 'link', type: 'challenge', nonce: 'bm9uY2Utbm9uY2Utbm9uY2U=' },
  'link/auth': { ch: 'link', type: 'auth', signature: SIG },
  'link/auth-ok': { ch: 'link', type: 'auth-ok', hostId: 'h_abcdefgh1234' },
  'link/ping': { ch: 'link', type: 'ping' },
  'link/pong': { ch: 'link', type: 'pong' },
  'bots/hello': {
    ch: 'bots',
    type: 'hello',
    contract: CONTRACT_VERSION,
    host: { id: 'h_abcdefgh1234', name: 'Desk', kind: 'desktop' },
    features: ['events-seq'],
    sources: ['discord'],
    promptKinds: ['approval', 'question'],
    bots: [fixtureBot],
    rules: [fixtureRule],
    pages: 1
  },
  'bots/hello-bots': { ch: 'bots', type: 'hello-bots', page: 2, bots: [{ ...fixtureBot, id: 'bot-2', handle: 'second' }] },
  'bots/hello-ok': { ch: 'bots', type: 'hello-ok', helloRev: 3, features: ['events-seq'], unsettled: ['dl-start'] },
  'bots/delivery': { ch: 'bots', type: 'delivery', helloRev: 3, deliveries: Object.values(deliveryFixtures) },
  'bots/ack': { ch: 'bots', type: 'ack', helloRev: 3, deliveryId: 'dl-start', step: 'done', outcome: 'accepted' },
  'bots/events': { ch: 'bots', type: 'events', helloRev: 3, seq: 0, events: Object.values(eventFixtures) },
  'bots/action': {
    ch: 'bots',
    type: 'action',
    helloRev: 3,
    reqId: 'req-1',
    verb: 'post',
    ref: 'discord:g1:c1:t1',
    args: { text: 'hello' },
    idempotencyKey: 'post-1'
  },
  'bots/action-result': { ch: 'bots', type: 'action-result', reqId: 'req-1', ok: true, result: { messageId: 'm-1' } },
  'bots/control': { ch: 'bots', type: 'control', action: 'pause', forMs: 60_000 },
  'bots/error': { ch: 'bots', type: 'error', code: 'hello_required', message: 'send hello first' },
  'phone/device-add': { ch: 'phone', type: 'device-add', deviceId: 'd_abcdefgh1234', publicKey: KEY },
  'phone/device-remove': { ch: 'phone', type: 'device-remove', deviceId: 'd_abcdefgh1234' },
  'phone/frame': { ch: 'phone', type: 'frame', deviceId: 'd_abcdefgh1234', data: 'Y2lwaGVydGV4dA==' }
} as const

/** Which direction each message travels. */
export const toHubTypes = [
  'link/auth',
  'link/ping',
  'bots/hello',
  'bots/hello-bots',
  'bots/ack',
  'bots/events',
  'bots/action',
  'phone/device-add',
  'phone/device-remove',
  'phone/frame'
] as const
export const toHostTypes = [
  'link/challenge',
  'link/auth-ok',
  'link/pong',
  'bots/hello-ok',
  'bots/delivery',
  'bots/action-result',
  'bots/control',
  'bots/error',
  'phone/frame'
] as const

export const httpFixtures = {
  register: { setupCode: 'setup-code-marker', publicKey: KEY, name: 'Desk' },
  registerWithInvite: { invite: 'inv_abc', publicKey: KEY, name: 'Laptop' },
  registerResponse: { hostId: 'h_abcdefgh1234' },
  invite: { hostId: 'h_abcdefgh1234', at: T0, signature: SIG },
  inviteResponse: { invite: 'inv_abc', expiresAt: T0 + 600_000 },
  webhookCall: { hookId: 'hook-1', callId: 'call-1', receivedAt: T0, headers: { 'content-type': 'application/json' }, body: '{}' }
}
