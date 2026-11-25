import { describe, expect, test } from 'bun:test'
import type { FolderInspection, HostingAccount } from '@zomfy/protocol'
import { folderStatus, hostPills, publishAccounts, showHostRow, tabForStep } from '../src/lib/add-project-form.ts'
import { accountChoiceNeeded, accountFromValue, accountsForRemote, accountValue, activeLogin, guessProvider } from '../src/lib/hosting-account-choice.ts'
import { joinHostPath, repoFolderName } from '../src/lib/project-target-path.ts'
import type { HostEntry } from '../src/session-store.ts'

// docs/specs/add-project-dialog.md and docs/specs/project-hosting-accounts.md.

const host = (id: string, label: string, kind: 'connected' | 'connecting' | 'offline' = 'connected'): HostEntry =>
  ({ id, label, connection: { kind }, harness: null, shells: [] }) as unknown as HostEntry

describe('the tab a request opens', () => {
  test('start opens Open folder; clone and create their own tabs', () => {
    expect(tabForStep('start')).toBe('open')
    expect(tabForStep('clone')).toBe('clone')
    expect(tabForStep('create')).toBe('create')
  })
})

describe('the host row', () => {
  test('one host: no row at all', () => {
    expect(showHostRow(hostPills({ local: host('local', 'Windows') }, []))).toBe(false)
  })

  test('this computer first, WSL distros not started yet listed offline', () => {
    const pills = hostPills({ 'ssh:box': host('ssh:box', 'box', 'offline'), local: host('local', 'Windows') }, ['Ubuntu'])
    expect(pills).toEqual([
      { id: 'local', label: '', state: 'connected' },
      { id: 'ssh:box', label: 'box', state: 'offline' },
      { id: 'wsl:Ubuntu', label: 'WSL', state: 'offline' }
    ])
    expect(showHostRow(pills)).toBe(true)
  })

  test('a running distro is not listed twice', () => {
    const pills = hostPills({ local: host('local', 'Windows'), 'wsl:Ubuntu': host('wsl:Ubuntu', 'WSL: Ubuntu', 'connecting') }, ['Ubuntu'])
    expect(pills.map((p) => [p.id, p.state])).toEqual([
      ['local', 'connected'],
      ['wsl:Ubuntu', 'connecting']
    ])
  })
})

describe('the line under Folder', () => {
  const inspection = (over: Partial<FolderInspection>): FolderInspection => ({ path: '/p', exists: true, kind: 'git', remote: null, hasRemote: false, ...over })

  test('nothing typed, or a daemon that cannot tell, says nothing', () => {
    expect(folderStatus('', undefined)).toBeNull()
    expect(folderStatus('/p', null)).toBeNull()
  })
  test('checking, missing, a plain folder', () => {
    expect(folderStatus('/p', undefined)).toEqual({ tone: 'muted', kind: 'checking' })
    expect(folderStatus('/p', inspection({ exists: false, kind: null }))).toEqual({ tone: 'error', kind: 'missing' })
    expect(folderStatus('/p', inspection({ kind: 'folder' }))).toEqual({ tone: 'warning', kind: 'folder' })
  })
  test('a repository names its GitHub or GitLab remote, or says it has another or none', () => {
    expect(folderStatus('/p', inspection({ remote: { provider: 'github', host: 'github.com', repo: 'o/r' }, hasRemote: true }))).toEqual({
      tone: 'muted',
      kind: 'git-remote',
      remote: 'github.com/o/r'
    })
    expect(folderStatus('/p', inspection({ hasRemote: true }))?.kind).toBe('git-other-remote')
    expect(folderStatus('/p', inspection({}))?.kind).toBe('git-no-remote')
  })
})

const account = (login: string, over: Partial<HostingAccount> = {}): HostingAccount => ({
  provider: 'github',
  host: 'github.com',
  login,
  active: false,
  source: 'gh',
  ...over
})

describe('the account field', () => {
  const accounts = [
    account('home-me'),
    account('work-me', { active: true }),
    account('corp-me', { host: 'ghe.corp', active: true }),
    account('lab-me', { provider: 'gitlab', host: 'gitlab.com', source: 'glab', active: true })
  ]

  test('only the remote’s provider and host, the active account first', () => {
    const forRemote = accountsForRemote(accounts, { provider: 'github', host: 'github.com' })
    expect(forRemote.map((a) => a.login)).toEqual(['work-me', 'home-me'])
    expect(activeLogin(forRemote)).toBe('work-me')
    expect(accountChoiceNeeded(forRemote)).toBe(true)
  })

  test('one account for the host is said, not asked', () => {
    const forRemote = accountsForRemote(accounts, { provider: 'gitlab', host: 'gitlab.com' })
    expect(accountChoiceNeeded(forRemote)).toBe(false)
    expect(accountsForRemote(accounts, null)).toEqual([])
  })

  test('a Zomfy-held token is never the CLI’s active account', () => {
    expect(activeLogin([account('held', { source: 'zomfy', active: true })])).toBeNull()
  })

  test('select values round-trip', () => {
    const ref = { provider: 'gitlab' as const, host: 'gitlab.corp.example', login: 'second_me' }
    expect(accountFromValue(accountValue(ref))).toEqual(ref)
    expect(accountFromValue('__active__')).toBeNull()
  })

  test('the provider is guessed from the URL until the host answers', () => {
    expect(guessProvider('https://github.com/o/r.git')).toBe('github')
    expect(guessProvider('git@gitlab.corp.example:g/p.git')).toBe('gitlab')
    expect(guessProvider('https://example.com/r.git')).toBeNull()
  })

  test('publishing offers GitHub accounts that work, github.com first', () => {
    const list = publishAccounts([...accounts, account('broken', { problem: 'expired' })])
    expect(list.map((a) => `${a.host}:${a.login}`)).toEqual(['github.com:work-me', 'github.com:home-me', 'ghe.corp:corp-me'])
    expect(publishAccounts(null)).toEqual([])
  })
})

describe('where it lands', () => {
  test('clone target from the URL and the host’s own separators', () => {
    expect(joinHostPath('C:\\Users\\me\\zomfy', repoFolderName('https://github.com/o/repo.git'))).toBe('C:\\Users\\me\\zomfy\\repo')
    expect(joinHostPath('/home/me/zomfy', repoFolderName('git@github.com:o/repo'))).toBe('/home/me/zomfy/repo')
  })
})
