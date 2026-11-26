import type { ChatMcpServer } from '@zomfy/protocol'

// When the Session panel's Connectors asks the daemon for a chat's MCP servers. The first read
// starts a Claude Code process of the chat's own, which costs seconds of CPU; a chat the person
// only passes through on the way to another one should start none.

/** A chat must stay in front this long before its servers are read. */
export const CONNECTORS_READ_DELAY_MS = 600
/** A list read this recently is shown again as it was, without asking. */
export const CONNECTORS_FRESH_MS = 60_000

/** What is known of a chat's servers: the list and when it was last read, if ever. */
export interface KnownConnectors {
  servers: readonly ChatMcpServer[]
  /** When a read last answered; unset while none has. */
  readAt?: number
  /** The last read failed, or ran out of retries with servers still connecting. */
  stale?: boolean
}

/** Whether a server in the list is still connecting, so the list will change. */
export function connectorsConnecting(servers: readonly ChatMcpServer[]): boolean {
  return servers.some((s) => s.status === 'pending')
}

/** The list to show at once for a chat just brought to the front, or null when none was read. */
export function shownConnectors(known: KnownConnectors | undefined): ChatMcpServer[] | null {
  return known?.readAt !== undefined ? [...known.servers] : null
}

/** Whether the panel should ask again, or can show what it has. */
export function connectorsReadNeeded(known: KnownConnectors | undefined, now: number): boolean {
  if (!known || known.readAt === undefined || known.stale) return true
  return now - known.readAt > CONNECTORS_FRESH_MS || connectorsConnecting(known.servers)
}
