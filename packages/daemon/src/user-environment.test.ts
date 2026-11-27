import { describe, expect, test } from 'bun:test'
import {
  changedNames,
  expandWindowsValue,
  LiveEnvironment,
  mergeEnvironment,
  parseEnvSnapshot,
  parseRegExport,
  windowsPersonEnvironment,
  type Environment
} from './user-environment.ts'

// Fake readers only: nothing here reads or changes the person's registry or shell environment.

/** A REG_EXPAND_SZ value as `reg export` writes it: UTF-16LE hex bytes, wrapped. */
function hex2(value: string): string {
  const bytes = [...Buffer.from(`${value}\0`, 'utf16le')].map((b) => b.toString(16).padStart(2, '0'))
  const rows: string[] = []
  for (let i = 0; i < bytes.length; i += 20) rows.push(bytes.slice(i, i + 20).join(','))
  return `hex(2):${rows.join(',\\\r\n  ')}`
}

describe('parseRegExport', () => {
  test('reads REG_SZ and wrapped REG_EXPAND_SZ values, skipping other types', () => {
    const text = [
      'Windows Registry Editor Version 5.00',
      '',
      '[HKEY_CURRENT_USER\\Environment]',
      '"OneDrive"="C:\\\\Users\\\\ユーザー\\\\OneDrive"',
      `"Path"=${hex2('%USERPROFILE%\\bin;C:\\tools')}`,
      '"Quoted"="say \\"hi\\""',
      '"Empty"=""',
      '"Count"=dword:00000001',
      ''
    ].join('\r\n')
    expect(parseRegExport(`\uFEFF${text}`)).toEqual([
      { name: 'OneDrive', value: 'C:\\Users\\ユーザー\\OneDrive', expand: false },
      { name: 'Path', value: '%USERPROFILE%\\bin;C:\\tools', expand: true },
      { name: 'Quoted', value: 'say "hi"', expand: false },
      { name: 'Empty', value: '', expand: false }
    ])
  })
})

