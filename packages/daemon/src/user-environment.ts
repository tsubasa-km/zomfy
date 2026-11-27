import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log } from './log.ts'

// The environment new terminals and agent processes start with: the daemon's launch environment
// brought up to date with the person's current one, so `setx` or a profile edit applies without
// restarting Zomfy (docs/specs/live-environment.md). The daemon's own process.env is left alone.

export type Environment = Record<string, string>

const WINDOWS_KEYS = {
  machine: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  user: 'HKCU\\Environment'
} as const

/** Shell bookkeeping a login shell sets for itself, not the person's environment. */
const SHELL_OWN = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'TERM', 'COLUMNS', 'LINES', 'PS1', 'PS2'])
const isShellOwn = (name: string) => SHELL_OWN.has(name) || name.startsWith('TERM_PROGRAM') || name.startsWith('BASH_FUNC_')

const SNAPSHOT_TIMEOUT_MS = 10_000

export interface RegistryValue {
  name: string
  value: string
  expand: boolean
}

/** The string values of a `reg export` file (REG_SZ and REG_EXPAND_SZ); other types are skipped. */
export function parseRegExport(text: string): RegistryValue[] {
  const joined = text.replace(/^﻿/, '').replace(/\\\r?\n[ \t]*/g, '')
  const values: RegistryValue[] = []
  for (const line of joined.split(/\r?\n/)) {
    const match = /^"((?:[^"\\]|\\.)*)"=(.*)$/.exec(line.trim())
    if (!match) continue
    const name = unescapeReg(match[1]!)
    const raw = match[2]!
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      values.push({ name, value: unescapeReg(raw.slice(1, -1)), expand: false })
    } else if (raw.toLowerCase().startsWith('hex(2):')) {
      const bytes = raw
        .slice('hex(2):'.length)
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean)
        .map((b) => Number.parseInt(b, 16))
      const value = Buffer.from(bytes).toString('utf16le').replace(/\0+$/, '')
      values.push({ name, value, expand: true })
    }
  }
  return values
}

function unescapeReg(text: string): string {
  return text.replace(/\\(.)/g, '$1')
}

/** `%NAME%` replaced from `lookup`, names compared case-insensitively; unknown names stay as written. */
export function expandWindowsValue(value: string, lookup: (name: string) => string | undefined): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => lookup(name) ?? match)
}

/** A map that compares names as the platform does. */
class EnvMap {
  private readonly entries = new Map<string, { name: string; value: string }>()
  constructor(private readonly insensitive: boolean) {}
  private key(name: string): string {
    return this.insensitive ? name.toUpperCase() : name
  }
  get(name: string): string | undefined {
    return this.entries.get(this.key(name))?.value
  }
  has(name: string): boolean {
    return this.entries.has(this.key(name))
  }
  /** Keeps the first spelling of a name. */
  set(name: string, value: string): void {
    const key = this.key(name)
    this.entries.set(key, { name: this.entries.get(key)?.name ?? name, value })
  }
  delete(name: string): void {
    this.entries.delete(this.key(name))
  }
  names(): string[] {
    return [...this.entries.values()].map((e) => e.name)
  }
  toObject(): Environment {
    return Object.fromEntries([...this.entries.values()].map((e) => [e.name, e.value]))
  }
  static from(env: Record<string, string | undefined>, insensitive: boolean): EnvMap {
    const map = new EnvMap(insensitive)
    for (const [name, value] of Object.entries(env)) if (value !== undefined) map.set(name, value)
    return map
  }
}

/**
 * The environment Explorer would give a new process: machine values, then user values over them,
 * each REG_EXPAND_SZ expanded (machine against machine, user against machine and user, then the
 * launch environment for profile names like USERPROFILE), and PATH machine then user.
 */
export function windowsPersonEnvironment(machine: RegistryValue[], user: RegistryValue[], launch: Record<string, string | undefined>): Environment {
  const built = new EnvMap(true)
  const launchMap = EnvMap.from(launch, true)
  const lookup = (name: string) => built.get(name) ?? launchMap.get(name)
  const paths: string[] = []
  for (const scope of [machine, user]) {
    // Plain values first, so an expandable one can refer to any of them.
    for (const v of [...scope.filter((v) => !v.expand), ...scope.filter((v) => v.expand)]) {
      const value = v.expand ? expandWindowsValue(v.value, lookup) : v.value
      if (v.name.toUpperCase() === 'PATH') paths.push(value)
      else built.set(v.name, value)
    }
  }
  const out = built.toObject()
  if (paths.length) out.PATH = paths.filter(Boolean).join(';')
  return out
}

