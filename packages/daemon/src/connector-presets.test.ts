import { describe, expect, it } from 'bun:test'
import { connectorPresets, presetMcpServers } from './connector-presets.ts'
import { relayHealthFields } from './connector-client.ts'

describe('connector presets', () => {
  it('keeps only known presets, once each', () => {
    expect(connectorPresets(['cloudflare', 'cloudflare', 'evil', 3])).toEqual(['cloudflare'])
    expect(connectorPresets(['toString'])).toBeUndefined()
    expect(connectorPresets('cloudflare')).toBeUndefined()
    expect(connectorPresets([])).toBeUndefined()
  })

  it('gives the Cloudflare MCP server over HTTP', () => {
    expect(presetMcpServers(['cloudflare'])).toEqual({ cloudflare: { type: 'http', url: 'https://mcp.cloudflare.com/mcp' } })
    expect(presetMcpServers(undefined)).toEqual({})
  })
})

describe('relay health fields', () => {
  it('reads the features, missing secret names and version', () => {
    expect(
      relayHealthFields({
        version: '0.2.0',
        features: ['phone', 'slack', 7],
        featuresFrom: 'FEATURES',
        missing: { linear: ['LINEAR_WEBHOOK_SECRET'], bad: 'x' }
      })
    ).toEqual({ features: ['phone', 'slack'], featuresFrom: 'FEATURES', missing: { linear: ['LINEAR_WEBHOOK_SECRET'] }, relayVersion: '0.2.0' })
  })

  it('is empty for an older relay', () => {
    expect(relayHealthFields({ ok: true, sources: ['discord'] })).toEqual({})
  })
})
