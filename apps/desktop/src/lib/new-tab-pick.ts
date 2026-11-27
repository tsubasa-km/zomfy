// The "+" quick pick as a tree, its matching and its keys (docs/specs/panes-as-workspaces.md). Pure,
// so tests can run it.

/** The tree's top-level branches an item sits under. */
export type PickScope = 'terminal' | 'agent' | 'panel'

/** The branches in order. */
export const PICK_SCOPES: readonly PickScope[] = ['terminal', 'agent', 'panel']

export interface PickMatch {
  /** Lower is better: 0 starts with the query, 1 a word starts with it, 2 contains it, 3 scattered. */
  rank: number
  /** Indices of the matched characters in the label. */
  indices: number[]
}

const isWordStart = (label: string, i: number) => i === 0 || /[\s\-_./:·(]/.test(label.charAt(i - 1))

/** Whether `label` has every character of `query` in order (case-insensitive), and how well. */
export function matchLabel(label: string, query: string): PickMatch | null {
  const q = query.trim().toLowerCase()
  if (!q) return { rank: 0, indices: [] }
  const lower = label.toLowerCase()
  const at = lower.indexOf(q)
  if (at !== -1) {
    let best = at
    let start = at
    while (start !== -1 && !isWordStart(label, start)) start = lower.indexOf(q, start + 1)
    if (start !== -1) best = start
    const indices = Array.from({ length: q.length }, (_, i) => best + i)
    return { rank: best === 0 ? 0 : start !== -1 ? 1 : 2, indices }
  }
  const indices: number[] = []
  let from = 0
  for (const char of q) {
    if (char === ' ') continue
    const i = lower.indexOf(char, from)
    if (i === -1) return null
    indices.push(i)
    from = i + 1
  }
  return { rank: 3, indices }
}

export interface PickEntry {
  id: string
  label: string
  /** Other words it is found by (its English name in a translated window), matched after the label. */
  keywords?: string
}

/** The entry's match: on its label, else on its keywords (with nothing in the label to mark). */
export function matchEntry(entry: PickEntry, query: string): PickMatch | null {
  const byLabel = matchLabel(entry.label, query)
  if (byLabel) return byLabel
  const byKeywords = entry.keywords ? matchLabel(entry.keywords, query) : null
  return byKeywords ? { rank: byKeywords.rank, indices: [] } : null
}

/** How many recently run items the quick pick remembers. */
export const MAX_RECENT = 5

/** `id` as the most recent of `recent`. */
export function pushRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, MAX_RECENT)
}

// ── The tree ─────────────────────────────────────────────────────────────

/** A row of the tree: a leaf runs its entry; a branch holds children. Ids are unique in the tree. */
export interface PickNode<T extends PickEntry> {
  id: string
  /** The name shown in the tree (a leaf's may be shorter than its entry's, under its branch). */
  label: string
  entry?: T
  children?: PickNode<T>[]
}

export interface PickRow<T extends PickEntry> {
  node: PickNode<T>
  depth: number
  /** The branches above it, by name, for a search result's path. */
  path: string[]
  parentId: string | null
  /** Matched characters of the entry's label, with a query. */
  marks?: number[]
}

/** The rows on show with no query: every top-level node, and the children of open branches. */
export function treeRows<T extends PickEntry>(
  nodes: readonly PickNode<T>[],
  open: ReadonlySet<string>,
  depth = 0,
  path: string[] = [],
  parentId: string | null = null
): PickRow<T>[] {
  return nodes.flatMap((node) => {
    const row: PickRow<T> = { node, depth, path, parentId }
    if (!node.children || !open.has(node.id)) return [row]
    return [row, ...treeRows(node.children, open, depth + 1, [...path, node.label], node.id)]
  })
}

/**
 * With a query: the leaves that match, flat, each with its path, best first (a name starting with
 * the query, a word that does, one containing it, a scattered match), pinned then recent among
 * equals, then in tree order. A leaf listed twice (a pin at the top and in its branch) shows once,
 * with the deeper path.
 */
export function searchRows<T extends PickEntry>(
  nodes: readonly PickNode<T>[],
  query: string,
  options: { pins: readonly string[]; recent: readonly string[]; pinOf?: (entry: T) => string | null }
): PickRow<T>[] {
  const leaves: PickRow<T>[] = []
  const walk = (list: readonly PickNode<T>[], depth: number, path: string[], parentId: string | null) => {
    for (const node of list) {
      if (node.children) walk(node.children, depth + 1, [...path, node.label], node.id)
      else if (node.entry) leaves.push({ node, depth: 0, path, parentId })
    }
  }
  walk(nodes, 0, [], null)
  const byEntry = new Map<string, PickRow<T>>()
  for (const leaf of leaves) {
    const id = leaf.node.entry!.id
    const seen = byEntry.get(id)
    if (!seen || leaf.path.length > seen.path.length) byEntry.set(id, leaf)
  }
  const pinOf = options.pinOf ?? ((entry: T) => entry.id)
  const scored = [...byEntry.values()].flatMap((row, order) => {
    const entry = row.node.entry!
    const match = matchEntry(entry, query)
    if (!match) return []
    const pin = pinOf(entry)
    const boost = pin !== null && options.pins.includes(pin) ? 0 : options.recent.includes(entry.id) ? 1 : 2
    return [{ row: { ...row, marks: match.indices }, key: [match.rank, boost, order] }]
  })
  scored.sort((a, b) => a.key[0]! - b.key[0]! || a.key[1]! - b.key[1]! || a.key[2]! - b.key[2]!)
  return scored.map((s) => s.row)
}

/**
 * `→` and `←` on the highlighted row: `→` opens a branch, or on an open one moves to its first
 * child; `←` folds an open branch, or on a child moves to its branch. Returns the new highlight and
 * open set (the same set when nothing opened or folded).
 */
export function treeKey<T extends PickEntry>(
  rows: readonly PickRow<T>[],
  active: number,
  key: 'ArrowRight' | 'ArrowLeft',
  open: ReadonlySet<string>
): { active: number; open: ReadonlySet<string> } {
  const row = rows[active]
  if (!row) return { active, open }
  const branch = Boolean(row.node.children)
  const isOpen = branch && open.has(row.node.id)
  if (key === 'ArrowRight') {
    if (!branch) return { active, open }
    if (!isOpen) return { active, open: new Set([...open, row.node.id]) }
    return { active: row.node.children!.length > 0 ? active + 1 : active, open }
  }
  if (isOpen) {
    const next = new Set(open)
    next.delete(row.node.id)
    return { active, open: next }
  }
  if (row.parentId === null) return { active, open }
  const parent = rows.findIndex((r) => r.node.id === row.parentId)
  return { active: parent === -1 ? active : parent, open }
}
