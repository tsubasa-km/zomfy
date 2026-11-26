import type { HostingAccount, HostingAccountRef } from '@zomfy/protocol'

// The pure parts of per-project hosting accounts (docs/specs/project-hosting-accounts.md): reading
// what gh and glab report, the environment that makes a CLI act as an account, and the repo-local
// credential helper git asks for HTTPS pushes.

const LOGIN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const HOST = /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/i

/** A login and host safe to place in a shell snippet and a git config key. */
export function validAccount(account: HostingAccountRef): boolean {
  return (account.provider === 'github' || account.provider === 'gitlab') && LOGIN.test(account.login) && HOST.test(account.host)
}

export function sameAccount(a: HostingAccountRef | null | undefined, b: HostingAccountRef | null | undefined): boolean {
  return !!a && !!b && a.provider === b.provider && a.host.toLowerCase() === b.host.toLowerCase() && a.login === b.login
}

/** Only an account for the remote's own provider and host applies; another falls back to the CLI's active one. */
export function accountForRemote(
  account: HostingAccountRef | null | undefined,
  remote: { provider: string; host: string } | null | undefined
): HostingAccountRef | null {
  if (!account || !remote) return null
  return account.provider === remote.provider && account.host.toLowerCase() === remote.host.toLowerCase() ? account : null
}

/** github.com and GitHub Enterprise Cloud (`*.ghe.com`) take GH_TOKEN; a GitHub Enterprise Server takes GH_ENTERPRISE_TOKEN. */
function githubTokenHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'github.com' || h.endsWith('.ghe.com')
}

/** The variables that make gh or glab act as the account, as their docs name them. */
export function hostingEnv(account: HostingAccountRef, token: string): Record<string, string> {
  if (account.provider === 'gitlab') return { GITLAB_TOKEN: token, GITLAB_HOST: account.host }
  if (account.host.toLowerCase() === 'github.com') return { GH_TOKEN: token }
  if (githubTokenHost(account.host)) return { GH_HOST: account.host, GH_TOKEN: token }
  return { GH_HOST: account.host, GH_ENTERPRISE_TOKEN: token }
}

/** The variable names hostingEnv may set, cleared when a project's chat must not inherit the person's own. */
export const HOSTING_ENV_NAMES = ['GH_TOKEN', 'GH_HOST', 'GH_ENTERPRISE_TOKEN', 'GITLAB_TOKEN', 'GITLAB_HOST'] as const

// --- gh auth status ---------------------------------------------------------------------------

interface GhStatusEntry {
  state?: string
  active?: boolean
  host?: string
  login?: string
  error?: string
}

/** `gh auth status --json hosts`: every account per host, active or not. */
export function parseGhAuthStatusJson(text: string): HostingAccount[] | null {
  let parsed: { hosts?: Record<string, GhStatusEntry[]> }
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.hosts || typeof parsed.hosts !== 'object') return null
  const accounts: HostingAccount[] = []
  for (const [host, entries] of Object.entries(parsed.hosts)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry.login) continue
      accounts.push({
        provider: 'github',
        host: (entry.host ?? host).toLowerCase(),
        login: entry.login,
        active: entry.active === true,
        source: 'gh',
        ...(entry.state && entry.state !== 'success' ? { problem: entry.error?.trim() || `gh reports this account as ${entry.state}` } : {})
      })
    }
  }
  return accounts
}

/** gh's text output, for a gh without `--json` on `auth status` (older than 2.6x). */
export function parseGhAuthStatusText(text: string): HostingAccount[] {
  const accounts: HostingAccount[] = []
  let last: HostingAccount | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const ok = /Logged in to (\S+) (?:account|as) ([A-Za-z0-9._-]+)/.exec(line)
    const failed = /Failed to log in to (\S+) (?:account|using token) ([A-Za-z0-9._-]+)/.exec(line)
    const match = ok ?? failed
    if (match) {
      last = {
        provider: 'github',
        host: match[1]!.toLowerCase(),
        login: match[2]!,
        // Before multiple accounts, the one account was the active one; newer gh says so below.
        active: true,
        source: 'gh',
        ...(failed ? { problem: 'gh could not log in to this account' } : {})
      }
      accounts.push(last)
      continue
    }
    const active = /Active account: (true|false)/.exec(line)
    if (active && last) last.active = active[1] === 'true'
  }
  return accounts
}

// --- glab auth status -------------------------------------------------------------------------

interface GlabStatusEntry {
  host?: string
  state?: string
  user?: string
  error?: string
}

