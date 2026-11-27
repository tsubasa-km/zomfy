import type { ChatAgentId } from './chat-agents'

// Secrets agents can use but not see (docs/specs/agent-secrets.md), and reloading the person's
// environment for new processes (docs/specs/live-environment.md). Values go to the daemon once and
// never come back: SecretInfo has no value field.

/** `tunnel`: the agent gets a placeholder and a base URL into the daemon, which adds the real value
 *  on the way to `upstream`. `env`: the agent's processes get the real value. */
export type SecretExposure = 'tunnel' | 'env'

export interface SecretInfo {
  id: string
  /** The environment variable the agent gets (`XAI_API_KEY`). */
  name: string
  exposure: SecretExposure
  /** Tunnel only: where requests through the tunnel go (`https://api.x.ai/v1`). */
  upstream: string | null
  /** Tunnel only: the variable that carries the tunnel's address (`XAI_BASE_URL`). */
  baseUrlVariable: string | null
  /** The agents that get it; empty is all. */
  agents: ChatAgentId[]
  /** The projects whose chats get it; empty is every chat. */
  projectIds: string[]
  /** Where the value is kept: the OS credential store, or the owner-only file on a host without one. */
  storage: 'keyring' | 'file'
  updatedAt: string
}

export interface SecretSaveParams {
  /** Absent for a new secret. */
  id?: string
  name: string
  /** Required for a new secret; absent keeps the saved value. */
  value?: string
  exposure: SecretExposure
  upstream?: string | null
  baseUrlVariable?: string | null
  agents: ChatAgentId[]
  projectIds: string[]
}

/** What the agent sees in a tunnel secret's variable instead of its value. */
export const SECRET_PLACEHOLDER_PREFIX = 'zomfy-secret://'

export const secretPlaceholder = (name: string): string => `${SECRET_PLACEHOLDER_PREFIX}${name}`

export const SECRET_METHODS = {
  secretsList: '_harness/secrets/list',
  secretSave: '_harness/secrets/save',
  secretDelete: '_harness/secrets/delete',
  environmentReload: '_harness/environment/reload'
} as const

export interface SecretRequests {
  [SECRET_METHODS.secretsList]: { params: Record<string, never>; result: SecretInfo[] }
  [SECRET_METHODS.secretSave]: { params: SecretSaveParams; result: SecretInfo[] }
  [SECRET_METHODS.secretDelete]: { params: { id: string }; result: SecretInfo[] }
  /** Re-reads the person's environment for new processes; the names that changed, never values. */
  [SECRET_METHODS.environmentReload]: { params: Record<string, never>; result: { changed: string[] } }
}