/** `env -0` output between two markers (rc files may print banners). */
export function parseEnvSnapshot(output: string, marker: string): Environment {
  const body = output.split(marker)[1] ?? ''
  const env: Environment = {}
  for (const entry of body.split('\0')) {
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    const name = entry.slice(0, eq).replace(/^\n+/, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || isShellOwn(name)) continue
    env[name] = entry.slice(eq + 1)
  }
  return env
}

const pathKey = (env: Record<string, string | undefined>) => Object.keys(env).find((k) => k.toUpperCase() === 'PATH')

/**
 * The launch environment brought up to date: the person's current values set; a variable the
 * person had when the daemon started, still unchanged here, and gone now, removed; PATH in launch
 * order, without directories the person removed, with new ones appended. One `PATH` key.
 */
export function mergeEnvironment(
  launch: Record<string, string | undefined>,
  atStart: Environment,
  now: Environment,
  platform: NodeJS.Platform = process.platform
): Environment {
  const insensitive = platform === 'win32'
  const sep = platform === 'win32' ? ';' : ':'
  const result = EnvMap.from(launch, insensitive)
  const startMap = EnvMap.from(atStart, insensitive)
  const nowMap = EnvMap.from(now, insensitive)
  const isPath = (name: string) => (insensitive ? name.toUpperCase() : name) === 'PATH'
  for (const name of startMap.names()) {
    if (isPath(name)) continue
    if (!nowMap.has(name) && result.get(name) === startMap.get(name)) result.delete(name)
  }
  for (const name of nowMap.names()) if (!isPath(name)) result.set(name, nowMap.get(name)!)
  const segKey = (s: string) => (insensitive ? s.toLowerCase().replace(/[\\/]+$/, '') : s)
  const launchPathKey = pathKey(launch)
  const startPathKey = pathKey(atStart)
  const nowPathKey = pathKey(now)
  const split = (v: string | undefined) => (v ?? '').split(sep).filter(Boolean)
  const startSegs = new Set(split(startPathKey ? atStart[startPathKey] : undefined).map(segKey))
  const nowSegs = split(nowPathKey ? now[nowPathKey] : undefined)
  const nowSet = new Set(nowSegs.map(segKey))
  const seen = new Set<string>()
  const path: string[] = []
  for (const seg of split(launchPathKey ? launch[launchPathKey] : undefined)) {
    const key = segKey(seg)
    if (seen.has(key) || (startSegs.has(key) && !nowSet.has(key))) continue
    seen.add(key)
    path.push(seg)
  }
  for (const seg of nowSegs) {
    const key = segKey(seg)
    if (seen.has(key)) continue
    seen.add(key)
    path.push(seg)
  }
  result.delete('PATH')
  const out = result.toObject()
  out.PATH = path.join(sep)
  return out
}

/** Names whose values differ between two environments. */
export function changedNames(before: Environment, after: Environment, platform: NodeJS.Platform = process.platform): string[] {
  const insensitive = platform === 'win32'
  const a = EnvMap.from(before, insensitive)
  const b = EnvMap.from(after, insensitive)
  const names = new Set<string>()
  for (const name of a.names()) if (a.get(name) !== b.get(name)) names.add(name)
  for (const name of b.names()) if (a.get(name) !== b.get(name) && !a.has(name)) names.add(name)
  return [...names].sort()
}

export interface LiveEnvironmentOptions {
  launch: Record<string, string | undefined>
  /** The person's current environment (registry or login shell). */
  read: () => Promise<Environment>
  platform?: NodeJS.Platform
  /** `fresh`: re-read on a spawn once the last read is older than `ttlMs` (Windows: cheap).
   *  `cached`: serve the snapshot, refreshing it in the background once older than `staleMs`. */
  policy: 'fresh' | 'cached'
  ttlMs?: number
  staleMs?: number
  now?: () => number
}

export class LiveEnvironment {
  private atStart: Environment | null = null
  private snapshot: { env: Environment; at: number } | null = null
  private reading: Promise<Environment> | null = null

  constructor(private readonly options: LiveEnvironmentOptions) {}

