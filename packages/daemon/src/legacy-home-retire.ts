import { copyFile, lstat, mkdir, readdir, readFile, realpath, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { chatAgentLaunch } from './chat-agent-launch-settings.ts'
import { moveClaudeConversation } from './claude-conversation-move.ts'
import { replaceFile } from './replace-file.ts'
import { HARNESS_HOME, LEGACY_HOME_NAME, envVar } from './harness-home.ts'

// The legacy home (`~/.acp-harness`) was moved to `~/.zomfy` and linked from its old path, so records
// holding absolute paths under it kept working. This rewrites those paths to the new home, once, and
// then removes the link (docs/specs/retire-legacy-home.md).

/** Written in the home once every stored path was rewritten; later starts only retry the link. */
export const RETIRED_MARKER = 'legacy-home-retired.json'
/** Subfolders whose JSON / JSONL files are store records; every other folder holds the person's files. */
const STORE_DIRS = ['sessions', 'automations', 'inline-terminals']

export interface RetireOptions {
  /** Treat paths as Windows paths (either slash, any case); defaults to this platform. */
  windows?: boolean
  /** Claude Code's config folder, whose `projects/` files conversations by folder. */
  claudeConfigDir?: () => Promise<string>
  log?: (message: string) => void
  now?: () => Date
}

export interface RetireResult {
  /** Store files changed, relative to the home. */
  rewritten: string[]
  movedConversations: number
  linkRemoved: boolean
  failures: string[]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Matches `legacy` as a whole path inside any text: either slash between its segments on Windows,
 * and never as part of a longer name (`.acp-harness-old`) or a longer path ending in it.
 */
export function legacyPathPattern(legacy: string, windows: boolean): RegExp {
  const sep = windows ? '[\\\\/]+' : '/+'
  const segments = legacy.split(windows ? /[\\/]+/ : /\/+/)
  const body = segments.map((s, i) => (i === 0 && s === '' ? '' : escapeRegExp(s))).join(sep)
  return new RegExp(`(?<![\\w.\\-])${body}(?![\\w.\\-])`, windows ? 'gi' : 'g')
}

/** Rewrites every path under `legacy` in `text` to the same path under `home`, in the slash style it used. */
export function rewriteLegacyPaths(text: string, pattern: RegExp, home: string, windows: boolean): string {
  return text.replace(pattern, (match) => {
    if (!windows) return home
    return match.includes('/') && !match.includes('\\') ? home.replace(/\\/g, '/') : home
  })
}

/** `value` with every string and key rewritten; the same object when nothing changed. */
function rewriteValue(value: unknown, rewrite: (s: string) => string): unknown {
  if (typeof value === 'string') return rewrite(value)
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const out = rewriteValue(item, rewrite)
      if (out !== item) changed = true
      return out
    })
    return changed ? next : value
  }
  if (value && typeof value === 'object') {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const k = rewrite(key)
      const out = rewriteValue(item, rewrite)
      if (k !== key || out !== item) changed = true
      next[k] = out
    }
    return changed ? next : value
  }
  return value
}

/** The indent a JSON file was written with, so a rewritten one keeps its shape. */
function indentOf(text: string): string | undefined {
  return /^[[{]\r?\n([ \t]+)/.exec(text)?.[1]
}

/** The new text of a store file, or null when it holds no legacy path (or does not parse). */
export function rewriteStoreText(file: string, text: string, rewrite: (s: string) => string, mentions: (s: string) => boolean): string | null {
  if (!mentions(text)) return null
  if (file.endsWith('.jsonl')) {
    let changed = false
    const lines = text.split('\n').map((line) => {
      if (!mentions(line)) return line
      const cr = line.endsWith('\r') ? '\r' : ''
      try {
        const parsed = JSON.parse(line)
        const next = rewriteValue(parsed, rewrite)
        if (next === parsed) return line
        changed = true
        return JSON.stringify(next) + cr
      } catch {
        return line // a torn line stays as the store left it
      }
    })
    return changed ? lines.join('\n') : null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const next = rewriteValue(parsed, rewrite)
  if (next === parsed) return null
  const trailing = /\r?\n$/.exec(text)?.[0] ?? ''
  return JSON.stringify(next, null, indentOf(text)) + trailing
}

async function storeFiles(home: string): Promise<string[]> {
  const files: string[] = []
  const add = async (dir: string, exts: string[]) => {
    for (const entry of await readdir(join(home, dir), { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) files.push(join(dir, entry.name))
    }
  }
  await add('.', ['.json'])
  for (const dir of STORE_DIRS) await add(dir, ['.json', '.jsonl'])
  return files.map((f) => f.replace(/^\.[\\/]/, ''))
}

async function isLink(path: string): Promise<boolean> {
  return lstat(path).then(
    (s) => s.isSymbolicLink(),
    () => false
  )
}

async function samePlace(a: string, b: string, windows: boolean): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([realpath(a), realpath(b)])
    const norm = (p: string) => (windows ? p.replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '').toLowerCase() : p.replace(/\/+$/, ''))
    return norm(x) === norm(y)
  } catch {
    return false
  }
}

/** Removes `legacy` when it is a link to `home`; never anything else, and never what it points to. */
async function removeLink(legacy: string, home: string, windows: boolean, log: (m: string) => void): Promise<boolean> {
  if (!(await isLink(legacy))) return false
  if (!(await samePlace(legacy, home, windows))) {
    log(`${legacy} links somewhere other than ${home}; leaving it`)
    return false
  }
  try {
    await unlink(legacy)
  } catch {
    try {
      // A Windows junction is removed as an (empty, from its own point of view) folder; rmdir never recurses.
      await rmdir(legacy)
    } catch (error) {
      log(`could not remove the link at ${legacy}: ${String(error)}`)
      return false
    }
  }
  log(`removed the link at ${legacy}`)
  return true
}

function stampOf(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '')
}

