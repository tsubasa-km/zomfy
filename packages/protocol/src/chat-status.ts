// What a chat's session panel shows beyond its transcript: the MCP servers (connectors) its agent
// has, with sign-in and reconnect, and how much of the account's usage limits are spent. Claude
// chats only for connectors; usage limits are the host's accounts (Claude, Codex).

/** An MCP server's state, as Claude Code reports it. */
export type ChatMcpServerStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'

export interface ChatMcpServer {
  name: string
  status: ChatMcpServerStatus
  /** Why it failed, when it did. */
  error?: string
  /** Where it is configured: user, project, local, claudeai, plugin, managed… (null when unknown). */
  scope: string | null
  /** stdio, http, sse, claudeai-proxy… (null when unknown). */
  transport: string | null
  /** The server's URL, for a remote one. */
  url?: string
  /** Tools it offers while connected. */
  tools: string[]
  /** The harness's own tools server, which the daemon runs: never signed into or turned off. */
  harness: boolean
}

export interface ChatMcpStatusResult {
  servers: ChatMcpServer[]
}

/** What signing in to a server asks of the person: open `authUrl` in a browser. */
export interface ChatMcpAuthStart {
  /** null when the server was signed in already and nothing is asked. */
  authUrl: string | null
  /**
   * true when Claude Code waits for the browser to come back to it (a localhost redirect). If the
   * browser cannot reach it (the agent runs on another machine), the page it lands on can be pasted
   * back with chatMcpCallback. false for a claude.ai connector: sign in there, then reconnect.
   */
  callbackExpected: boolean
}

/** One usage-limit window of an account: a 5-hour session, a week, a model's week. */
export interface UsageLimitWindow {
  /** session or weekly; weekly_scoped for one model's week (see label). */
  id: string
  /** What a scoped window counts (a model's name, Fable), when it is not the whole account's. */
  label?: string
  /** Percent of the window used, 0–100; null when the provider gave none. */
  usedPercent: number | null
  /** When the window resets (epoch ms), if known. */
  resetsAt: number | null
}

export interface ProviderUsageLimits {
  provider: 'claude' | 'codex'
  /** pro, max, team, plus… when the provider says. */
  plan: string | null
  /** ok: windows are filled; unavailable: no plan limits apply (an API key) or no account; error: reading failed. */
  status: 'ok' | 'unavailable' | 'error'
  error?: string
  windows: UsageLimitWindow[]
  /** When this was read (epoch ms). */
  updatedAt: number
}

export interface UsageLimitsResult {
  providers: ProviderUsageLimits[]
}

export interface FaviconResult {
  /** The icon as a `data:image/...` URL; null when the domain has none or cannot be reached. */
  dataUrl: string | null
}

export const CHAT_STATUS_METHODS = {
  /** A Claude chat's MCP servers and their state. */
  chatMcpStatus: '_harness/chatStatus/mcp',
  /** Reconnects one server, then answers the servers' state. */
  chatMcpReconnect: '_harness/chatStatus/mcpReconnect',
  /** Turns one server on or off for the chat's agent, then answers the servers' state. */
  chatMcpToggle: '_harness/chatStatus/mcpToggle',
  /** Starts signing in to a server that needs it (OAuth): the URL to open. */
  chatMcpAuthenticate: '_harness/chatStatus/mcpAuthenticate',
  /** The address the browser landed on after signing in, when it could not reach Claude Code itself. */
  chatMcpCallback: '_harness/chatStatus/mcpCallback',
  /** The host's accounts' usage limits; `refresh` reads them again rather than answering what was read lately. */
  usageLimits: '_harness/chatStatus/usageLimits',
  /** A public domain's site icon as a `data:` URL, fetched and cached by the daemon (null when it has none). */
  favicon: '_harness/favicon'
} as const

export interface ChatStatusRequests {
  [CHAT_STATUS_METHODS.chatMcpStatus]: { params: { sessionId: string }; result: ChatMcpStatusResult }
  [CHAT_STATUS_METHODS.chatMcpReconnect]: { params: { sessionId: string; server: string }; result: ChatMcpStatusResult }
  [CHAT_STATUS_METHODS.chatMcpToggle]: {
    params: { sessionId: string; server: string; enabled: boolean }
    result: ChatMcpStatusResult
  }
  [CHAT_STATUS_METHODS.chatMcpAuthenticate]: { params: { sessionId: string; server: string }; result: ChatMcpAuthStart }
  [CHAT_STATUS_METHODS.chatMcpCallback]: {
    params: { sessionId: string; server: string; callbackUrl: string }
    result: ChatMcpStatusResult
  }
  [CHAT_STATUS_METHODS.usageLimits]: { params: { refresh?: boolean; sessionId?: string }; result: UsageLimitsResult }
  [CHAT_STATUS_METHODS.favicon]: { params: { domain: string }; result: FaviconResult }
}
