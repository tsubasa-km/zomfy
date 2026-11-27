import type { ChatAgentId } from './chat-agents'

// Secrets agents get as environment variables, redacted wherever Zomfy shows them
// (docs/specs/agent-secrets.md), and reloading the person's environment for new processes
// (docs/specs/live-environment.md). Values go to the daemon once and never come back: SecretInfo
// has no value field.

export interface SecretInfo {
  id: string
  /** The environment variable the agent gets, with the value in it (`XAI_API_KEY`). */
  name: string
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
  agents: ChatAgentId[]
  projectIds: string[]
}

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
