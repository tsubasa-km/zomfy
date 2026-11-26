import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HostingAccountRef } from '@zomfy/protocol'
import { git } from './git-cli.ts'
import { HostingAccounts, type AccountDeps } from './hosting-account-service.ts'
import {
  HELPER_MARK,
  accountForRemote,
  credentialHelper,
  credentialHelperKey,
  hostingEnv,
  loginArgv,
  parseGhAuthStatusJson,
  parseGhAuthStatusText,
  parseGlabAuthStatusJson,
  parseGlabAuthStatusText,
  publishArgs,
  withZomfyHelper,
  withoutZomfyHelper
} from './hosting-accounts.ts'
import type { HostingCliOutput, HostingTool } from './hosting-cli.ts'
import { HostingTokenStore, type Keyring } from './hosting-token-store.ts'

// docs/specs/project-hosting-accounts.md. Every CLI here is a fake runner and every keyring a fake:
// nothing reads or changes the person's gh, glab, git credentials or OS credential store.

const temps: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zomfy-accounts-'))
  temps.push(dir)
  return dir
}
afterAll(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

const GH_JSON = JSON.stringify({
  hosts: {
    'github.com': [
      { state: 'success', active: true, host: 'github.com', login: 'work-me', tokenSource: 'keyring' },
      { state: 'success', active: false, host: 'github.com', login: 'home-me', tokenSource: 'keyring' }
    ],
    'ghe.corp': [{ state: 'error', active: true, host: 'ghe.corp', login: 'corp-me', error: 'The token in keyring is invalid.' }]
  }
})

const GH_TEXT = `github.com
  ✓ Logged in to github.com account work-me (keyring)
  - Active account: true
  - Token: gho_************************************

  ✓ Logged in to github.com account home-me (keyring)
  - Active account: false
ghe.corp
  X Failed to log in to ghe.corp account corp-me (keyring)
  - Active account: true
`

const GLAB_JSON = JSON.stringify({
  hosts: [
    { host: 'gitlab.com', state: 'error', error: 'GET https://gitlab.com/api/v4/user: 401', token_source: 'none' },
    { host: 'gitlab.corp.example', state: 'success', user: 'corp_me', token_source: 'keyring' }
  ]
})

describe('reading gh auth status', () => {
  test('JSON lists every account per host, active or not, with problems', () => {
    expect(parseGhAuthStatusJson(GH_JSON)).toEqual([
      { provider: 'github', host: 'github.com', login: 'work-me', active: true, source: 'gh' },
      { provider: 'github', host: 'github.com', login: 'home-me', active: false, source: 'gh' },
      { provider: 'github', host: 'ghe.corp', login: 'corp-me', active: true, source: 'gh', problem: 'The token in keyring is invalid.' }
    ])
  })

  test('a gh without --json prints usage, which is no JSON', () => {
    expect(parseGhAuthStatusJson('unknown flag: --json')).toBeNull()
  })

  test('the text output gives the same accounts', () => {
    const accounts = parseGhAuthStatusText(GH_TEXT)
    expect(accounts.map((a) => [a.host, a.login, a.active, !!a.problem])).toEqual([
      ['github.com', 'work-me', true, false],
      ['github.com', 'home-me', false, false],
      ['ghe.corp', 'corp-me', true, true]
    ])
  })

  test('the single-account text of older gh reads as active', () => {
    expect(parseGhAuthStatusText('github.com\n  ✓ Logged in to github.com as old-me (oauth_token)\n')).toEqual([
      { provider: 'github', host: 'github.com', login: 'old-me', active: true, source: 'gh' }
    ])
  })
})

describe('reading glab auth status', () => {
  test('JSON keeps hosts with a login and leaves out a host without a token', () => {
    expect(parseGlabAuthStatusJson(GLAB_JSON)).toEqual([
      { provider: 'gitlab', host: 'gitlab.corp.example', login: 'corp_me', active: true, source: 'glab' }
    ])
  })

  test('text output', () => {
    const text = 'gitlab.com\n  x gitlab.com: API call failed\ngitlab.corp.example\n  ✓ Logged in to gitlab.corp.example as corp_me (keyring)\n'
    expect(parseGlabAuthStatusText(text)).toEqual([{ provider: 'gitlab', host: 'gitlab.corp.example', login: 'corp_me', active: true, source: 'glab' }])
  })
})

describe('the environment that makes a CLI act as the account', () => {
  test('github.com takes GH_TOKEN alone', () => {
    expect(hostingEnv({ provider: 'github', host: 'github.com', login: 'home-me' }, 't1')).toEqual({ GH_TOKEN: 't1' })
  })
  test('GitHub Enterprise Cloud takes GH_TOKEN with its host', () => {
    expect(hostingEnv({ provider: 'github', host: 'acme.ghe.com', login: 'me' }, 't2')).toEqual({ GH_HOST: 'acme.ghe.com', GH_TOKEN: 't2' })
  })
  test('GitHub Enterprise Server takes GH_ENTERPRISE_TOKEN', () => {
    expect(hostingEnv({ provider: 'github', host: 'ghe.corp', login: 'me' }, 't3')).toEqual({ GH_HOST: 'ghe.corp', GH_ENTERPRISE_TOKEN: 't3' })
  })
  test('GitLab takes GITLAB_TOKEN and GITLAB_HOST', () => {
    expect(hostingEnv({ provider: 'gitlab', host: 'gitlab.com', login: 'me' }, 't4')).toEqual({ GITLAB_TOKEN: 't4', GITLAB_HOST: 'gitlab.com' })
  })
  test('only an account for the remote’s provider and host applies', () => {
    const account: HostingAccountRef = { provider: 'github', host: 'github.com', login: 'home-me' }
    expect(accountForRemote(account, { provider: 'github', host: 'GitHub.com' })).toEqual(account)
    expect(accountForRemote(account, { provider: 'gitlab', host: 'github.com' })).toBeNull()
    expect(accountForRemote(account, { provider: 'github', host: 'ghe.corp' })).toBeNull()
    expect(accountForRemote(account, null)).toBeNull()
    expect(accountForRemote(undefined, { provider: 'github', host: 'github.com' })).toBeNull()
  })
})

describe('the git credential helper', () => {
  const home: HostingAccountRef = { provider: 'github', host: 'github.com', login: 'home-me' }

  test('GitHub asks gh for that login’s token', () => {
    const helper = credentialHelper(home, 'gh', 'C:\\Program Files\\GitHub CLI\\gh.exe')!
    expect(helper.startsWith(`!${HELPER_MARK}()`)).toBe(true)
    expect(helper).toContain("'C:\\Program Files\\GitHub CLI\\gh.exe' auth token --hostname github.com --user home-me")
    expect(helper).toContain('echo username=home-me')
  })

  test('a Zomfy-held GitLab token comes from GITLAB_TOKEN; glab’s own login needs none', () => {
    const lab: HostingAccountRef = { provider: 'gitlab', host: 'gitlab.com', login: 'me2' }
    expect(credentialHelper(lab, 'zomfy')).toContain('password=$GITLAB_TOKEN')
    expect(credentialHelper(lab, 'glab')).toBeNull()
  })

  test('a login or host that could break out of the snippet gets no helper', () => {
    expect(credentialHelper({ ...home, login: 'x; rm -rf ~' }, 'gh')).toBeNull()
    expect(credentialHelper({ ...home, host: 'github.com $(id)' }, 'gh')).toBeNull()
  })

  test('adding puts an empty reset before Zomfy’s helper; removing takes both back out', () => {
    const helper = credentialHelper(home, 'gh')!
    expect(withZomfyHelper([], helper)).toEqual(['', helper])
    expect(withZomfyHelper(['store', '', helper], helper)).toEqual(['store', '', helper])
    // A second reset left by an earlier write folds into the one before the helper.
    expect(withZomfyHelper(['', '', helper], helper)).toEqual(['', helper])
    expect(withZomfyHelper([''], helper)).toEqual(['', helper])
    expect(withoutZomfyHelper(['store', '', helper])).toEqual(['store'])
    expect(withoutZomfyHelper(['store'])).toBeNull()
    expect(credentialHelperKey('GitHub.com')).toBe('credential.https://github.com.helper')
  })

  test('the repository’s own config gains and loses exactly Zomfy’s entries', async () => {
    const repo = await tempDir()
    await git(repo, ['init', '-q'])
    await git(repo, ['remote', 'add', 'origin', 'https://github.com/home-me/r.git'])
    const accounts = new HostingAccounts(fakeDeps(await tempDir()).deps)
    const key = credentialHelperKey('github.com')
    const values = async () => (await git(repo, ['config', '--local', '--get-all', key], { quiet: true }).catch(() => null))?.split('\n') ?? []

    await accounts.applyGitCredential(repo, null, home)
    const set = await values()
    expect(set).toHaveLength(2)
    expect(set[0]).toBe('')
    expect(set[1]).toContain('--user home-me')

    // Picking another account replaces the entry rather than stacking a second one.
    await accounts.applyGitCredential(repo, home, { ...home, login: 'work-me' })
    const swapped = await values()
    expect(swapped).toHaveLength(2)
    expect(swapped[1]).toContain('--user work-me')

    await accounts.applyGitCredential(repo, { ...home, login: 'work-me' }, null)
    expect(await values()).toEqual([])
  })

  test('an SSH remote is left alone', async () => {
    const repo = await tempDir()
    await git(repo, ['init', '-q'])
    await git(repo, ['remote', 'add', 'origin', 'git@github.com:home-me/r.git'])
    await new HostingAccounts(fakeDeps(await tempDir()).deps).applyGitCredential(repo, null, home)
    expect(await git(repo, ['config', '--local', '--get-all', credentialHelperKey('github.com')], { quiet: true }).catch(() => 'unset')).toBe('unset')
  })
})

describe('commands', () => {
  test('login runs the CLI’s own web login for the host', () => {
    expect(loginArgv('github', 'github.com', 'gh')).toEqual(['gh', 'auth', 'login', '--hostname', 'github.com', '--web'])
    expect(loginArgv('gitlab', 'gitlab.corp.example', 'glab')).toEqual(['glab', 'auth', 'login', '--hostname', 'gitlab.corp.example'])
  })
  test('publishing creates the repository from the folder and pushes it', () => {
    expect(publishArgs({ owner: 'home-me', name: 'new-thing', source: '/p/new-thing', visibility: 'private' })).toEqual([
      'repo', 'create', 'home-me/new-thing', '--private', '--source', '/p/new-thing', '--remote', 'origin', '--push'
    ])
  })
})

function memoryKeyring(failing = false): Keyring & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => {
      if (failing) throw new Error('no secret service')
      values.set(name, value)
    },
    delete: async (name) => void values.delete(name)
  }
}

