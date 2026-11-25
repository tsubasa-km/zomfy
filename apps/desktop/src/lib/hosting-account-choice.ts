import type { HostingAccount, HostingAccountRef, HostingRemoteInfo } from '@zomfy/protocol'

// Which of a host's accounts fit a remote, and the Select's value for each (docs/specs/project-hosting-accounts.md).
// Pure, for tests; lib/hosting-accounts loads the accounts.

/** The Select's value for "the CLI's active account". */
export const ACTIVE_ACCOUNT = '__active__'
/** The Select's value for "Add account…". */
export const ADD_ACCOUNT = '__add__'

export function accountValue(ref: HostingAccountRef): string {
  return `${ref.provider}|${ref.host}|${ref.login}`
}

export function accountFromValue(value: string): HostingAccountRef | null {
  const [provider, host, login] = value.split('|')
  return (provider === 'github' || provider === 'gitlab') && host && login ? { provider, host, login } : null
}

export function sameAccount(a: HostingAccountRef | null | undefined, b: HostingAccountRef | null | undefined): boolean {
  return !!a && !!b && a.provider === b.provider && a.host.toLowerCase() === b.host.toLowerCase() && a.login === b.login
}

/** The accounts that can act on the remote: its provider and host, the CLI's active one first. */
export function accountsForRemote(accounts: HostingAccount[], remote: Pick<HostingRemoteInfo, 'provider' | 'host'> | null): HostingAccount[] {
  if (!remote) return []
  return accounts
    .filter((a) => a.provider === remote.provider && a.host.toLowerCase() === remote.host.toLowerCase())
    .sort((a, b) => Number(b.active) - Number(a.active))
}

/** The login the CLI acts as on the remote's host today, if any. */
export function activeLogin(accounts: HostingAccount[]): string | null {
  return accounts.find((a) => a.active && a.source !== 'zomfy')?.login ?? null
}

/**
 * Whether the dialog has a question to ask: only when the host holds more than one account for the
 * remote. With one, the field reads as a plain line (docs/specs/add-project-dialog.md).
 */
export function accountChoiceNeeded(forRemote: HostingAccount[]): boolean {
  return forRemote.length > 1
}

/** Where GitLab makes a personal access token with the scopes Zomfy needs. */
export function gitlabTokenPage(host: string): string {
  return `https://${host}/-/user_settings/personal_access_tokens?name=Zomfy&scopes=api,read_repository,write_repository`
}

/** github.com/gitlab.com by name, for a URL typed before the daemon has answered. */
export function guessProvider(hostOrUrl: string): HostingRemoteInfo['provider'] | null {
  const h = hostOrUrl.toLowerCase()
  if (h.includes('github')) return 'github'
  if (h.includes('gitlab')) return 'gitlab'
  return null
}
