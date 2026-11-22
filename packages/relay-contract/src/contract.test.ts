import { describe, expect, test } from 'bun:test'
import {
  ackSchema,
  askerRole,
  BOT_EVENT_KINDS,
  botEventSchema,
  canAskBot,
  DELIVERY_KINDS,
  deliverySchema,
  failureSchema,
  formatRef,
  helloBotSchema,
  inviteRequestSchema,
  inviteResponseSchema,
  parseRef,
  parseToHost,
  parseToHub,
  registerRequestSchema,
  registerResponseSchema,
  webhookCallSchema
} from './index'
import { deliveryFixtures, eventFixtures, fixtureBot, httpFixtures, messageFixtures, toHostTypes, toHubTypes } from './fixtures'

const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value))

describe('messages', () => {
  test('every message type has a direction', () => {
    const directed = new Set<string>([...toHubTypes, ...toHostTypes])
    expect([...directed].sort()).toEqual(Object.keys(messageFixtures).sort())
  })

  for (const name of toHubTypes) {
    test(`${name} parses and round-trips toward the Hub`, () => {
      const first = parseToHub(JSON.stringify(messageFixtures[name]))
      expect(first.kind).toBe('message')
      if (first.kind !== 'message') return
      const second = parseToHub(JSON.stringify(roundTrip(first.message)))
      expect(second).toEqual(first)
      expect(first.message).toEqual(roundTrip(messageFixtures[name]))
    })
  }

  for (const name of toHostTypes) {
    test(`${name} parses and round-trips toward the host`, () => {
      const first = parseToHost(JSON.stringify(messageFixtures[name]))
      expect(first.kind).toBe('message')
      if (first.kind !== 'message') return
      expect(parseToHost(JSON.stringify(roundTrip(first.message)))).toEqual(first)
      expect(first.message).toEqual(roundTrip(messageFixtures[name]))
    })
  }

  test('an unknown field is dropped, not rejected', () => {
    const parsed = parseToHub(JSON.stringify({ ...messageFixtures['bots/ack'], future: 1 }))
    expect(parsed.kind).toBe('message')
    expect(parsed.kind === 'message' && 'future' in parsed.message).toBe(false)
  })

  test('an unknown type or channel is ignored, not rejected', () => {
    expect(parseToHub(JSON.stringify({ ch: 'bots', type: 'from-the-future', x: 1 }))).toEqual({
      kind: 'ignored',
      ch: 'bots',
      type: 'from-the-future'
    })
    expect(parseToHost(JSON.stringify({ ch: 'video', type: 'frame' })).kind).toBe('ignored')
    expect(parseToHost(JSON.stringify({ ch: 'toString', type: 'x' })).kind).toBe('ignored')
  })

  test('a known type with bad fields, or not JSON, is invalid', () => {
    expect(parseToHub(JSON.stringify({ ch: 'bots', type: 'ack', deliveryId: 'x' })).kind).toBe('invalid')
    expect(parseToHub('nope').kind).toBe('invalid')
    expect(parseToHub('[1]').kind).toBe('invalid')
    expect(parseToHub('x'.repeat(1024 * 1024 + 1)).kind).toBe('invalid')
  })

  test('a frame meant for the other direction is ignored', () => {
    expect(parseToHub(JSON.stringify(messageFixtures['bots/hello-ok'])).kind).toBe('ignored')
    expect(parseToHost(JSON.stringify(messageFixtures['bots/hello'])).kind).toBe('ignored')
  })
})

