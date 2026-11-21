import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LEGACY_HOME_NAME, LEGACY_MOVED_MARKER, envVar, migrateLegacyHome, resolveHarnessHome } from './harness-home.ts'

// Every test works in a throwaway folder standing in for the user's home; never the real one.
let user: string
let legacy: string
let home: string
const dead = () => false

beforeEach(() => {
  user = mkdtempSync(join(tmpdir(), 'zomfy-home-test-'))
  legacy = join(user, LEGACY_HOME_NAME)
  home = join(user, '.zomfy')
})
afterEach(() => rmSync(user, { recursive: true, force: true }))

function seedLegacyHome() {
  mkdirSync(join(legacy, 'sessions'), { recursive: true })
  mkdirSync(join(legacy, 'workspaces', 'repo', 'wt'), { recursive: true })
  writeFileSync(join(legacy, 'sessions', 's1.json'), '{"id":"s1"}')
  writeFileSync(join(legacy, 'workspaces', 'repo', 'wt', 'file.txt'), 'work')
  writeFileSync(join(legacy, 'settings.json'), '{"a":1}')
  writeFileSync(join(legacy, 'connector-key'), 'secret')
  writeFileSync(join(legacy, 'daemon.json'), JSON.stringify({ url: 'ws://x', token: 't', pid: 999_999 }))
}

function expectEverythingIn(dir: string) {
  expect(readFileSync(join(dir, 'sessions', 's1.json'), 'utf8')).toBe('{"id":"s1"}')
  expect(readFileSync(join(dir, 'workspaces', 'repo', 'wt', 'file.txt'), 'utf8')).toBe('work')
  expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{"a":1}')
  expect(readFileSync(join(dir, 'connector-key'), 'utf8')).toBe('secret')
}

describe('migrateLegacyHome', () => {
  test('moves the legacy home and links the old path to the new one', () => {
    seedLegacyHome()
    expect(migrateLegacyHome(legacy, home, { isAlive: dead })).toBe('moved')
    expectEverythingIn(home)
    expect(lstatSync(home).isDirectory()).toBe(true)
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true)
    expect(realpathSync(legacy)).toBe(realpathSync(home))
    // Written through the old path, it lands in the one home.
    writeFileSync(join(legacy, 'later.txt'), 'x')
    expect(readFileSync(join(home, 'later.txt'), 'utf8')).toBe('x')
  })

  test('runs once: a second start finds the link and leaves it', () => {
    seedLegacyHome()
    migrateLegacyHome(legacy, home, { isAlive: dead })
    expect(migrateLegacyHome(legacy, home, { isAlive: dead })).toBe('none')
    expectEverythingIn(home)
  })

  test('never touches an existing new home', () => {
    seedLegacyHome()
    mkdirSync(home)
    writeFileSync(join(home, 'settings.json'), '{"new":true}')
    expect(migrateLegacyHome(legacy, home, { isAlive: dead })).toBe('none')
    expect(readFileSync(join(home, 'settings.json'), 'utf8')).toBe('{"new":true}')
    expectEverythingIn(legacy)
  })

  test('does nothing without a legacy home', () => {
    expect(migrateLegacyHome(legacy, home, { isAlive: dead })).toBe('none')
    expect(existsSync(home)).toBe(false)
  })

  test('keeps the legacy home while a daemon still runs from it', () => {
    seedLegacyHome()
    expect(migrateLegacyHome(legacy, home, { isAlive: (pid) => pid === 999_999 })).toBe('in-use')
    expect(existsSync(home)).toBe(false)
    expectEverythingIn(legacy)
  })

  test('copies and marks the legacy home when it cannot be renamed', () => {
    seedLegacyHome()
    // A rename into a folder whose parent does not exist yet fails; the copy creates parents.
    const nested = join(user, 'missing-parent', '.zomfy')
    expect(migrateLegacyHome(legacy, nested, { isAlive: dead, attempts: 1 })).toBe('copied')
    expectEverythingIn(nested)
    expectEverythingIn(legacy)
    expect(existsSync(join(nested, 'daemon.json'))).toBe(false)
    expect(existsSync(join(legacy, LEGACY_MOVED_MARKER))).toBe(true)
    expect(existsSync(`${nested}.migrating`)).toBe(false)
    rmSync(nested, { recursive: true })
    // Marked, it is not copied again even when the new home went missing.
    expect(migrateLegacyHome(legacy, nested, { isAlive: dead })).toBe('none')
  })
})

describe('resolveHarnessHome', () => {
  test('an explicit ZOMFY_HOME wins and nothing migrates', () => {
    seedLegacyHome()
    expect(resolveHarnessHome({ ZOMFY_HOME: '/x' }, user)).toBe('/x')
    expect(existsSync(home)).toBe(false)
  })

  test('the legacy ACP_HARNESS_HOME is still honoured', () => {
    expect(resolveHarnessHome({ ACP_HARNESS_HOME: '/old' }, user)).toBe('/old') // legacy
    expect(resolveHarnessHome({ ZOMFY_HOME: '/new', ACP_HARNESS_HOME: '/old' }, user)).toBe('/new') // legacy
  })

  test('migrates on start and returns the new home', () => {
    seedLegacyHome()
    expect(resolveHarnessHome({}, user, { isAlive: dead })).toBe(home)
    expectEverythingIn(home)
  })

  test('stays on the legacy home while its daemon runs', () => {
    seedLegacyHome()
    expect(resolveHarnessHome({}, user, { isAlive: () => true })).toBe(legacy)
  })

  test('under tests it never migrates', () => {
    seedLegacyHome()
    expect(resolveHarnessHome({ NODE_ENV: 'test' }, user)).toBe(legacy)
    expect(existsSync(home)).toBe(false)
  })
})

test('envVar prefers ZOMFY_ and falls back to the legacy name', () => {
  expect(envVar('ALLOWED_ORIGINS', { ZOMFY_ALLOWED_ORIGINS: 'a' })).toBe('a')
  expect(envVar('ALLOWED_ORIGINS', { ACP_HARNESS_ALLOWED_ORIGINS: 'b' })).toBe('b') // legacy
  expect(envVar('ALLOWED_ORIGINS', { ZOMFY_ALLOWED_ORIGINS: 'a', ACP_HARNESS_ALLOWED_ORIGINS: 'b' })).toBe('a') // legacy
  expect(envVar('ALLOWED_ORIGINS', {})).toBeUndefined()
})
