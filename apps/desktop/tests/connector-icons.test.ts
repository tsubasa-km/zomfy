import { describe, expect, test } from 'bun:test'
import { connectorIcon, isPublicHost, knownServiceDomain, letterAvatar } from '../src/lib/connector-icons.ts'

const server = (name: string, extra: { scope?: string | null; transport?: string | null; url?: string; harness?: boolean } = {}) => ({
  name,
  scope: null,
  transport: null,
  harness: false,
  ...extra
})

describe('knownServiceDomain', () => {
  test('knows claude.ai connectors by their service name', () => {
    expect(knownServiceDomain('claude.ai Gmail')).toBe('mail.google.com')
    expect(knownServiceDomain('claude.ai Google Calendar')).toBe('calendar.google.com')
    expect(knownServiceDomain('claude.ai Google Drive')).toBe('drive.google.com')
    expect(knownServiceDomain('claude.ai Cloudflare Developer Platform')).toBe('cloudflare.com')
    expect(knownServiceDomain('claude.ai Notion')).toBe('notion.com')
    expect(knownServiceDomain('claude.ai Excalidraw')).toBe('excalidraw.com')
    expect(knownServiceDomain('claude.ai Zenk Kintone')).toBe('kintone.cybozu.co.jp')
    expect(knownServiceDomain('claude.ai KintoneDev')).toBe('kintone.cybozu.co.jp')
    expect(knownServiceDomain('claude.ai Claude Docs')).toBe('claude.ai')
    expect(knownServiceDomain('claude.ai Something New')).toBeNull()
  })
})

describe('connectorIcon', () => {
  test('a claude.ai connector by name, never by its proxy URL', () => {
    expect(connectorIcon(server('claude.ai Gmail', { scope: 'claudeai', transport: 'claudeai-proxy', url: 'https://mcp-proxy.anthropic.com/v1/x' }))).toEqual({
      kind: 'site',
      domain: 'mail.google.com'
    })
    expect(connectorIcon(server('claude.ai Unknown', { scope: 'claudeai', transport: 'claudeai-proxy', url: 'https://mcp-proxy.anthropic.com/v1/x' }))).toEqual({
      kind: 'letter'
    })
  })
  test('a remote server by its URL domain', () => {
    expect(connectorIcon(server('notion', { scope: 'user', transport: 'http', url: 'https://mcp.notion.com/mcp' }))).toEqual({ kind: 'site', domain: 'mcp.notion.com' })
    expect(connectorIcon(server('dev', { scope: 'project', transport: 'http', url: 'http://localhost:3000/mcp' }))).toEqual({ kind: 'remote' })
    expect(connectorIcon(server('lan', { transport: 'sse', url: 'http://192.168.1.4/sse' }))).toEqual({ kind: 'remote' })
  })
  test('Claude Code’s Claude in Chrome server gets the Chrome mark', () => {
    expect(connectorIcon(server('claude-in-chrome', { scope: 'dynamic', transport: 'stdio' }))).toEqual({ kind: 'chrome' })
    expect(connectorIcon(server('claude-in-chrome'))).toEqual({ kind: 'chrome' })
  })
  test('stdio, plugin and the harness get generic icons', () => {
    expect(connectorIcon(server('discord', { scope: 'user', transport: 'stdio' }))).toEqual({ kind: 'stdio' })
    expect(connectorIcon(server('plugin:deploy-on-aws:awsiac', { scope: 'plugin', transport: 'stdio' }))).toEqual({ kind: 'plugin' })
    expect(connectorIcon(server('plugin:deploy-on-aws:awspricing', { scope: 'dynamic', transport: 'stdio' }))).toEqual({ kind: 'plugin' })
    expect(connectorIcon(server('plugin:x:remote', { scope: 'plugin', transport: 'http', url: 'https://knowledge-mcp.global.api.aws' }))).toEqual({
      kind: 'site',
      domain: 'knowledge-mcp.global.api.aws'
    })
    expect(connectorIcon(server('harness', { harness: true, transport: 'http', url: 'http://127.0.0.1:4000/mcp' }))).toEqual({ kind: 'harness' })
  })
})

describe('isPublicHost and letterAvatar', () => {
  test('public hosts only', () => {
    expect(isPublicHost('mcp.notion.com')).toBe(true)
    for (const host of ['localhost', '127.0.0.1', 'box.local', 'api.internal', 'intranet']) expect(isPublicHost(host)).toBe(false)
  })
  test('a stable letter and hue, past prefixes', () => {
    expect(letterAvatar('claude.ai Zenk Kintone').letter).toBe('Z')
    expect(letterAvatar('plugin:deploy-on-aws:awsiac').letter).toBe('A')
    expect(letterAvatar('discord')).toEqual(letterAvatar('discord'))
  })
})
