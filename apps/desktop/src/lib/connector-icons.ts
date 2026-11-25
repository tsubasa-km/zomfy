import type { ChatMcpServer } from '@zomfy/protocol'

// Which icon a connector (MCP server) row shows: a service's site icon by domain, or a generic one
// for its kind. claude.ai connectors reach Claude through Anthropic's proxy, so their URL says
// nothing about the service: those are known by name.

export type ConnectorIcon =
  | { kind: 'site'; domain: string }
  | { kind: 'harness' }
  | { kind: 'stdio' }
  | { kind: 'plugin' }
  | { kind: 'remote' }
  | { kind: 'letter' }
  | { kind: 'chrome' }

/** Service names a claude.ai connector is called by, first match wins, and the service's domain. */
const KNOWN_SERVICES: [RegExp, string][] = [
  [/\bgmail\b/, 'mail.google.com'],
  [/\bgoogle calendar\b/, 'calendar.google.com'],
  [/\bgoogle drive\b/, 'drive.google.com'],
  [/\bgoogle docs\b/, 'docs.google.com'],
  [/\bgoogle workspace\b/, 'workspace.google.com'],
  [/\bcloudflare\b/, 'cloudflare.com'],
  [/\bnotion\b/, 'notion.com'],
  [/\bexcalidraw\b/, 'excalidraw.com'],
  [/kintone/, 'kintone.cybozu.co.jp'],
  [/\bslack\b/, 'slack.com'],
  [/\bgithub\b/, 'github.com'],
  [/\blinear\b/, 'linear.app'],
  [/\batlassian\b|\bjira\b|\bconfluence\b/, 'atlassian.com'],
  [/\basana\b/, 'asana.com'],
  [/\bfigma\b/, 'figma.com'],
  [/\bcanva\b/, 'canva.com'],
  [/\bbox\b/, 'box.com'],
  [/\bdropbox\b/, 'dropbox.com'],
  [/\bsentry\b/, 'sentry.io'],
  [/\bstripe\b/, 'stripe.com'],
  [/\bvercel\b/, 'vercel.com'],
  [/\bzapier\b/, 'zapier.com'],
  [/\bhubspot\b/, 'hubspot.com'],
  [/\bintercom\b/, 'intercom.com'],
  [/\bmonday\b/, 'monday.com'],
  [/\bpaypal\b/, 'paypal.com'],
  [/\bsquare\b/, 'squareup.com'],
  [/\bsupabase\b/, 'supabase.com'],
  [/\bmicrosoft 365\b|\boutlook\b/, 'microsoft365.com'],
  [/\bclaude\b/, 'claude.ai']
]

const CLAUDE_AI_PREFIX = /^claude\.ai\s+/i
const CLAUDE_IN_CHROME = 'claude-in-chrome'

/** The service a claude.ai connector's name stands for, as a domain. */
export function knownServiceDomain(name: string): string | null {
  const plain = name.replace(CLAUDE_AI_PREFIX, '').toLowerCase()
  for (const [pattern, domain] of KNOWN_SERVICES) if (pattern.test(plain)) return domain
  return null
}

/** A name the desktop may ask the daemon about: public, with a dot, not an address. */
export function isPublicHost(host: string): boolean {
  const name = host.toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(name) || !name.includes('.')) return false
  if (/^[\d.]+$/.test(name)) return false
  return !/\.(localhost|local|internal|lan|home|test|invalid|example|arpa|intranet|corp)$/.test(name)
}

function urlHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname : null
  } catch {
    return null
  }
}

export function connectorIcon(server: Pick<ChatMcpServer, 'name' | 'scope' | 'transport' | 'url' | 'harness'>): ConnectorIcon {
  if (server.harness) return { kind: 'harness' }
  // Claude Code's built-in Claude in Chrome server (`--chrome`).
  if (server.name === CLAUDE_IN_CHROME) return { kind: 'chrome' }
  const claudeAi = server.scope === 'claudeai' || server.transport === 'claudeai-proxy' || CLAUDE_AI_PREFIX.test(server.name)
  if (claudeAi) {
    const known = knownServiceDomain(server.name)
    if (known) return { kind: 'site', domain: known }
  }
  const host = server.transport === 'claudeai-proxy' ? null : urlHost(server.url)
  if (host && isPublicHost(host)) return { kind: 'site', domain: host }
  // A claude.ai connector not in the map: its proxy URL has no icon of the service.
  if (claudeAi) return { kind: 'letter' }
  // Plugins' servers come as `plugin:<plugin>:<server>`, scoped `dynamic` or `plugin`.
  if (server.scope === 'plugin' || server.name.startsWith('plugin:')) return { kind: 'plugin' }
  if (server.transport === 'stdio' || (!server.url && !claudeAi)) return { kind: 'stdio' }
  return { kind: 'remote' }
}

/** The letter and hue of a server's fallback avatar, the same for a name every time. */
export function letterAvatar(name: string): { letter: string; hue: number } {
  const plain = name.replace(CLAUDE_AI_PREFIX, '').replace(/^plugin:[^:]+:/, '')
  const letter = (/[\p{L}\p{N}]/u.exec(plain)?.[0] ?? '?').toUpperCase()
  let hash = 0
  for (const char of plain) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return { letter, hue: hash % 360 }
}
