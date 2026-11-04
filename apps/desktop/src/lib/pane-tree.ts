// How the main area lays out the workspaces shown side by side: a tree of splits, each a row or a
// column of panes or further splits, as VS Code's editor grid. A leaf is a workspace id. Pure
// functions; session-store keeps the tree and lists its leaves as `columns`.

export type PaneLeaf = { leaf: string }
export type PaneSplit = { split: 'row' | 'column'; children: PaneNode[]; sizes: number[] }
export type PaneNode = PaneLeaf | PaneSplit

/** Which edge of a pane another lands on. */
export type PaneSide = 'left' | 'right' | 'top' | 'bottom'

export const isLeaf = (node: PaneNode): node is PaneLeaf => 'leaf' in node

/** The workspaces in reading order. */
export function paneLeaves(node: PaneNode | null): string[] {
  if (!node) return []
  return isLeaf(node) ? [node.leaf] : node.children.flatMap(paneLeaves)
}

/** One pane alone is no split: the main area then shows that workspace without a header. */
function settle(node: PaneNode | null): PaneNode | null {
  return node && !isLeaf(node) ? node : null
}

/** Drops leaves `keep` refuses; a split left with one child becomes that child. */
function prune(node: PaneNode, keep: (id: string) => boolean): PaneNode | null {
  if (isLeaf(node)) return keep(node.leaf) ? node : null
  const kept: { child: PaneNode; size: number }[] = []
  node.children.forEach((child, i) => {
    const next = prune(child, keep)
    if (next) kept.push({ child: next, size: node.sizes[i] ?? 1 })
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0]!.child
  return { split: node.split, children: kept.map((k) => k.child), sizes: kept.map((k) => k.size) }
}

export function keepPanes(node: PaneNode | null, keep: (id: string) => boolean): PaneNode | null {
  return settle(node && prune(node, keep))
}

export function removePane(node: PaneNode | null, id: string): PaneNode | null {
  return keepPanes(node, (leaf) => leaf !== id)
}

export function replacePane(node: PaneNode, id: string, withId: string): PaneNode {
  if (isLeaf(node)) return node.leaf === id ? { leaf: withId } : node
  return { ...node, children: node.children.map((child) => replacePane(child, id, withId)) }
}

export function swapPanes(node: PaneNode, a: string, b: string): PaneNode {
  if (isLeaf(node)) return node.leaf === a ? { leaf: b } : node.leaf === b ? { leaf: a } : node
  return { ...node, children: node.children.map((child) => swapPanes(child, a, b)) }
}

/**
 * Puts `id` on `side` of the pane showing `target`: beside it in its row or column when that runs
 * the same way, else the two share a new split in the target's place. `base` may be a lone pane.
 */
export function insertPane(base: PaneNode, target: string, id: string, side: PaneSide): PaneNode {
  const direction = side === 'left' || side === 'right' ? 'row' : 'column'
  const before = side === 'left' || side === 'top'
  const visit = (node: PaneNode): PaneNode => {
    if (isLeaf(node)) {
      if (node.leaf !== target) return node
      return { split: direction, children: before ? [{ leaf: id }, node] : [node, { leaf: id }], sizes: [1, 1] }
    }
    const at = node.children.findIndex((child) => isLeaf(child) && child.leaf === target)
    if (at !== -1 && node.split === direction) {
      // The new pane takes half of the target's share.
      const half = (node.sizes[at] ?? 1) / 2
      const children = [...node.children]
      const sizes = [...node.sizes]
      sizes[at] = half
      children.splice(before ? at : at + 1, 0, { leaf: id })
      sizes.splice(before ? at : at + 1, 0, half)
      return { ...node, children, sizes }
    }
    return { ...node, children: node.children.map(visit) }
  }
  return visit(base)
}

/** Takes `id` out of wherever it is and puts it on `side` of `target`. */
export function movePane(node: PaneNode, id: string, target: string, side: PaneSide): PaneNode {
  if (id === target) return node
  const without = prune(node, (leaf) => leaf !== id)
  if (!without) return node
  return insertPane(without, target, id, side)
}

/** A new pane at the right end of the layout. */
export function appendPane(node: PaneNode | null, id: string): PaneNode {
  if (!node) return { leaf: id }
  if (!isLeaf(node) && node.split === 'row') {
    const share = node.sizes.reduce((a, b) => a + b, 0) / node.sizes.length
    return { ...node, children: [...node.children, { leaf: id }], sizes: [...node.sizes, share] }
  }
  return { split: 'row', children: [node, { leaf: id }], sizes: [1, 1] }
}

/** The split at `path` (child indexes from the root) takes new relative sizes. */
export function resizePanes(node: PaneNode, path: number[], sizes: number[]): PaneNode {
  if (isLeaf(node)) return node
  if (path.length === 0) return { ...node, sizes }
  const [head, ...rest] = path
  return { ...node, children: node.children.map((child, i) => (i === head ? resizePanes(child, rest, sizes) : child)) }
}

/** The layout saved before the tree: two side by side, three or more in two rows, top row fuller. */
export function panesFromColumns(columns: string[], widths: Record<string, number> = {}): PaneNode | null {
  if (columns.length < 2) return null
  const row = (ids: string[]): PaneNode =>
    ids.length === 1 ? { leaf: ids[0]! } : { split: 'row', children: ids.map((leaf) => ({ leaf })), sizes: ids.map((id) => widths[id] ?? 1) }
  if (columns.length === 2) return row(columns)
  const split = Math.ceil(columns.length / 2)
  return { split: 'column', children: [row(columns.slice(0, split)), row(columns.slice(split))], sizes: [1, 1] }
}

/** A tree read back from storage, or null when it is not one. */
export function readPaneTree(raw: unknown): PaneNode | null {
  const valid = (node: unknown): node is PaneNode => {
    if (typeof node !== 'object' || node === null) return false
    if ('leaf' in node) return typeof node.leaf === 'string'
    return (
      'split' in node &&
      (node.split === 'row' || node.split === 'column') &&
      'children' in node &&
      Array.isArray(node.children) &&
      node.children.length > 1 &&
      node.children.every(valid) &&
      'sizes' in node &&
      Array.isArray(node.sizes) &&
      node.sizes.length === node.children.length
    )
  }
  return valid(raw) ? settle(raw) : null
}
