/**
 * Before the rename, window storage keys had the legacy prefix `acp-harness.` / `acp-harness:`. Each one is
 * copied to its `zomfy` name, unless that name already holds a value, and the legacy key removed, so
 * layout, settings and drafts carry over. Runs before any store reads its key (see
 * migrate-legacy-storage.ts) and again harmlessly in every window.
 */
const LEGACY_PREFIX = 'acp-harness' // legacy key prefix
const PREFIX = 'zomfy'

export interface KeyValueStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** The key's current name, or null when it is not a legacy key. */
export function renamedStorageKey(key: string): string | null {
  if (!key.startsWith(LEGACY_PREFIX)) return null
  const rest = key.slice(LEGACY_PREFIX.length)
  return rest.startsWith('.') || rest.startsWith(':') ? PREFIX + rest : null
}

/** Moves legacy keys to their current names; returns how many it moved. */
export function migrateLegacyStorage(storage: KeyValueStorage): number {
  const legacy: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key !== null && renamedStorageKey(key) !== null) legacy.push(key)
  }
  let moved = 0
  for (const key of legacy) {
    const value = storage.getItem(key)
    const next = renamedStorageKey(key)!
    try {
      if (value !== null && storage.getItem(next) === null) {
        storage.setItem(next, value)
        moved++
      }
      storage.removeItem(key)
    } catch {
      // Storage full: leave this key as it was and keep going; the next start tries again.
    }
  }
  return moved
}

/** Set once window storage no longer holds paths under the legacy home. */
export const LEGACY_HOME_PATHS_DONE_KEY = 'zomfy.legacy-home-paths-rewritten'
/**
 * The legacy home folder as a path segment on any host (`C:\Users\me\.acp-harness`, `/home/me/.acp-harness`,
 * backslashes doubled inside JSON), never a longer name such as `.acp-harness-old`.
 */
const LEGACY_HOME_SEGMENT = /([\\/])\.acp-harness(?![\w.-])/gi // legacy home folder

/** `text` with paths under any host's legacy home pointing at its `.zomfy` home instead. */
export function rewriteLegacyHomePath(text: string): string {
  return text.replace(LEGACY_HOME_SEGMENT, '$1.zomfy')
}

/**
 * Daemons move each host's `~/.acp-harness` to `~/.zomfy` and then remove the old path, so stored
 * values (open tabs, layout, drafts) are pointed at the new home, once. Returns how many changed.
 */
export function rewriteLegacyHomePaths(storage: KeyValueStorage): number {
  if (storage.getItem(LEGACY_HOME_PATHS_DONE_KEY) !== null) return 0
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key !== null) keys.push(key)
  }
  let changed = 0
  try {
    for (const key of keys) {
      const value = storage.getItem(key)
      if (value === null) continue
      const next = rewriteLegacyHomePath(value)
      if (next === value) continue
      storage.setItem(key, next)
      changed++
    }
    storage.setItem(LEGACY_HOME_PATHS_DONE_KEY, '1')
  } catch {
    // Storage full: the next start tries again; values already rewritten no longer match.
  }
  return changed
}
