import { describe, expect, test } from 'bun:test'
import { migrateLegacyStorage, renamedStorageKey, type KeyValueStorage } from '../src/lib/legacy-storage'

function memoryStorage(entries: Record<string, string>): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries))
  return {
    map,
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  }
}

describe('legacy storage keys', () => {
  test('maps both legacy separators and nothing else', () => {
    expect(renamedStorageKey('acp-harness.settings.v1')).toBe('zomfy.settings.v1') // legacy
    expect(renamedStorageKey('acp-harness:source-control-base-ref:w1')).toBe('zomfy:source-control-base-ref:w1') // legacy
    expect(renamedStorageKey('acp-harnessX')).toBeNull() // legacy
    expect(renamedStorageKey('zomfy.settings.v1')).toBeNull()
    expect(renamedStorageKey('other')).toBeNull()
  })

  test('moves layout, settings and drafts to their new keys', () => {
    const storage = memoryStorage({
      'acp-harness.settings.v1': '{"theme":"dark"}', // legacy
      'acp-harness.tab-layout.v1': '{"tabs":[1]}', // legacy
      'acp-harness.new-thread.v1': '{"draft":"hi"}', // legacy
      'acp-harness:source-control-view-mode': 'tree', // legacy
      unrelated: 'x'
    })
    expect(migrateLegacyStorage(storage)).toBe(4)
    expect(Object.fromEntries(storage.map)).toEqual({
      unrelated: 'x',
      'zomfy.settings.v1': '{"theme":"dark"}',
      'zomfy.tab-layout.v1': '{"tabs":[1]}',
      'zomfy.new-thread.v1': '{"draft":"hi"}',
      'zomfy:source-control-view-mode': 'tree'
    })
  })

  test('a value already saved under the new key wins, and a second run changes nothing', () => {
    const storage = memoryStorage({
      'zomfy.settings.v1': '{"theme":"light"}',
      'acp-harness.settings.v1': '{"theme":"dark"}' // legacy
    })
    expect(migrateLegacyStorage(storage)).toBe(0)
    expect(Object.fromEntries(storage.map)).toEqual({ 'zomfy.settings.v1': '{"theme":"light"}' })
    expect(migrateLegacyStorage(storage)).toBe(0)
  })

  test('a full storage keeps the legacy key for the next start', () => {
    const storage = memoryStorage({ 'acp-harness.tasks.v1': '[1]' }) // legacy
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(migrateLegacyStorage(storage)).toBe(0)
    expect(storage.map.get('acp-harness.tasks.v1')).toBe('[1]') // legacy
  })
})
