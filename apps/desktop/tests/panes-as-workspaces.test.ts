import { expect, test } from 'bun:test'
import { resolvePaneContext } from '../src/lib/pane-context.ts'
import { matchLabel, nextScope, orderEntries, pushRecent, takeScopePrefix, type PickEntry } from '../src/lib/new-tab-pick.ts'

const live = (ids: string[]) => (id: string) => ids.includes(id)

test('an unset pane takes the workspace of the tab it shows, else of its other tabs, and keeps it', () => {
  expect(resolvePaneContext(undefined, ['a', 'b'], live(['a', 'b']))).toEqual({ context: 'a', settle: 'a' })
  expect(resolvePaneContext(undefined, [null, 'b'], live(['b']))).toEqual({ context: 'b', settle: 'b' })
  expect(resolvePaneContext(undefined, ['gone', 'b'], live(['b']))).toEqual({ context: 'b', settle: 'b' })
})

test('an unset pane with nothing to take acts as no project and keeps nothing', () => {
  expect(resolvePaneContext(undefined, [null], live(['a']))).toEqual({ context: null, settle: null })
  expect(resolvePaneContext(undefined, [], live([]))).toEqual({ context: null, settle: null })
})

test('a set context stays whatever the pane shows', () => {
  expect(resolvePaneContext('a', ['b', 'c'], live(['a', 'b', 'c']))).toEqual({ context: 'a', settle: null })
  expect(resolvePaneContext(null, ['b'], live(['b']))).toEqual({ context: null, settle: null })
})

test('a set context not in the window now is kept, and the pane acts on its tabs meanwhile', () => {
  expect(resolvePaneContext('a', ['b'], live(['b']))).toEqual({ context: 'b', settle: null })
})

test('Tab cycles all → Terminal → Agent → Panel → all, Shift+Tab back', () => {
  expect(nextScope(null)).toBe('terminal')
  expect(nextScope('terminal')).toBe('agent')
  expect(nextScope('agent')).toBe('panel')
  expect(nextScope('panel')).toBe(null)
  expect(nextScope(null, -1)).toBe('panel')
  expect(nextScope('terminal', -1)).toBe(null)
})

test('a prefix typed first picks a scope', () => {
  expect(takeScopePrefix('$ npm')).toEqual({ scope: 'terminal', query: 'npm' })
  expect(takeScopePrefix('@')).toEqual({ scope: 'agent', query: '' })
  expect(takeScopePrefix('#brow')).toEqual({ scope: 'panel', query: 'brow' })
  expect(takeScopePrefix('claude')).toBeNull()
})

test('matching ranks a start before a word start, a substring and a scattered match', () => {
  expect(matchLabel('New Terminal…', 'new')).toEqual({ rank: 0, indices: [0, 1, 2] })
  expect(matchLabel('New Terminal…', 'term')?.rank).toBe(1)
  expect(matchLabel('Explorer', 'plo')?.rank).toBe(2)
  expect(matchLabel('New Claude Thread', 'nct')).toEqual({ rank: 3, indices: [0, 4, 11] })
  expect(matchLabel('Browser', 'xyz')).toBeNull()
})

const entries: PickEntry[] = [
  { id: 'terminal', label: 'New Terminal…', scope: 'terminal' },
  { id: 'command:build', label: 'Build', scope: 'terminal' },
  { id: 'chat:claude', label: 'New Claude Thread', scope: 'agent' },
  { id: 'agent:codex', label: 'Codex', scope: 'agent' },
  { id: 'browser', label: 'New Browser Tab', scope: 'panel' },
  { id: 'panel:explorer', label: 'Explorer', scope: 'panel' }
]

test('with no query: pinned in pin order, then recent, then the rest in scope order', () => {
  const { groups } = orderEntries(entries, { query: '', scope: null, pins: ['browser', 'terminal'], recent: ['agent:codex', 'browser'] })
  expect(groups.map((g) => g.map((e) => e.id))).toEqual([
    ['browser', 'terminal'],
    ['agent:codex'],
    ['command:build', 'chat:claude', 'panel:explorer']
  ])
})

test('a scope keeps only its items', () => {
  const { groups } = orderEntries(entries, { query: '', scope: 'agent', pins: ['terminal'], recent: [] })
  expect(groups.flat().map((e) => e.id)).toEqual(['chat:claude', 'agent:codex'])
})

test('with a query: matches best first, pinned and recent first among equals', () => {
  const { groups, matches } = orderEntries(entries, { query: 'new', scope: null, pins: ['browser'], recent: ['chat:claude'] })
  expect(groups.flat().map((e) => e.id)).toEqual(['browser', 'chat:claude', 'terminal'])
  expect(matches.get('terminal')).toEqual([0, 1, 2])
})

test('recent keeps the last five, most recent first, without repeats', () => {
  let recent: string[] = []
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) recent = pushRecent(recent, id)
  expect(recent).toEqual(['b', 'f', 'e', 'd', 'c'])
})

test('a translated item is also found by its English keywords, with nothing marked', () => {
  const translated: PickEntry[] = [{ id: 'terminal', label: '新しいターミナル…', scope: 'terminal', keywords: 'new terminal shell' }]
  const { groups, matches } = orderEntries(translated, { query: 'term', scope: null, pins: [], recent: [] })
  expect(groups.flat().map((e) => e.id)).toEqual(['terminal'])
  expect(matches.get('terminal')).toEqual([])
})
