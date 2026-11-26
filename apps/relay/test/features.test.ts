import { createExecutionContext, env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import { configuredSources, listedFeatures, missingSecrets, relayFeatures, type Env } from '../src/env'
import { BASE, SETUP_CODE } from './helpers'

// The relay's features and what /health says of them (docs/specs/relay-settings.md#the-worker).

const slack = { SLACK_BOT_TOKEN: 'xoxb-1', SLACK_SIGNING_SECRET: 's' }

describe('features', () => {
  it('serves every source with its secrets, the phone and webhooks without FEATURES', () => {
    expect(relayFeatures(slack as Env)).toEqual({ features: ['phone', 'slack', 'webhooks'], featuresFrom: 'secrets', missing: {} })
  })

  it('serves only what FEATURES lists, ignoring unknown names', () => {
    expect(listedFeatures({ FEATURES: ' Phone, slack teams ' })).toEqual(['phone', 'slack'])
    expect(listedFeatures({ FEATURES: ' , ' })).toBeNull()
    const state = relayFeatures({ ...slack, DISCORD_APPLICATION_ID: '1', DISCORD_PUBLIC_KEY: 'k', DISCORD_BOT_TOKEN: 't', FEATURES: 'phone,slack' } as Env)
    expect(state.features).toEqual(['phone', 'slack'])
    expect(state.featuresFrom).toBe('FEATURES')
    expect(configuredSources({ ...slack, FEATURES: 'discord' } as Env)).toEqual([])
  })

  it('names the secrets a wanted source lacks, and never their values', () => {
    expect(relayFeatures({ FEATURES: 'slack,linear' } as Env).missing).toEqual({
      slack: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
      linear: ['LINEAR_WEBHOOK_SECRET', 'LINEAR_ACCESS_TOKEN']
    })
    // Without FEATURES only a source with some of its secrets is wanted.
    const half = relayFeatures({ SLACK_BOT_TOKEN: 'xoxb-secret-value' } as Env)
    expect(half.missing).toEqual({ slack: ['SLACK_SIGNING_SECRET'] })
    expect(JSON.stringify(half)).not.toContain('xoxb-secret-value')
    expect(missingSecrets({ LINEAR_WEBHOOK_SECRET: 'w', LINEAR_CLIENT_ID: 'c' } as Env, 'linear')).toEqual(['LINEAR_CLIENT_SECRET'])
    expect(missingSecrets({ LINEAR_WEBHOOK_SECRET: 'w', LINEAR_ACCESS_TOKEN: 'a' } as Env, 'linear')).toEqual([])
  })
})

describe('routes and /health', () => {
  it('reports the features, allows any origin, and holds no secret', async () => {
    const res = await SELF.fetch(`${BASE}/health`)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({
      features: ['phone', 'discord', 'slack', 'github', 'linear', 'webhooks'],
      featuresFrom: 'secrets',
      missing: {},
      setupCode: true
    })
    expect(text).not.toContain(SETUP_CODE)
  })

  async function call(path: string, init: RequestInit, extra: Partial<Env>) {
    return worker.fetch(new Request(`${BASE}${path}`, init), { ...(env as unknown as Env), ...extra }, createExecutionContext())
  }

  it('answers 404 for the routes of features FEATURES leaves out', async () => {
    const only = { FEATURES: 'slack' }
    expect((await call('/hooks/wh_AAAAAAAAAAAAAAAA', { method: 'POST', body: '{}' }, only)).status).toBe(404)
    expect((await call('/v1/hosts/invite', { method: 'POST', body: '{}' }, only)).status).toBe(404)
    expect((await call('/v1/device/h1/ws', { headers: { Upgrade: 'websocket' } }, only)).status).toBe(404)
    expect((await call('/discord/interactions', { method: 'POST', body: '{}' }, only)).status).toBe(404)
    expect((await call('/github/webhook', { method: 'POST', body: '{}' }, only)).status).toBe(404)
    // A served source still checks its signature, and /health is always there.
    expect((await call('/slack/events', { method: 'POST', body: '{}' }, only)).status).toBe(401)
    const health = (await (await call('/health', {}, only)).json()) as { features: string[]; sources: string[] }
    expect(health.features).toEqual(['slack'])
    expect(health.sources).toEqual(['slack'])
  })
})
