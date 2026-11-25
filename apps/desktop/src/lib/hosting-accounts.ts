import { useEffect, useState } from 'react'
import { HARNESS_METHODS, type HostingAccount, type HostingAccountRef } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, selectTerminal, setTerminals, useStore, type HostId } from '@/session-store'

// The desktop's side of per-project accounts (docs/specs/project-hosting-accounts.md): the accounts
// a host's daemon lists, which of them fit a remote, and the Select's value for each.

export interface HostAccounts {
  /** null while loading; 'unsupported' for a daemon that predates accounts. */
  accounts: HostingAccount[] | null
  unsupported: boolean
  cli: { gh: boolean; glab: boolean } | null
}

const cache = new Map<HostId, HostAccounts>()
const listeners = new Set<() => void>()

export async function loadHostAccounts(hostId: HostId, force = false): Promise<HostAccounts> {
  try {
    const { accounts, cli } = await harnessRequest(HARNESS_METHODS.hostingAccounts, force ? { force: true } : {}, hostId)
    cache.set(hostId, { accounts, cli, unsupported: false })
  } catch {
    // An older daemon refuses the method: no account field there.
    cache.set(hostId, { accounts: [], cli: null, unsupported: true })
  }
  for (const listener of listeners) listener()
  return cache.get(hostId)!
}

/** The host's accounts, loaded once per window and on `reload`. */
export function useHostAccounts(hostId: HostId | null, enabled = true): HostAccounts & { reload: () => Promise<void> } {
  const [, tick] = useState(0)
  useEffect(() => {
    const listener = () => tick((n) => n + 1)
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, [])
  const connected = useStore((s) => !!hostId && s.hosts[hostId]?.connection.kind === 'connected')
  useEffect(() => {
    if (hostId && enabled && connected && !cache.has(hostId)) void loadHostAccounts(hostId)
  }, [hostId, enabled, connected])
  const entry = hostId ? cache.get(hostId) : undefined
  return {
    accounts: entry?.accounts ?? null,
    unsupported: entry?.unsupported ?? false,
    cli: entry?.cli ?? null,
    reload: async () => {
      if (hostId) await loadHostAccounts(hostId, true)
    }
  }
}

/** A terminal tab on the host running the CLI's own login; returns its id. */
export async function openAccountLogin(hostId: HostId, provider: HostingAccountRef['provider'], host: string, workspaceId?: string): Promise<string> {
  const info = await harnessRequest(HARNESS_METHODS.hostingAccountLogin, { provider, host, ...(workspaceId ? { workspaceId } : {}) }, hostId)
  const others = getState().terminals.filter((t) => t.hostId === hostId && t.id !== info.id)
  setTerminals(hostId, [...others, info])
  selectTerminal(info.id)
  return info.id
}
