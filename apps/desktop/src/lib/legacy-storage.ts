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
