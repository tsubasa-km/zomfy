import { cpSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The legacy spelling of env vars, ACP_HARNESS_*: still read when the ZOMFY_* one is unset. */
const LEGACY_ENV_PREFIX = 'ACP_HARNESS_' // legacy
/** The home folder older builds used, migrated to `.zomfy` on first start. */
export const LEGACY_HOME_NAME = '.acp-harness' // legacy
/** Left in a legacy home that could only be copied, so it is never migrated twice. */
export const LEGACY_MOVED_MARKER = 'MOVED-TO-ZOMFY.txt' // legacy home marker

/** `ZOMFY_<name>`, else the variable's legacy `ACP_HARNESS_<name>` spelling. */
export function envVar(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return env[`ZOMFY_${name}`] || env[`${LEGACY_ENV_PREFIX}${name}`] || undefined
}

export type HomeMigration =
  /** Nothing to migrate: no legacy home, it is already a link, or the new home exists. */
  | 'none'
  /** Renamed in place; the legacy path now links to the new home. */
  | 'moved'
  /** Could not be renamed (a file was held open), so it was copied and the legacy home marked. */
  | 'copied'
  /** A daemon still runs from the legacy home: keep using it so there are never two homes. */
  | 'in-use'
  /** Neither rename nor copy worked: keep using the legacy home, untouched. */
  | 'failed'

export interface MigrationOptions {
  /** Whether a pid is a running process; injectable for tests. */
  isAlive?: (pid: number) => boolean
  log?: (message: string) => void
  /** Rename attempts before falling back to a copy (Windows can hold a file briefly after a kill). */
  attempts?: number
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function runningPid(home: string): number | null {
  try {
    const pid = (JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { pid?: unknown }).pid
    return typeof pid === 'number' && pid !== process.pid ? pid : null
  } catch {
    return null
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Moves the legacy home (`legacy`) to `home` when only the legacy one exists. Sessions, settings,
 * tokens and anything else under it go along in one rename; the legacy path is then linked to the
 * new home, so absolute paths recorded before (attachments, agent configs) keep resolving and an
 * older build still finds the same state instead of starting a second home. Once those paths are
 * rewritten, legacy-home-retire.ts removes the link.
 */
export function migrateLegacyHome(legacy: string, home: string, options: MigrationOptions = {}): HomeMigration {
  const isAlive = options.isAlive ?? processAlive
  const log = options.log ?? (() => {})
  if (existsSync(home) || isLink(home)) return 'none'
  if (!existsSync(legacy) || isLink(legacy)) return 'none'
  if (existsSync(join(legacy, LEGACY_MOVED_MARKER))) return 'none'
  const pid = runningPid(legacy)
  if (pid !== null && isAlive(pid)) {
    log(`a daemon (pid ${pid}) still runs from ${legacy}; using it until that daemon stops`)
    return 'in-use'
  }

  const attempts = options.attempts ?? 5
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      renameSync(legacy, home)
      try {
        symlinkSync(home, legacy, process.platform === 'win32' ? 'junction' : 'dir')
      } catch (error) {
        log(`moved ${legacy} to ${home}; could not link the old path: ${String(error)}`)
        return 'moved'
      }
      log(`moved ${legacy} to ${home}`)
      return 'moved'
    } catch (error) {
      if (attempt === attempts) log(`could not rename ${legacy}: ${String(error)}; copying it instead`)
      else sleepSync(200)
    }
  }

  const staging = `${home}.migrating`
  try {
    rmSync(staging, { recursive: true, force: true })
    cpSync(legacy, staging, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true })
    rmSync(join(staging, 'daemon.json'), { force: true })
    renameSync(staging, home)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    log(`could not copy ${legacy} to ${home}: ${String(error)}; still using ${legacy}`)
    return 'failed'
  }
  try {
    writeFileSync(
      join(legacy, LEGACY_MOVED_MARKER),
      `Zomfy copied this folder to ${home} and uses that copy now. This folder can be deleted.\n`
    )
  } catch (error) {
    // Without the marker the next start sees the new home first and leaves this one alone anyway.
    log(`copied ${legacy} to ${home}; could not mark the old folder: ${String(error)}`)
  }
  log(`copied ${legacy} to ${home}`)
  return 'copied'
}

/** The home this daemon uses: an explicit one from the environment, else `~/.zomfy`, migrated from the legacy home. */
export function resolveHarnessHome(
  env: Record<string, string | undefined> = process.env,
  user = homedir(),
  options: MigrationOptions = {}
): string {
  const explicit = envVar('HOME', env)
  if (explicit) return explicit
  const home = join(user, '.zomfy')
  const legacy = join(user, LEGACY_HOME_NAME)
  // Unit tests import the stores; they must never move the person's real home.
  if (env.NODE_ENV === 'test' || envVar('SKIP_HOME_MIGRATION', env)) return existsSync(home) ? home : legacy
  const outcome = migrateLegacyHome(legacy, home, options)
  return outcome === 'in-use' || outcome === 'failed' ? legacy : home
}

let migrationLog: string[] = []
/** What the start-up migration did, for the daemon's log once logging is up. */
export function takeHomeMigrationLog(): string[] {
  const out = migrationLog
  migrationLog = []
  return out
}

/** `ZOMFY_HOME` gives a preview or test daemon its own state, apart from the user's real one. */
export const HARNESS_HOME = resolveHarnessHome(process.env, homedir(), { log: (m) => migrationLog.push(m) })

/**
 * Same shape as Orca's default `~/orca/workspaces/<repo>/<name>`. New worktrees go here; existing
 * ones keep the paths their workspace records hold, under the legacy `~/acp-harness` included.
 */
export const WORKSPACE_ROOT = envVar('HOME') ? join(envVar('HOME')!, 'workspaces') : join(homedir(), 'zomfy', 'workspaces')

/** Orca's `~/orca`: clones land here, beside the workspaces. */
export const CLONE_ROOT = dirname(WORKSPACE_ROOT)

/** Orca's `~/orca/projects`, where "Create new project" puts new repositories. */
export const PROJECTS_ROOT = join(CLONE_ROOT, 'projects')