/** `glab auth status --all --output json`: glab's one account per host; hosts without a login are left out. */
export function parseGlabAuthStatusJson(text: string): HostingAccount[] | null {
  let parsed: { hosts?: GlabStatusEntry[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || !Array.isArray(parsed.hosts)) return null
  return parsed.hosts.flatMap((entry): HostingAccount[] =>
    entry.host && entry.user
      ? [
          {
            provider: 'gitlab',
            host: entry.host.toLowerCase(),
            login: entry.user,
            active: true,
            source: 'glab',
            ...(entry.state && entry.state !== 'success' ? { problem: entry.error?.trim() || `glab reports this account as ${entry.state}` } : {})
          }
        ]
      : []
  )
}

/** glab's text output: "✓ Logged in to <host> as <user> (<where>)". */
export function parseGlabAuthStatusText(text: string): HostingAccount[] {
  const accounts: HostingAccount[] = []
  for (const raw of text.split(/\r?\n/)) {
    const match = /Logged in to (\S+) as ([A-Za-z0-9._-]+)/.exec(raw)
    if (match) accounts.push({ provider: 'gitlab', host: match[1]!.toLowerCase(), login: match[2]!, active: true, source: 'glab' })
  }
  return accounts
}

// --- git credential helper --------------------------------------------------------------------

/** Names the shell function, so Zomfy finds and removes only its own entries. */
export const HELPER_MARK = 'zomfy_account'

/** `credential.https://<host>.helper`. */
export function credentialHelperKey(host: string): string {
  return `credential.https://${host.toLowerCase()}.helper`
}

function shellQuote(path: string): string {
  return path.includes("'") ? 'gh' : `'${path}'`
}

/**
 * The helper that answers git's `get` as the account: gh's own token for that login (it works in
 * any terminal), or a Zomfy-held GitLab token from GITLAB_TOKEN, which Zomfy's agents carry. null
 * for glab's own login, which git already authenticates as.
 */
export function credentialHelper(account: HostingAccountRef, source: HostingAccount['source'], ghPath = 'gh'): string | null {
  if (!validAccount(account)) return null
  if (account.provider === 'github') {
    const gh = shellQuote(ghPath)
    return `!${HELPER_MARK}() { test "$1" = get || exit 0; t=$(${gh} auth token --hostname ${account.host} --user ${account.login}) || exit 0; echo username=${account.login}; echo "password=$t"; }; ${HELPER_MARK}`
  }
  if (source === 'zomfy') {
    return `!${HELPER_MARK}() { test "$1" = get || exit 0; test -n "$GITLAB_TOKEN" || exit 0; echo username=oauth2; echo "password=$GITLAB_TOKEN"; }; ${HELPER_MARK}`
  }
  return null
}

/**
 * The helper list for the key once Zomfy's entries are gone: its helper and the empty reset just
 * before it. null when there was nothing of Zomfy's to remove.
 */
export function withoutZomfyHelper(values: string[]): string[] | null {
  const out: string[] = []
  let removed = false
  for (const value of values) {
    if (value.includes(HELPER_MARK)) {
      if (out.at(-1) === '') out.pop()
      removed = true
      continue
    }
    out.push(value)
  }
  return removed ? out : null
}

/** The key's values with Zomfy's helper (behind an empty reset that sets the global helpers aside for this URL). */
export function withZomfyHelper(values: string[], helper: string): string[] {
  const kept = [...(withoutZomfyHelper(values) ?? values)]
  // One reset entry before Zomfy's helper: blanks left at the end (by an earlier write) are folded into it.
  while (kept.at(-1) === '') kept.pop()
  return [...kept, '', helper]
}

/** Whether git talks to the remote over HTTP(S), where credential helpers apply; SSH keys decide the rest. */
export function isHttpRemote(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

// --- adding accounts --------------------------------------------------------------------------

/** The CLI's own login, run in a terminal on the host. */
export function loginArgv(provider: HostingAccountRef['provider'], host: string, executable: string): string[] {
  return provider === 'github' ? [executable, 'auth', 'login', '--hostname', host, '--web'] : [executable, 'auth', 'login', '--hostname', host]
}

/** `gh repo create` for a new local repository, published as the account. */
export function publishArgs(input: { owner: string; name: string; source: string; visibility: 'private' | 'public' }): string[] {
  return ['repo', 'create', `${input.owner}/${input.name}`, `--${input.visibility}`, '--source', input.source, '--remote', 'origin', '--push']
}