describe('deliveries and events', () => {
  test('every delivery kind has a fixture that round-trips', () => {
    expect(Object.keys(deliveryFixtures).sort()).toEqual([...DELIVERY_KINDS].sort())
    for (const fixture of Object.values(deliveryFixtures)) {
      const parsed = deliverySchema.parse(fixture)
      expect(deliverySchema.parse(roundTrip(parsed))).toEqual(parsed)
      expect(parsed).toEqual(roundTrip(fixture))
    }
  })

  test('every event kind has a fixture that round-trips', () => {
    expect(Object.keys(eventFixtures).sort()).toEqual([...BOT_EVENT_KINDS].sort())
    for (const fixture of Object.values(eventFixtures)) {
      const parsed = botEventSchema.parse(fixture)
      expect(botEventSchema.parse(roundTrip(parsed))).toEqual(parsed)
    }
  })

  test('an unknown delivery kind fails alone, so the daemon can ack it unsupported', () => {
    expect(deliverySchema.safeParse({ ...deliveryFixtures.cancel, kind: 'teleport' }).success).toBe(false)
  })

  test('a start without an asker is invalid; a trigger needs none', () => {
    const { asker: _a, ...noAsker } = deliveryFixtures.start
    expect(deliverySchema.safeParse(noAsker).success).toBe(false)
    expect(deliverySchema.safeParse(deliveryFixtures.trigger).success).toBe(true)
  })

  test('an unknown failure category reads as agent_error', () => {
    expect(failureSchema.parse({ category: 'cosmic_ray' })).toEqual({ category: 'agent_error' })
    expect(failureSchema.parse({ category: 'usage_limit', resetsAt: 5 })).toEqual({ category: 'usage_limit', resetsAt: 5 })
    const ack = ackSchema.parse({ ...messageFixtures['bots/ack'], failure: { category: 'new' } })
    expect(ack.failure).toEqual({ category: 'agent_error' })
  })

  test('prompt text over 1500 bytes is refused', () => {
    const prompt = { kind: 'unsupported', text: 'é'.repeat(751) }
    expect(botEventSchema.safeParse({ ...eventFixtures.prompt, prompt }).success).toBe(false)
  })
})

describe('http bodies', () => {
  test('registration, invite and webhook call fixtures parse', () => {
    expect(registerRequestSchema.parse(httpFixtures.register)).toEqual(httpFixtures.register)
    expect(registerRequestSchema.parse(httpFixtures.registerWithInvite)).toEqual(httpFixtures.registerWithInvite)
    expect(registerResponseSchema.parse(httpFixtures.registerResponse)).toEqual(httpFixtures.registerResponse)
    expect(inviteRequestSchema.parse(httpFixtures.invite)).toEqual(httpFixtures.invite)
    expect(inviteResponseSchema.parse(httpFixtures.inviteResponse)).toEqual(httpFixtures.inviteResponse)
    expect(webhookCallSchema.parse(httpFixtures.webhookCall)).toEqual(httpFixtures.webhookCall)
  })

  test('registration needs exactly one of setup code and invite', () => {
    const { setupCode: _s, ...neither } = httpFixtures.register
    expect(registerRequestSchema.safeParse(neither).success).toBe(false)
    expect(registerRequestSchema.safeParse({ ...httpFixtures.register, invite: 'inv' }).success).toBe(false)
  })
})

describe('refs and askers', () => {
  test('refs parse and format back', () => {
    for (const text of [
      'discord:g1:c1',
      'discord:g1:c1:t1',
      'discord:g1:c1::m1',
      'slack:T1:C1:1700000000.0001',
      'github:42:acme/app:7',
      'linear:org:ENG-1',
      'zomfy:s-1'
    ]) {
      const ref = parseRef(text)
      expect(ref).not.toBeNull()
      expect(formatRef(ref!)).toBe(text)
    }
    for (const bad of ['discord:g1', 'github:42:acme:7', 'github:42:acme/app:x', 'teams:x', 'zomfy:', 'linear:o:i:x']) {
      expect(parseRef(bad)).toBeNull()
    }
  })

  test('the owner and members may ask; others may not', () => {
    expect(askerRole(fixtureBot, 'discord', 'u-owner')).toBe('owner')
    expect(askerRole(fixtureBot, 'discord', 'u-member')).toBe('member')
    expect(canAskBot(fixtureBot, 'discord', 'u-stranger')).toBe(false)
    expect(canAskBot(fixtureBot, 'slack', 'u-owner')).toBe(false)
  })

  test('a bot from an older daemon, without isDefault, still parses', () => {
    const { isDefault: _d, ...old } = fixtureBot
    expect(helloBotSchema.parse(old).isDefault).toBeUndefined()
    expect(helloBotSchema.parse(fixtureBot).isDefault).toBe(true)
  })
})