function fakeDeps(dir: string, keyring = memoryKeyring()) {
  const calls: { tool: HostingTool; args: string[] }[] = []
  const deps: AccountDeps = {
    run: async (tool, args): Promise<HostingCliOutput> => {
      calls.push({ tool, args })
      if (tool === 'gh' && args[1] === 'status') return { stdout: GH_JSON, stderr: '', code: 1 }
      if (tool === 'gh' && args[1] === 'token') return { stdout: `token-of-${args.at(-1)}\n`, stderr: '', code: 0 }
      if (tool === 'glab' && args[1] === 'status') return { stdout: GLAB_JSON, stderr: '', code: 1 }
      throw new Error('unexpected')
    },
    store: new HostingTokenStore(join(dir, 'hosting-accounts.json'), keyring),
    fetchUser: async (_host, token) => (token === 'glpat-good' ? { username: 'second_me' } : Promise.reject(new Error('gitlab.corp.example did not accept the token (HTTP 401).')))
  }
  return { deps, calls, keyring }
}

describe('the account service', () => {
  test('lists gh’s and glab’s accounts and the tokens Zomfy holds', async () => {
    const { deps } = fakeDeps(await tempDir())
    const accounts = new HostingAccounts(deps)
    await accounts.addGitlabToken('https://gitlab.corp.example/', 'glpat-good')
    const { accounts: list, cli } = await accounts.list(true)
    expect(cli).toEqual({ gh: true, glab: true })
    expect(list.map((a) => `${a.source}:${a.host}:${a.login}:${a.active}`)).toEqual([
      'gh:github.com:work-me:true',
      'gh:github.com:home-me:false',
      'gh:ghe.corp:corp-me:true',
      'glab:gitlab.corp.example:corp_me:true',
      'zomfy:gitlab.corp.example:second_me:false'
    ])
  })

  test('a missing CLI lists nothing for its provider', async () => {
    const { deps } = fakeDeps(await tempDir())
    const accounts = new HostingAccounts({ ...deps, run: async () => Promise.reject(new Error('ENOENT')) })
    expect(await accounts.list(true)).toEqual({ accounts: [], cli: { gh: false, glab: false } })
  })

  test('an inactive GitHub account’s calls carry its own token, asked of gh by login', async () => {
    const { deps, calls } = fakeDeps(await tempDir())
    const env = await new HostingAccounts(deps).env({ provider: 'github', host: 'github.com', login: 'home-me' })
    expect(env).toEqual({ GH_TOKEN: 'token-of-home-me' })
    expect(calls.at(-1)).toEqual({ tool: 'gh', args: ['auth', 'token', '--hostname', 'github.com', '--user', 'home-me'] })
  })

  test('a Zomfy-held GitLab token goes to the keyring, not the file', async () => {
    const dir = await tempDir()
    const { deps, keyring } = fakeDeps(dir)
    const accounts = new HostingAccounts(deps)
    const added = await accounts.addGitlabToken('gitlab.corp.example', 'glpat-good')
    expect(added).toEqual({ provider: 'gitlab', host: 'gitlab.corp.example', login: 'second_me', active: false, source: 'zomfy', storage: 'keyring' })
    expect([...keyring.values.values()]).toEqual(['glpat-good'])
    expect(await readFile(join(dir, 'hosting-accounts.json'), 'utf8')).not.toContain('glpat-good')
    expect(await accounts.env(added)).toEqual({ GITLAB_TOKEN: 'glpat-good', GITLAB_HOST: 'gitlab.corp.example' })
    await accounts.remove(added)
    expect(keyring.values.size).toBe(0)
    expect(await accounts.env(added)).toEqual({})
  })

  test('without a credential store the token stays in the owner-only file', async () => {
    const dir = await tempDir()
    const { deps } = fakeDeps(dir, memoryKeyring(true))
    const added = await new HostingAccounts(deps).addGitlabToken('gitlab.corp.example', 'glpat-good')
    expect(added.storage).toBe('file')
    expect(await deps.store.token(added)).toBe('glpat-good')
  })

  test('a rejected token is not kept', async () => {
    const dir = await tempDir()
    const { deps } = fakeDeps(dir)
    await expect(new HostingAccounts(deps).addGitlabToken('gitlab.corp.example', 'glpat-bad')).rejects.toThrow('did not accept')
    expect(await deps.store.list()).toEqual([])
  })
})
