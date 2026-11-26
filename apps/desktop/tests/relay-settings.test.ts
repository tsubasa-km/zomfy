import { describe, expect, test } from 'bun:test'
import { checkRelayHealth, featuresValue, relayBase, relayFeatureState } from '../src/lib/relay-features'
import { buildRelaySetupPrompt } from '../src/lib/relay-setup-prompt'

// docs/specs/relay-settings.md

describe('relay features', () => {
  test('reads a feature’s state from the relay’s health', () => {
    const health = { sources: ['slack'], features: ['phone', 'slack'], missing: { discord: ['DISCORD_BOT_TOKEN'] } }
    expect(relayFeatureState('slack', health)).toEqual({ kind: 'on' })
    expect(relayFeatureState('discord', health)).toEqual({ kind: 'needs', secrets: ['DISCORD_BOT_TOKEN'] })
    expect(relayFeatureState('webhooks', health)).toEqual({ kind: 'off' })
    expect(relayFeatureState('phone', null)).toEqual({ kind: 'unknown' })
  })

  test('an older relay without features served the phone, webhooks and its sources', () => {
    const health = { sources: ['discord'] }
    expect(relayFeatureState('phone', health)).toEqual({ kind: 'on' })
    expect(relayFeatureState('discord', health)).toEqual({ kind: 'on' })
    expect(relayFeatureState('linear', health)).toEqual({ kind: 'off' })
  })

  test('FEATURES lists known features in the relay’s order', () => {
    expect(featuresValue(['slack', 'phone', 'teams'])).toBe('phone,slack')
    expect(relayBase('https://relay.example.com/')).toBe('https://relay.example.com')
    expect(relayBase('ftp://x')).toBeNull()
  })

  test('Check reads /health and refuses what is not a relay', async () => {
    const answer = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch
    const health = await checkRelayHealth('https://r.example/', answer({ ok: true, version: '0.1.0', sources: [], features: ['phone'], missing: {}, featuresFrom: 'secrets' }))
    expect(health).toEqual({ sources: [], features: ['phone'], missing: {}, featuresFrom: 'secrets', relayVersion: '0.1.0' })
    await expect(checkRelayHealth('https://r.example', answer({ hello: 1 }))).rejects.toThrow()
  })
})

describe('the set-up prompt', () => {
  const base = { features: ['discord', 'phone'], place: 'checkout' as const, cloudflareMcp: false, relayUrl: null }

  test('English names the features, asks for secrets and sets FEATURES', () => {
    const prompt = buildRelaySetupPrompt({ ...base, language: 'en' })
    expect(prompt).toContain('for these features: Phone app, Discord.')
    expect(prompt).toContain('never invent, guess or generate a secret value')
    expect(prompt).toContain('npx wrangler secret put DISCORD_BOT_TOKEN')
    expect(prompt).toContain('`phone,discord`')
    expect(prompt).toContain('Pair a phone')
    expect(prompt).not.toContain('MCP server')
    expect(prompt).not.toContain('Slack:')
  })

  test('Japanese is a whole prompt of its own', () => {
    const prompt = buildRelaySetupPrompt({ ...base, language: 'ja', place: 'clone', cloudflareMcp: true, relayUrl: 'https://r.example' })
    expect(prompt).toContain('使う機能: スマホアプリ、Discord。')
    expect(prompt).toContain('新しく clone')
    expect(prompt).toContain('https://r.example')
    expect(prompt).toContain('MCP サーバー')
    expect(prompt).toContain('シークレットの値を自分で作ったり')
  })
})
