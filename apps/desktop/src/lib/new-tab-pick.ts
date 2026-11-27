// The "+" quick pick's scopes, matching and order (docs/specs/panes-as-workspaces.md). Pure, so
// tests can run it.

export type PickScope = 'terminal' | 'agent' | 'panel'

/** The chips in order; null is all. */
export const PICK_SCOPES: readonly PickScope[] = ['terminal', 'agent', 'panel']

const PREFIXES: Record<string, PickScope> = { $: 'terminal', '@': 'agent', '#': 'panel' }

/** The scope Tab (or Shift+Tab) moves to: all → Terminal → Agent → Panel → all. */
export function nextScope(scope: PickScope | null, direction: 1 | -1 = 1): PickScope | null {
  const ring: (PickScope | null)[] = [null, ...PICK_SCOPES]
  const at = ring.indexOf(scope)
  return ring[(at + direction + ring.length) % ring.length]!
}

/** A scope prefix typed first (`$`, `@`, `#`) picks that scope and leaves the field. */
export function takeScopePrefix(query: string): { scope: PickScope; query: string } | null {
  const scope = PREFIXES[query.charAt(0)]
  return scope ? { scope, query: query.slice(1).trimStart() } : null
}

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
  scope: PickScope
  /** Other words it is found by (its English name in a translated window), matched after the label. */
  keywords?: string
  /** Listed first, above pinned and recent, while there is no query (New thread). */
  lead?: boolean
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

/**
 * The entries to list, in order, in up to three groups (lead and pinned, recent, the rest), each a
 * list. With no query: the lead entries, pinned in pin order, recent most recent first, the rest in scope order. With a query:
 * one group of the matches, best first, pinned then recent among equals.
 */
export function orderEntries<T extends PickEntry>(
  entries: readonly T[],
  options: { query: string; scope: PickScope | null; pins: readonly string[]; recent: readonly string[] }
): { groups: T[][]; matches: Map<string, number[]> } {
  const inScope = entries.filter((e) => options.scope === null || e.scope === options.scope)
  const matches = new Map<string, number[]>()
  const pinAt = (e: T) => options.pins.indexOf(e.id)
  const recentAt = (e: T) => options.recent.indexOf(e.id)
  if (options.query.trim()) {
    const scored = inScope.flatMap((entry, order) => {
      const match = matchEntry(entry, options.query)
      if (!match) return []
      matches.set(entry.id, match.indices)
      const boost = entry.lead ? 0 : pinAt(entry) !== -1 ? 1 : recentAt(entry) !== -1 ? 2 : 3
      return [{ entry, key: [match.rank, boost, order] }]
    })
    scored.sort((a, b) => a.key[0]! - b.key[0]! || a.key[1]! - b.key[1]! || a.key[2]! - b.key[2]!)
    const list = scored.map((s) => s.entry)
    return { groups: list.length > 0 ? [list] : [], matches }
  }
  const lead = inScope.filter((e) => e.lead)
  const others = inScope.filter((e) => !e.lead)
  const pinned = others.filter((e) => pinAt(e) !== -1).sort((a, b) => pinAt(a) - pinAt(b))
  const recent = others.filter((e) => pinAt(e) === -1 && recentAt(e) !== -1).sort((a, b) => recentAt(a) - recentAt(b))
  const scopeAt = (e: T) => PICK_SCOPES.indexOf(e.scope)
  const rest = others
    .map((entry, order) => ({ entry, order }))
    .filter(({ entry }) => pinAt(entry) === -1 && recentAt(entry) === -1)
    .sort((a, b) => scopeAt(a.entry) - scopeAt(b.entry) || a.order - b.order)
    .map((x) => x.entry)
  return { groups: [[...lead, ...pinned], recent, rest].filter((g) => g.length > 0), matches }
}
