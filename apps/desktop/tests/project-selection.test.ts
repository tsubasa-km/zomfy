import { describe, expect, test } from 'bun:test'
import type { HostedProject } from '../src/session-store.ts'
import type { ListedProject } from '../src/lib/catalog-projects.ts'
import { liveSelection, selectAllState, selectedLocations } from '../src/lib/project-selection.ts'

const location = (hostId: string, id: string): HostedProject => ({ hostId, id, name: id, path: `/${id}`, kind: 'git' }) as HostedProject
const a: ListedProject = { id: 'a', locations: [location('local', 'a1'), location('wsl', 'a2')] }
const b: ListedProject = { id: 'b', locations: [location('local', 'b1')] }
const c: ListedProject = { id: 'c', locations: [location('wsl', 'c1')] }

describe('the Projects page selection', () => {
  test('keeps only projects still listed, in the list order', () => {
    expect(liveSelection([a, b, c], ['c', 'gone', 'a'])).toEqual(['a', 'c'])
  })

  test('acts on every location of a selected project, setting aside offline hosts', () => {
    const { reachable, offline } = selectedLocations([a, b, c], ['a', 'c'], (hostId) => hostId === 'local')
    expect(reachable.map((l) => l.id)).toEqual(['a1'])
    expect(offline.map((l) => l.id)).toEqual(['a2', 'c1'])
  })

  test('the header checkbox reads none, some or all of the shown projects', () => {
    expect(selectAllState([a, b], [])).toBe(false)
    expect(selectAllState([a, b], ['a'])).toBe('indeterminate')
    expect(selectAllState([a, b], ['a', 'b', 'c'])).toBe(true)
  })
})
