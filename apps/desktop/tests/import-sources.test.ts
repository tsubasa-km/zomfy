import { describe, expect, test } from 'bun:test'
import { foundSources, readingSources, shownSource, type ImportSourceId, type SourceProbe } from '../src/lib/import-sources.ts'

// docs/specs/import-dialog.md: which sources a host has, and which one the dialog shows.

type Probes = Partial<Record<ImportSourceId, SourceProbe>>
const ready = (count: number): SourceProbe => ({ status: 'ready', count })
const loading: SourceProbe = { status: 'loading' }
const failed: SourceProbe = { status: 'failed' }
const skipped: SourceProbe = { status: 'skipped' }

describe('the sources found', () => {
  test('Orca once its profile is read, even empty; an agent only with conversations', () => {
    const probes: Probes = { orca: ready(0), claude: ready(12), codex: ready(0), gemini: ready(3) }
    expect(foundSources(probes)).toEqual([
      { id: 'orca', count: 0 },
      { id: 'claude', count: 12 },
      { id: 'gemini', count: 3 }
    ])
  })

  test('failed, skipped and still-reading sources are left out', () => {
    expect(foundSources({ orca: failed, claude: loading, codex: skipped })).toEqual([])
  })

  test('Orca away from this computer is skipped', () => {
    expect(foundSources({ orca: skipped, codex: ready(2) })).toEqual([{ id: 'codex', count: 2 }])
  })

  test('the sources still being read, in order', () => {
    expect(readingSources({ codex: loading, orca: loading, claude: ready(1) } satisfies Probes)).toEqual(['orca', 'codex'])
  })
})

describe('the source shown', () => {
  test('the first found once every source before it has answered', () => {
    expect(shownSource({ orca: loading, claude: ready(4) }, null)).toBeNull()
    expect(shownSource({ orca: failed, claude: ready(4) }, null)).toBe('claude')
    expect(shownSource({ orca: ready(2), claude: loading }, null)).toBe('orca')
  })

  test('later sources still reading do not hold back an earlier one', () => {
    expect(shownSource({ orca: skipped, claude: ready(1), codex: loading, gemini: loading }, null)).toBe('claude')
  })

  test('the asked-for source wins when found, and is waited for while read', () => {
    expect(shownSource({ orca: ready(1), codex: ready(2) }, 'codex')).toBe('codex')
    expect(shownSource({ orca: ready(1), codex: loading }, 'codex')).toBeNull()
  })

  test('an asked-for source the host lacks falls back to the first found', () => {
    expect(shownSource({ orca: skipped, claude: ready(1) }, 'orca')).toBe('claude')
    expect(shownSource({ orca: failed, claude: ready(0), codex: ready(0) }, 'orca')).toBeNull()
  })
})
