import { expect, test } from 'bun:test'
import { nextFrontTab, paneTabSet, resolvePaneContext } from '../src/lib/pane-context.ts'
import { defaultShellFirst, matchEntry, matchLabel, pushRecent, searchRows, treeKey, treeRows, type PickEntry, type PickNode } from '../src/lib/new-tab-pick.ts'

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

test('matching ranks a start before a word start, a substring and a scattered match', () => {
  expect(matchLabel('New Terminal…', 'new')).toEqual({ rank: 0, indices: [0, 1, 2] })
  expect(matchLabel('New Terminal…', 'term')?.rank).toBe(1)
  expect(matchLabel('Explorer', 'plo')?.rank).toBe(2)
  expect(matchLabel('New Claude Thread', 'nct')).toEqual({ rank: 3, indices: [0, 4, 11] })
  expect(matchLabel('Browser', 'xyz')).toBeNull()
})

test('recent keeps the last five, most recent first, without repeats', () => {
  let recent: string[] = []
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) recent = pushRecent(recent, id)
  expect(recent).toEqual(['b', 'f', 'e', 'd', 'c'])
})

test('a translated item is also found by its English keywords, with nothing marked', () => {
  const translated: PickEntry = { id: 'terminal', label: '新しいターミナル…', keywords: 'new terminal shell' }
  expect(matchEntry(translated, 'term')).toEqual({ rank: 1, indices: [] })
})

// The quick pick's tree (docs/specs/panes-as-workspaces.md).
const e = (id: string, label: string, keywords?: string): PickEntry => ({ id, label, ...(keywords ? { keywords } : {}) })
const tree: PickNode<PickEntry>[] = [
  { id: 'new-thread', label: 'New thread', entry: e('new-thread', 'New thread') },
  { id: 'pin:terminal', label: 'New Terminal…', entry: e('terminal', 'New Terminal…') },
  { id: 'scope:terminal', label: 'Terminal', children: [{ id: 'terminal', label: 'New Terminal…', entry: e('terminal', 'New Terminal…') }] },
  {
    id: 'scope:agent',
    label: 'Agent',
    children: [
      {
        id: 'provider:codex',
        label: 'Codex',
        children: [
          { id: 'chat:codex', label: 'New thread', entry: e('chat:codex', 'New Codex Thread') },
          { id: 'agent:codex', label: 'In a terminal', entry: e('agent:codex', 'Codex', 'codex agent cli terminal') }
        ]
      },
      { id: 'refresh-agents', label: 'Refresh Agents', entry: e('refresh-agents', 'Refresh Agents') }
    ]
  },
  { id: 'scope:panel', label: 'Panel', children: [{ id: 'browser', label: 'New Browser Tab', entry: e('browser', 'New Browser Tab') }] }
]
const ids = (rows: { node: { id: string } }[]) => rows.map((r) => r.node.id)

test('the tree shows New thread and the pins first, branches folded until opened', () => {
  expect(ids(treeRows(tree, new Set()))).toEqual(['new-thread', 'pin:terminal', 'scope:terminal', 'scope:agent', 'scope:panel'])
  const open = treeRows(tree, new Set(['scope:agent', 'provider:codex']))
  expect(ids(open)).toEqual(['new-thread', 'pin:terminal', 'scope:terminal', 'scope:agent', 'provider:codex', 'chat:codex', 'agent:codex', 'refresh-agents', 'scope:panel'])
  expect(open.find((r) => r.node.id === 'agent:codex')).toMatchObject({ depth: 2, path: ['Agent', 'Codex'], parentId: 'provider:codex' })
})

test('→ opens a branch then enters it; ← folds it, or from a child goes to its branch', () => {
  let open: ReadonlySet<string> = new Set()
  let rows = treeRows(tree, open)
  let step = treeKey(rows, 3, 'ArrowRight', open)
  expect(step.active).toBe(3)
  open = step.open
  expect([...open]).toEqual(['scope:agent'])
  rows = treeRows(tree, open)
  step = treeKey(rows, 3, 'ArrowRight', open)
  expect(rows[step.active]!.node.id).toBe('provider:codex')
  // ← on a closed child goes to its branch; ← on an open branch folds it.
  step = treeKey(rows, 4, 'ArrowLeft', open)
  expect(rows[step.active]!.node.id).toBe('scope:agent')
  step = treeKey(rows, 3, 'ArrowLeft', open)
  expect([...step.open]).toEqual([])
  // → on a leaf does nothing.
  expect(treeKey(rows, 0, 'ArrowRight', open)).toEqual({ active: 0, open })
})

test('a query lists the matching leaves flat with their path, once each, pinned first among equals', () => {
  const rows = searchRows(tree, 'codex', { pins: [], recent: [] })
  expect(ids(rows)).toEqual(['agent:codex', 'chat:codex'])
  expect(rows[0]!.path).toEqual(['Agent', 'Codex'])
  // The pinned terminal is listed once, under its branch.
  const term = searchRows(tree, 'new t', { pins: ['terminal'], recent: [] })
  expect(ids(term).filter((id) => id === 'terminal' || id === 'pin:terminal')).toEqual(['terminal'])
  expect(term.find((r) => r.node.id === 'terminal')!.path).toEqual(['Terminal'])
  expect(ids(term)[0]).toBe('terminal')
  // Branches do not match on their own.
  expect(ids(searchRows(tree, 'panel', { pins: [], recent: [] }))).toEqual([])
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

test("a host's shells list its default first: the one its settings name, else the first found", () => {
  const shells = [{ id: 'pwsh' }, { id: 'cmd' }, { id: 'wsl:Ubuntu' }]
  expect(defaultShellFirst(shells, 'wsl:Ubuntu').map((s) => s.id)).toEqual(['wsl:Ubuntu', 'pwsh', 'cmd'])
  expect(defaultShellFirst(shells, null).map((s) => s.id)).toEqual(['pwsh', 'cmd', 'wsl:Ubuntu'])
  expect(defaultShellFirst(shells, 'gone').map((s) => s.id)).toEqual(['pwsh', 'cmd', 'wsl:Ubuntu'])
  expect(defaultShellFirst([], 'pwsh')).toEqual([])
})
