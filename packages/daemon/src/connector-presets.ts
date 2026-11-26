import { CLOUDFLARE_MCP_URL, type ChatConnectorPreset } from '@zomfy/protocol'

// MCP servers a chat can be started with, for that chat alone (docs/specs/relay-settings.md):
// the host's Claude settings are not touched. `cloudflare` is the server of Cloudflare's own agent
// plugin; it signs in with Cloudflare's OAuth, which the chat's Connectors offer.

const PRESETS: Record<ChatConnectorPreset, { type: 'http'; url: string }> = {
  cloudflare: { type: 'http', url: CLOUDFLARE_MCP_URL }
}

/** The known presets among `value`, once each, or undefined when there are none. */
export function connectorPresets(value: unknown): ChatConnectorPreset[] | undefined {
  if (!Array.isArray(value)) return undefined
  const presets = [...new Set(value.filter((v): v is ChatConnectorPreset => typeof v === 'string' && Object.hasOwn(PRESETS, v)))]
  return presets.length > 0 ? presets : undefined
}

/** Claude Agent SDK `mcpServers` entries for a chat's presets. */
export function presetMcpServers(presets: readonly ChatConnectorPreset[] | undefined): Record<string, { type: 'http'; url: string }> {
  const servers: Record<string, { type: 'http'; url: string }> = {}
  for (const preset of presets ?? []) if (PRESETS[preset]) servers[preset] = { ...PRESETS[preset] }
  return servers
}
