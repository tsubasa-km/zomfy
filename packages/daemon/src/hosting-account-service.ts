import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostingAccount, HostingAccountRef, Project } from '@zomfy/protocol'
import { git } from './git-cli.ts'
import {
  accountForRemote,
  credentialHelper,
  credentialHelperKey,
  hostingEnv,
  isHttpRemote,
  parseGhAuthStatusJson,
  parseGhAuthStatusText,
  parseGlabAuthStatusJson,
  parseGlabAuthStatusText,
  sameAccount,
  validAccount,
  withoutZomfyHelper,
  withZomfyHelper
} from './hosting-accounts.ts'
import { TtlCache } from './hosting-cache.ts'
import { runHostingCliOutput, type HostingCliOutput, type HostingTool } from './hosting-cli.ts'
import { resolveHostingRemote } from './hosting-remote.ts'
import { HostingTokenStore } from './hosting-token-store.ts'
import { HARNESS_HOME } from './harness-home.ts'
import { log } from './log.ts'

// Lists the host's accounts, hands out an account's token for one CLI call or agent, and keeps a
// project's git credential helper in step with its account (docs/specs/project-hosting-accounts.md).

export interface AccountDeps {
  /** gh/glab with their output whatever the exit code; throws when the tool is missing. */
  run(tool: HostingTool, args: string[]): Promise<HostingCliOutput>
  store: HostingTokenStore
  /** The GitLab API's answer to `GET /api/v4/user` with the token. */
  fetchUser(host: string, token: string): Promise<{ username?: string }>
}

const defaultDeps = (): AccountDeps => ({
  run: (tool, args) => runHostingCliOutput(tool, homedir(), args, { timeoutMs: 15_000 }),
  store: new HostingTokenStore(join(HARNESS_HOME, 'hosting-accounts.json')),
  fetchUser: async (host, token) => {
    const response = await fetch(`https://${host}/api/v4/user`, { headers: { 'PRIVATE-TOKEN': token }, signal: AbortSignal.timeout(15_000) })
    if (response.status === 401 || response.status === 403) throw new Error(`${host} did not accept the token (HTTP ${response.status}). Check it and its scopes (api, read_repository, write_repository).`)
    if (!response.ok) throw new Error(`${host} answered HTTP ${response.status}`)
    return (await response.json()) as { username?: string }
  }
})

export class HostingAccounts {
  private readonly lists = new TtlCache<{ accounts: HostingAccount[]; cli: { gh: boolean; glab: boolean } }>(30_000)
  private readonly tokens = new TtlCache<string | null>(5 * 60_000)

  constructor(private readonly deps: AccountDeps) {}

  list(force = false): Promise<{ accounts: HostingAccount[]; cli: { gh: boolean; glab: boolean } }> {
    return this.lists.get('all', () => this.load(), force)
  }

  private async load(): Promise<{ accounts: HostingAccount[]; cli: { gh: boolean; glab: boolean } }> {
    const read = async (tool: HostingTool, json: string[], text: string[]) => {
      try {
        const out = await this.deps.run(tool, json)
        const parsed = tool === 'gh' ? parseGhAuthStatusJson(out.stdout) : parseGlabAuthStatusJson(out.stdout)
        if (parsed) return { found: true, accounts: parsed }
        // An older CLI without JSON output: read the text, which gh and glab print to stderr.
        const plain = await this.deps.run(tool, text)
        const all = `${plain.stdout}\n${plain.stderr}`
        return { found: true, accounts: tool === 'gh' ? parseGhAuthStatusText(all) : parseGlabAuthStatusText(all) }
      } catch {
        return { found: false, accounts: [] as HostingAccount[] }
      }
    }
    const [gh, glab, stored] = await Promise.all([
      read('gh', ['auth', 'status', '--json', 'hosts'], ['auth', 'status']),
      read('glab', ['auth', 'status', '--all', '--output', 'json'], ['auth', 'status', '--all']),
      this.deps.store.list()
    ])
    const held: HostingAccount[] = stored
      .filter((s) => !glab.accounts.some((a) => sameAccount(a, s)))
      .map((s) => ({ ...s, active: false, source: 'zomfy' as const }))
    return { accounts: [...gh.accounts, ...glab.accounts, ...held], cli: { gh: gh.found, glab: glab.found } }
  }

  /** Where the account's token comes from, from the latest list; 'zomfy' only for tokens Zomfy keeps. */
  private async sourceOf(account: HostingAccountRef): Promise<HostingAccount['source'] | null> {
    const found = (await this.list()).accounts.find((a) => sameAccount(a, account))
    return found?.source ?? null
  }

  /** The token to act as the account; null when its CLI's own login needs none (glab) or it is gone. */
  token(account: HostingAccountRef): Promise<string | null> {
    if (!validAccount(account)) return Promise.resolve(null)
    const key = `${account.provider}:${account.host}:${account.login}`
    return this.tokens.get(key, async () => {
      if (account.provider === 'github') {
        const out = await this.deps.run('gh', ['auth', 'token', '--hostname', account.host, '--user', account.login]).catch(() => null)
        const token = out?.code === 0 ? out.stdout.trim() : ''
        if (!token) log(`gh has no token for ${account.login} on ${account.host}; its active account is used`)
        return token || null
      }
      return this.deps.store.token(account)
    })
  }