  private get now(): number {
    return (this.options.now ?? Date.now)()
  }

  private read(): Promise<Environment> {
    this.reading ??= this.options
      .read()
      .catch((error: unknown): null => {
        log(`reading the user environment failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      })
      .then((read) => {
        // A failed read changes nothing: the last snapshot, or the launch environment as it is.
        if (!read && this.snapshot) return this.snapshot.env
        const person = read ?? this.atStart ?? {}
        if (read) this.atStart ??= read
        const env = mergeEnvironment(this.options.launch, this.atStart ?? person, person, this.options.platform)
        this.snapshot = { env, at: this.now }
        return env
      })
      .finally(() => {
        this.reading = null
      })
    return this.reading
  }

  /** Reads once at daemon start, so a variable removed later can be told from one the launcher set. */
  prime(): void {
    void this.read()
  }

  /** The environment for a process starting now. */
  async current(): Promise<Environment> {
    const snapshot = this.snapshot
    if (!snapshot) return { ...(await this.read()) }
    const age = this.now - snapshot.at
    if (this.options.policy === 'fresh') {
      if (age < (this.options.ttlMs ?? 2_000)) return { ...snapshot.env }
      return { ...(await this.read()) }
    }
    if (age >= (this.options.staleMs ?? 5 * 60_000) && !this.reading) void this.read()
    return { ...snapshot.env }
  }

  /** Reads now, whatever the cache; the names that changed since the last snapshot. */
  async reload(): Promise<string[]> {
    const before = this.snapshot?.env ?? (await this.read())
    if (this.reading) await this.reading.catch(() => undefined)
    const after = await this.read()
    return changedNames(before, after, this.options.platform)
  }
}

async function exportRegistryKey(key: string): Promise<RegistryValue[]> {
  const file = join(tmpdir(), `zomfy-env-${crypto.randomUUID()}.reg`)
  try {
    const proc = Bun.spawn(['reg.exe', 'export', key, file, '/y'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', windowsHide: true })
    if ((await proc.exited) !== 0) throw new Error(`reg export ${key} exited ${proc.exitCode}`)
    // reg export writes UTF-16LE, so non-ASCII paths survive whatever the console code page is.
    return parseRegExport((await readFile(file)).toString('utf16le'))
  } finally {
    await rm(file, { force: true }).catch(() => undefined)
  }
}

async function readWindowsEnvironment(launch: Record<string, string | undefined>): Promise<Environment> {
  const [machine, user] = await Promise.all([exportRegistryKey(WINDOWS_KEYS.machine), exportRegistryKey(WINDOWS_KEYS.user).catch(() => [])])
  return windowsPersonEnvironment(machine, user, launch)
}

async function readLoginShellEnvironment(): Promise<Environment> {
  const shell = process.env.SHELL || '/bin/bash'
  const marker = `__ZOMFY_ENV_${crypto.randomUUID().slice(0, 8)}__`
  const proc = Bun.spawn([shell, '-ilc', `printf '${marker}'; env -0; printf '${marker}'`], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
    windowsHide: true
  })
  const timer = setTimeout(() => proc.kill(), SNAPSHOT_TIMEOUT_MS)
  try {
    const output = await new Response(proc.stdout).text()
    const env = parseEnvSnapshot(output, marker)
    if (Object.keys(env).length === 0) throw new Error(`${shell} gave no environment`)
    return env
  } finally {
    clearTimeout(timer)
  }
}

let live: LiveEnvironment | null = null

/** This host's live environment (one per daemon). */
export function liveEnvironment(): LiveEnvironment {
  live ??= new LiveEnvironment(
    process.platform === 'win32'
      ? { launch: { ...process.env }, read: () => readWindowsEnvironment(process.env), policy: 'fresh', ttlMs: 2_000 }
      : { launch: { ...process.env }, read: readLoginShellEnvironment, policy: 'cached', staleMs: 5 * 60_000 }
  )
  return live
}

/** The environment a new terminal or agent process starts with. */
export function spawnEnvironment(): Promise<Environment> {
  return liveEnvironment().current()
}

/** PATH as a new process gets it. */
export async function spawnPath(): Promise<string> {
  const env = await spawnEnvironment()
  return env.PATH ?? env[pathKey(env) ?? ''] ?? (process.env.PATH || process.env.Path || '')
}