describe('windowsPersonEnvironment', () => {
  test('expands references, puts user over machine, and joins PATH machine then user', () => {
    const machine = [
      { name: 'Path', value: '%SystemRoot%\\system32;C:\\Program Files\\Git\\cmd', expand: true },
      { name: 'TOOLS', value: 'C:\\tools', expand: false },
      { name: 'SHARED', value: 'machine', expand: false }
    ]
    const user = [
      { name: 'PATH', value: '%USERPROFILE%\\bin;%tools%\\bin', expand: true },
      { name: 'shared', value: 'user', expand: false },
      { name: 'TEMP', value: '%USERPROFILE%\\AppData\\Local\\Temp', expand: true },
      { name: 'NOPE', value: '%UNKNOWN%\\x', expand: true }
    ]
    const env = windowsPersonEnvironment(machine, user, { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\me' })
    expect(env.PATH).toBe('C:\\Windows\\system32;C:\\Program Files\\Git\\cmd;C:\\Users\\me\\bin;C:\\tools\\bin')
    expect(env.SHARED).toBe('user')
    expect(env.TEMP).toBe('C:\\Users\\me\\AppData\\Local\\Temp')
    expect(env.NOPE).toBe('%UNKNOWN%\\x')
  })

  test('expandWindowsValue compares names case-insensitively through the lookup', () => {
    const lookup = (name: string) => ({ HOME: 'H' } as Record<string, string>)[name.toUpperCase()]
    expect(expandWindowsValue('%home%\\a;%Missing%', lookup)).toBe('H\\a;%Missing%')
  })
})

describe('mergeEnvironment', () => {
  const launch = { Path: 'C:\\bun;C:\\Windows;C:\\old', FOO: 'from-registry', ZOMFY_PORT: '7900', GONE: 'was-set' }
  const atStart: Environment = { PATH: 'C:\\Windows;C:\\old', FOO: 'from-registry', GONE: 'was-set' }

  test('takes new values, drops removed ones, keeps launcher-only ones, and merges PATH', () => {
    const now: Environment = { PATH: 'C:\\Windows;C:\\new', FOO: 'changed', BAR: 'added' }
    const env = mergeEnvironment(launch, atStart, now, 'win32')
    expect(env).toEqual({ FOO: 'changed', ZOMFY_PORT: '7900', BAR: 'added', PATH: 'C:\\bun;C:\\Windows;C:\\new' })
  })

  test('keeps a removed variable the launcher had set to another value', () => {
    const env = mergeEnvironment({ ...launch, GONE: 'launcher' }, atStart, { PATH: atStart.PATH! }, 'win32')
    expect(env.GONE).toBe('launcher')
    expect(env.FOO).toBeUndefined()
  })

  test('is case-sensitive and colon-separated on posix', () => {
    const env = mergeEnvironment({ PATH: '/usr/bin', foo: 'a' }, { PATH: '/usr/bin' }, { PATH: '/usr/bin:/home/me/.local/bin', FOO: 'b' }, 'linux')
    expect(env).toEqual({ foo: 'a', FOO: 'b', PATH: '/usr/bin:/home/me/.local/bin' })
  })

  test('changedNames lists names, never values', () => {
    expect(changedNames({ A: '1', B: '2' }, { A: '1', B: '3', C: '4' }, 'linux')).toEqual(['B', 'C'])
    expect(changedNames({ Path: 'x' }, { PATH: 'x' }, 'win32')).toEqual([])
  })
})

describe('parseEnvSnapshot', () => {
  test('reads env -0 between markers and drops shell bookkeeping', () => {
    const output = `banner\n__MK__\nPATH=/usr/bin:/bin\0MULTI=a\nb\0PWD=/home\0SHLVL=2\0TERM_PROGRAM=x\0_=/usr/bin/env\0EMPTY=\0__MK__`
    expect(parseEnvSnapshot(output, '__MK__')).toEqual({ PATH: '/usr/bin:/bin', MULTI: 'a\nb', EMPTY: '' })
  })
})

describe('LiveEnvironment', () => {
  function fake(policy: 'fresh' | 'cached') {
    let clock = 0
    let person: Environment = { PATH: '/a', FOO: '1' }
    let reads = 0
    const live = new LiveEnvironment({
      launch: { PATH: '/a', FOO: '1' },
      platform: 'linux',
      policy,
      ttlMs: 2_000,
      staleMs: 60_000,
      now: () => clock,
      read: async () => {
        reads++
        return { ...person }
      }
    })
    return {
      live,
      set: (env: Environment) => (person = env),
      tick: (ms: number) => (clock += ms),
      reads: () => reads
    }
  }

  test('fresh: re-reads once the snapshot is older than the TTL, and shares concurrent reads', async () => {
    const f = fake('fresh')
    await Promise.all([f.live.current(), f.live.current()])
    expect(f.reads()).toBe(1)
    f.set({ PATH: '/a:/b', FOO: '2' })
    expect((await f.live.current()).FOO).toBe('1')
    f.tick(2_000)
    expect(await f.live.current()).toEqual({ FOO: '2', PATH: '/a:/b' })
    expect(f.reads()).toBe(2)
  })

  test('cached: serves the snapshot and refreshes it in the background once stale', async () => {
    const f = fake('cached')
    await f.live.current()
    f.set({ PATH: '/a', FOO: '2' })
    f.tick(60_000)
    expect((await f.live.current()).FOO).toBe('1')
    await Bun.sleep(0)
    expect((await f.live.current()).FOO).toBe('2')
  })

  test('reload reads now and says which names changed', async () => {
    const f = fake('cached')
    await f.live.current()
    f.set({ PATH: '/a', FOO: '1', NEW: 'x' })
    expect(await f.live.reload()).toEqual(['NEW'])
    expect((await f.live.current()).NEW).toBe('x')
    expect(await f.live.reload()).toEqual([])
  })

  test('a failed read keeps the last snapshot', async () => {
    let fail = false
    const live = new LiveEnvironment({
      launch: { PATH: '/a' },
      platform: 'linux',
      policy: 'fresh',
      ttlMs: 0,
      read: async () => {
        if (fail) throw new Error('no shell')
        return { PATH: '/a', FOO: 'ok' }
      }
    })
    expect((await live.current()).FOO).toBe('ok')
    fail = true
    expect((await live.current()).FOO).toBe('ok')
  })
})
