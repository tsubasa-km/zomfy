// Saved SSH connections, as RLogin keeps them: a list of servers the person logs in to, each opening
// as a terminal tab that runs the host's own `ssh`, so keys, ssh-agent and ProxyJump from the
// person's setup all apply. Unlike an SSH host (hosts.ts), nothing of the harness runs on the
// server: the tab is a plain login shell there.

/** How careful to be on the server: shown on its tabs, and told to agents that read them. */
export type SshConnectionTag = 'production' | 'staging' | 'development'

export const SSH_CONNECTION_TAGS: readonly SshConnectionTag[] = ['production', 'staging', 'development']

export interface SshConnection {
  id: string
  /** What the list and the tab call it. */
  name: string
  /** A host name, an address, or an alias from ~/.ssh/config (which then supplies the rest). */
  host: string
  port: number | null
  user: string | null
  /** A private key file (`ssh -i`). */
  identityFile: string | null
  /** Jump hosts (`ssh -J`), comma-separated. */
  proxyJump: string | null
  /** A folder in the list; null for none. */
  group: string | null
  tag: SshConnectionTag | null
  createdAt: number
}

export type SshConnectionInput = Omit<SshConnection, 'id' | 'createdAt'>

/** What a terminal tab opened from a saved connection carries (TerminalInfo.connection). */
export interface TerminalConnection {
  id: string
  name: string
  tag: SshConnectionTag | null
}

export const SSH_CONNECTION_METHODS = {
  sshConnectionsList: '_harness/sshConnections/list',
  sshConnectionSave: '_harness/sshConnections/save',
  sshConnectionDelete: '_harness/sshConnections/delete',
  sshConnectionOpen: '_harness/sshConnections/open'
} as const

export interface SshConnectionRequests {
  [SSH_CONNECTION_METHODS.sshConnectionsList]: { params: Record<string, never>; result: SshConnection[] }
  /** Without `id` it adds a connection; with one it replaces that connection's fields. */
  [SSH_CONNECTION_METHODS.sshConnectionSave]: { params: { id?: string; connection: SshConnectionInput }; result: SshConnection[] }
  [SSH_CONNECTION_METHODS.sshConnectionDelete]: { params: { id: string }; result: SshConnection[] }
  /** Opens a terminal tab in the workspace that logs in to the connection. */
  [SSH_CONNECTION_METHODS.sshConnectionOpen]: {
    params: { id: string; workspaceId: string; cols: number; rows: number }
    result: import('./terminals').TerminalInfo
  }
}

/** Shape check for a host field; ssh itself reports a host it cannot reach. */
export function sshConnectionHostError(host: string): string | null {
  const value = host.trim()
  if (!value) return 'Enter a host name, address or ~/.ssh/config alias'
  if (value.startsWith('-') || /[\s"'`$;&|<>(),\\%^!]/.test(value)) return 'Not a valid host'
  return null
}