  /** The variables that make gh/glab act as the account; empty for the CLI's active one. */
  async env(account: HostingAccountRef | null | undefined): Promise<Record<string, string>> {
    if (!account) return {}
    const token = await this.token(account)
    return token ? hostingEnv(account, token) : {}
  }

  /** A project's account when it matches the project's remote, else null (the active account). */
  async projectAccount(project: Pick<Project, 'path' | 'hostingAccount' | 'kind'> | null | undefined): Promise<HostingAccountRef | null> {
    if (!project?.hostingAccount || project.kind !== 'git') return null
    const { remote } = await resolveHostingRemote(project.path).catch(() => ({ remote: null }))
    return accountForRemote(project.hostingAccount, remote)
  }

  /** What a chat's agent in the project starts with. */
  async projectEnv(project: Pick<Project, 'path' | 'hostingAccount' | 'kind'> | null | undefined): Promise<Record<string, string>> {
    return this.env(await this.projectAccount(project))
  }

  async addGitlabToken(host: string, token: string): Promise<HostingAccount> {
    const cleanHost = host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    const cleanToken = token.trim()
    if (!cleanHost) throw new Error('Enter the GitLab host')
    if (!cleanToken) throw new Error('Paste a personal access token')
    const user = await this.deps.fetchUser(cleanHost, cleanToken)
    const login = user.username?.trim()
    if (!login) throw new Error(`${cleanHost} did not say whose token this is`)
    const ref: HostingAccountRef = { provider: 'gitlab', host: cleanHost, login }
    if (!validAccount(ref)) throw new Error(`${cleanHost} is not a host name Zomfy can use`)
    const storage = await this.deps.store.save(ref, cleanToken)
    this.lists.invalidate()
    this.tokens.invalidate(`gitlab:${cleanHost}:${login}`)
    return { ...ref, active: false, source: 'zomfy', storage }
  }

  async remove(account: HostingAccountRef): Promise<void> {
    if (!(await this.deps.store.remove(account))) throw new Error(`Zomfy holds no token for ${account.login} on ${account.host}; sign out with the CLI instead`)
    this.lists.invalidate()
    this.tokens.invalidate(`${account.provider}:${account.host}:${account.login}`)
  }

  /** The credential helper for the account as git config wants it, or null where none is needed. */
  async helperFor(account: HostingAccountRef): Promise<string | null> {
    const source = (await this.sourceOf(account)) ?? (account.provider === 'github' ? 'gh' : 'glab')
    return credentialHelper(account, source, account.provider === 'github' ? (Bun.which('gh') ?? 'gh') : 'gh')
  }

  /**
   * Keeps the repository's own credential helpers in step with its account: Zomfy's entry for the
   * previous account's host goes, the new account's goes in (HTTPS remotes or none yet; SSH is left alone).
   */
  async applyGitCredential(repo: string, previous: HostingAccountRef | null | undefined, next: HostingAccountRef | null | undefined): Promise<void> {
    if (previous && validAccount(previous) && !sameAccount(previous, next)) await rewriteHelpers(repo, previous.host, withoutZomfyHelper)
    if (!next || !validAccount(next)) return
    const url = await originUrl(repo)
    if (url && !isHttpRemote(url)) return
    const helper = await this.helperFor(next)
    if (!helper) {
      await rewriteHelpers(repo, next.host, withoutZomfyHelper)
      return
    }
    await rewriteHelpers(repo, next.host, (values) => withZomfyHelper(values, helper))
  }
}

async function originUrl(repo: string): Promise<string | null> {
  const names = (await git(repo, ['remote'], { quiet: true }).catch(() => '')).split('\n').filter(Boolean)
  const remote = names.includes('origin') ? 'origin' : names[0]
  if (!remote) return null
  return git(repo, ['remote', 'get-url', remote], { quiet: true }).catch(() => null)
}

/** Replaces the repository-local values of the host's helper key with `change(values)`; null leaves them. */
async function rewriteHelpers(repo: string, host: string, change: (values: string[]) => string[] | null): Promise<void> {
  const key = credentialHelperKey(host)
  const current = (await git(repo, ['config', '--local', '--get-all', key], { quiet: true }).catch(() => '')).split('\n')
  // `--get-all` prints nothing for an unset key; one empty value is the reset entry.
  const values = current.length === 1 && current[0] === '' ? await localValuesOrEmpty(repo, key) : current
  const next = change(values)
  if (!next) return
  await git(repo, ['config', '--local', '--unset-all', key], { quiet: true }).catch(() => undefined)
  for (const value of next) await git(repo, ['config', '--local', '--add', key, value])
}

/** Tells an unset key from one whose only value is the empty reset. */
async function localValuesOrEmpty(repo: string, key: string): Promise<string[]> {
  const listed = await git(repo, ['config', '--local', '--get-regexp', `^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`], { quiet: true }).catch(() => '')
  return listed ? [''] : []
}

let shared: HostingAccounts | null = null

/** The daemon's one account service. */
export function hostingAccounts(): HostingAccounts {
  shared ??= new HostingAccounts(defaultDeps())
  return shared
}
