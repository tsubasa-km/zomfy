import { expect, test } from 'bun:test'
import { nextFrontTab, paneTabSet, resolvePaneContext } from '../src/lib/pane-context.ts'
import { matchLabel, nextScope, orderEntries, pushRecent, takeScopePrefix, type PickEntry } from '../src/lib/new-tab-pick.ts'

const carries = (ids: string[]) => (id: string) => ids.includes(id)

test('a pane works in the workspace of the tab it has in front', () => {
  expect(resolvePaneContext({ front: 'a', last: 'b', others: ['b'] }, carries(['a', 'b']))).toBe('a')
  expect(resolvePaneContext({ front: 'b', last: 'a', others: ['a'] }, carries(['a', 'b']))).toBe('b')
})

test('a front tab with no workspace keeps the last context the pane had', () => {
  // The New thread tab with no place, a browser tab, a quick thread's chat.
  expect(resolvePaneContext({ front: null, last: 'a', others: ['b'] }, carries(['a', 'b']))).toBe('a')
  expect(resolvePaneContext({ front: 'quick', last: 'a', others: [] }, carries(['a']))).toBe('a')
})

test('with no last context the pane takes its most recently shown tab that has one', () => {
  expect(resolvePaneContext({ front: null, last: undefined, others: [null, 'b', 'c'] }, carries(['b', 'c']))).toBe('b')
  expect(resolvePaneContext({ front: null, last: 'gone', others: ['c'] }, carries(['c']))).toBe('c')
})

test('a pane with nothing to take has no context', () => {
  expect(resolvePaneContext({ front: null, last: undefined, others: [] }, carries([]))).toBeNull()
  expect(resolvePaneContext({ front: 'gone', last: undefined, others: [null] }, carries(['a']))).toBeNull()
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

test('New thread leads in all and Agent with no query, above pins and recent; with a query it is matched as any item', () => {
  const withLead: PickEntry[] = [...entries, { id: 'new-thread', label: 'New thread', scope: 'agent', lead: true }]
  const all = orderEntries(withLead, { query: '', scope: null, pins: ['browser'], recent: ['agent:codex'] })
  expect(all.groups[0]!.map((e) => e.id)).toEqual(['new-thread', 'browser'])
  expect(orderEntries(withLead, { query: '', scope: 'agent', pins: [], recent: [] }).groups.flat()[0]!.id).toBe('new-thread')
  expect(orderEntries(withLead, { query: '', scope: 'terminal', pins: [], recent: [] }).groups.flat().some((e) => e.id === 'new-thread')).toBe(false)
  expect(orderEntries(withLead, { query: 'thread', scope: null, pins: [], recent: [] }).groups.flat().map((e) => e.id)).toEqual(['new-thread', 'chat:claude'])
})

test('a pane shows its context set and the tabs of no workspace, keeping the others hidden', () => {
  const tabs = [
    { id: 'a1', ws: 'a' },
    { id: 'b1', ws: 'b' },
    { id: 'start', ws: null },
    { id: 'a2', ws: 'a' },
    { id: 'quick', ws: 'scratch' }
  ]
  const shown = (context: string | null) => paneTabSet(tabs, (t) => t.ws, context, carries(['a', 'b'])).map((t) => t.id)
  expect(shown('a')).toEqual(['a1', 'start', 'a2', 'quick'])
  expect(shown('b')).toEqual(['b1', 'start', 'quick'])
  expect(shown(null)).toEqual(['start', 'quick'])
})

test('closing the front tab keeps the pane on its set while the set has a tab left', () => {
  const setOf = (id: string) => ({ a1: 'a', a2: 'a', b1: 'b', web: null })[id] ?? null
  // Shown oldest to newest: a1, b1, (a2 closed). The set a still has a1.
  expect(nextFrontTab('a', ['a1', 'b1'], setOf)).toBe('a1')
  // A tab of no workspace belongs to every set.
  expect(nextFrontTab('a', ['a1', 'web', 'b1'], setOf)).toBe('web')
  // The set's last tab closed: the most recent tab at all.
  expect(nextFrontTab('a', ['b1'], setOf)).toBe('b1')
  expect(nextFrontTab(null, ['a1', 'b1'], setOf)).toBe('b1')
  expect(nextFrontTab('a', [], setOf)).toBeNull()
})