/** Moves Claude's conversations for chats now under `home` out of their old folder's name. */
async function moveConversations(
  home: string,
  legacy: string,
  homePattern: RegExp,
  claudeConfigDir: string,
  failures: string[]
): Promise<number> {
  let records: { cwd?: unknown; claudeSessionId?: unknown }[]
  try {
    records = JSON.parse(await readFile(join(home, 'sessions', 'index.json'), 'utf8'))
  } catch {
    return 0
  }
  if (!Array.isArray(records)) return 0
  const projects = join(claudeConfigDir, 'projects')
  let moved = 0
  for (const record of records) {
    const { cwd, claudeSessionId: id } = record
    if (typeof cwd !== 'string' || typeof id !== 'string' || !id) continue
    homePattern.lastIndex = 0
    const at = homePattern.exec(cwd)
    if (!at || at.index !== 0) continue
    const oldCwd = legacy + cwd.slice(at[0].length)
    const oldDir = join(projects, oldCwd.replace(/[^a-zA-Z0-9]/g, '-'))
    if (!(await stat(join(oldDir, `${id}.jsonl`)).then(() => true, () => false))) continue
    try {
      await moveClaudeConversation(id, oldCwd, cwd, { CLAUDE_CONFIG_DIR: claudeConfigDir })
      moved++
    } catch (error) {
      failures.push(`moving Claude conversation ${id}: ${String(error)}`)
    }
  }
  return moved
}

/**
 * Rewrites stored paths under `legacy` to `home`, moves Claude conversations filed under the old
 * folder names, and removes the link at `legacy`. Safe to run on every start: once done it only
 * retries a link that could not be removed.
 */
export async function retireLegacyHome(legacy: string, home: string, options: RetireOptions = {}): Promise<RetireResult> {
  const windows = options.windows ?? process.platform === 'win32'
  const log = options.log ?? (() => {})
  const result: RetireResult = { rewritten: [], movedConversations: 0, linkRemoved: false, failures: [] }
  if (!(await stat(home).then((s) => s.isDirectory(), () => false))) return result
  const marker = join(home, RETIRED_MARKER)
  if (await stat(marker).then(() => true, () => false)) {
    result.linkRemoved = await removeLink(legacy, home, windows, log)
    return result
  }

  const pattern = legacyPathPattern(legacy, windows)
  const name = basename(legacy).toLowerCase()
  const mentions = (text: string) => text.toLowerCase().includes(name)
  const rewrite = (text: string) => (mentions(text) ? rewriteLegacyPaths(text, pattern, home, windows) : text)
  const backup = join(home, `backup-legacy-home-${stampOf(options.now?.() ?? new Date())}`)

  for (const file of await storeFiles(home)) {
    const path = join(home, file)
    try {
      const text = await readFile(path, 'utf8')
      const next = rewriteStoreText(file, text, rewrite, mentions)
      if (next === null || next === text) continue
      await mkdir(dirname(join(backup, file)), { recursive: true })
      await copyFile(path, join(backup, file))
      const temp = `${path}.retire-${process.pid}.tmp`
      await writeFile(temp, next)
      await replaceFile(temp, path)
      result.rewritten.push(file)
    } catch (error) {
      result.failures.push(`${file}: ${String(error)}`)
    }
  }
  if (result.rewritten.length) log(`rewrote paths under ${legacy} in ${result.rewritten.length} files (originals in ${backup})`)

  const claudeDir = options.claudeConfigDir ? await options.claudeConfigDir() : join(homedir(), '.claude')
  result.movedConversations = await moveConversations(home, legacy, legacyPathPattern(home, windows), claudeDir, result.failures)
  if (result.movedConversations) log(`moved ${result.movedConversations} Claude conversations to their folders under ${home}`)

  if (result.failures.length) {
    for (const failure of result.failures) log(`retiring ${legacy}: ${failure}`)
    log(`kept ${legacy}; the next start tries again`)
    return result
  }
  await writeFile(marker, JSON.stringify({ at: (options.now?.() ?? new Date()).toISOString(), legacy, rewritten: result.rewritten.length }) + '\n')
  result.linkRemoved = await removeLink(legacy, home, windows, log)
  return result
}

/**
 * Run by the daemon before its stores load. Only the default home takes part: one given by
 * ZOMFY_HOME (previews, tests) never had a legacy link, and a daemon still on the legacy home skips.
 */
export async function retireLegacyHomeAtStart(log: (message: string) => void): Promise<void> {
  if (envVar('HOME')) return
  const user = homedir()
  const home = join(user, '.zomfy')
  if (HARNESS_HOME !== home) return
  await retireLegacyHome(join(user, LEGACY_HOME_NAME), home, {
    log,
    claudeConfigDir: async () =>
      (await chatAgentLaunch('claude')).env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || join(user, '.claude')
  })
}
