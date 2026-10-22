import { useSyncExternalStore } from 'react'

// Orca's tab-group model (shared/tab-types.ts, store/slices/tabs): each workspace holds a split tree
// whose leaves are tab groups, each group its own tab order, active tab and MRU stack.

export type SplitDirection = 'horizontal' | 'vertical'
export type SplitSide = 'left' | 'right' | 'up' | 'down'

export type LayoutNode =
  | { type: 'leaf'; groupId: string }
  | {
      type: 'split'
      /** horizontal = side by side, as in Orca. */
      direction: SplitDirection
      first: LayoutNode
      second: LayoutNode
      /** Flex ratio of the first child (0–1). */
      ratio?: number
    }

export interface TabGroup {
  id: string
  tabOrder: string[]
  activeTabId: string | null
  /** Oldest → most recent; closing the active tab returns to the previous one. */
  recentTabIds: string[]
}

export interface WorkspaceLayout {
  root: LayoutNode
  groups: Record<string, TabGroup>
  focusedGroupId: string
}

export interface TabMeta {
  customTitle?: string
  pinned?: boolean
  color?: string | null
  /** Shell a terminal tab was started with, so reopening starts the same one. */
  shellId?: string
}

export type ReopenSpec =
  | { kind: 'terminal'; shellId?: string; customTitle?: string }
  | { kind: 'editor'; editor: { kind: 'file' | 'diff'; path: string; staged: boolean } }
  | { kind: 'browser'; url: string }

export interface ClosedTab {
  groupId: string
  index: number
  spec: ReopenSpec
}

interface TabLayoutState {
  layouts: Record<string, WorkspaceLayout>
  meta: Record<string, TabMeta>
  /** Most recent first; in memory only, as in Orca. */
  closed: Record<string, ClosedTab[]>
}

const STORAGE_KEY = 'acp-harness.tab-layout.v1'
const MAX_CLOSED = 20
const MAX_RECENT = 30

function readSaved(): Pick<TabLayoutState, 'layouts' | 'meta'> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return { layouts: raw.layouts ?? {}, meta: raw.meta ?? {} }
  } catch {
    return { layouts: {}, meta: {} }
  }
}

let state: TabLayoutState = { ...readSaved(), closed: {} }
const listeners = new Set<() => void>()

// A popped-out workspace window edits layouts too; each window takes the other's saves as they land.
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return
  state = { ...readSaved(), closed: state.closed }
  for (const listener of listeners) listener()
})

function commit(next: TabLayoutState): void {
  state = next
  for (const listener of listeners) listener()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ layouts: next.layouts, meta: next.meta }))
  } catch {
    // Storage can be unavailable; the layout then starts fresh next time.
  }
}

export function useTabLayout<T>(select: (s: TabLayoutState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => select(state)
  )
}

export function getTabLayoutState(): TabLayoutState {
  return state
}

// ── Pure layout operations ──────────────────────────────────────────────

function newGroup(tabOrder: string[] = []): TabGroup {
  return { id: `group:${crypto.randomUUID()}`, tabOrder, activeTabId: tabOrder.at(-1) ?? null, recentTabIds: [] }
}

export function emptyLayout(): WorkspaceLayout {
  const group = newGroup()
  return { root: { type: 'leaf', groupId: group.id }, groups: { [group.id]: group }, focusedGroupId: group.id }
}

export function leafGroupIds(node: LayoutNode): string[] {
  return node.type === 'leaf' ? [node.groupId] : [...leafGroupIds(node.first), ...leafGroupIds(node.second)]
}

function removeLeaf(node: LayoutNode, groupId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.groupId === groupId ? null : node
  const first = removeLeaf(node.first, groupId)
  const second = removeLeaf(node.second, groupId)
  if (!first) return second
  if (!second) return first
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

function insertBeside(node: LayoutNode, targetGroupId: string, newGroupId: string, side: SplitSide): LayoutNode {
  if (node.type === 'leaf') {
    if (node.groupId !== targetGroupId) return node
    const created: LayoutNode = { type: 'leaf', groupId: newGroupId }
    const before = side === 'left' || side === 'up'
    return {
      type: 'split',
      direction: side === 'left' || side === 'right' ? 'horizontal' : 'vertical',
      first: before ? created : node,
      second: before ? node : created,
      ratio: 0.5
    }
  }
  return {
    ...node,
    first: insertBeside(node.first, targetGroupId, newGroupId, side),
    second: insertBeside(node.second, targetGroupId, newGroupId, side)
  }
}

function setRatioAt(node: LayoutNode, path: string[], ratio: number): LayoutNode {
  if (node.type === 'leaf') return node
  if (path.length === 0) return { ...node, ratio }
  const [head, ...rest] = path
  return head === 'first'
    ? { ...node, first: setRatioAt(node.first, rest, ratio) }
    : { ...node, second: setRatioAt(node.second, rest, ratio) }
}

function touch(group: TabGroup, tabId: string): TabGroup {
  return {
    ...group,
    activeTabId: tabId,
    recentTabIds: [...group.recentTabIds.filter((id) => id !== tabId), tabId].slice(-MAX_RECENT)
  }
}

/** Drops tabs from a group; an active tab that goes falls back to the previously active one. */
function withoutTabs(group: TabGroup, ids: Set<string>): TabGroup {
  if (!group.tabOrder.some((id) => ids.has(id)) && !group.recentTabIds.some((id) => ids.has(id))) return group
  const tabOrder = group.tabOrder.filter((id) => !ids.has(id))
  const recentTabIds = group.recentTabIds.filter((id) => !ids.has(id) && tabOrder.includes(id))
  let activeTabId = group.activeTabId
  if (activeTabId === null || ids.has(activeTabId)) {
    const index = activeTabId ? group.tabOrder.indexOf(activeTabId) : -1
    activeTabId = recentTabIds.at(-1) ?? tabOrder[Math.min(Math.max(index, 0), tabOrder.length - 1)] ?? null
  }
  return { ...group, tabOrder, recentTabIds, activeTabId }
}

/** Removes a group from the tree, focusing its neighbour; the last group always stays. */
function dropGroup(layout: WorkspaceLayout, groupId: string): WorkspaceLayout {
  const order = leafGroupIds(layout.root)
  if (order.length <= 1 || !layout.groups[groupId]) return layout
  const root = removeLeaf(layout.root, groupId) ?? layout.root
  const { [groupId]: _gone, ...groups } = layout.groups
  const index = order.indexOf(groupId)
  const neighbour = order[index - 1] ?? order[index + 1] ?? leafGroupIds(root)[0]!
  return { root, groups, focusedGroupId: layout.focusedGroupId === groupId ? neighbour : layout.focusedGroupId }
}

function collapseEmptyGroups(layout: WorkspaceLayout): WorkspaceLayout {
  let next = layout
  for (const id of leafGroupIds(layout.root)) {
    if (next.groups[id]?.tabOrder.length === 0) next = dropGroup(next, id)
  }
  return next
}

export function groupOfTab(layout: WorkspaceLayout, tabId: string): TabGroup | null {
  return Object.values(layout.groups).find((g) => g.tabOrder.includes(tabId)) ?? null
}

/**
 * Brings a layout in line with the tabs that exist: new tabs join the focused group, the tab the
 * rest of the app last focused becomes active, and (once the host has listed everything) tabs that
 * are gone are dropped.
 */
export function reconcileLayout(
  layout: WorkspaceLayout,
  liveIds: string[],
  focusTabId: string | undefined,
  prune: boolean
): WorkspaceLayout {
  let next = layout
  // Repair a tree whose groups went missing (hand-edited or older storage).
  const leaves = leafGroupIds(next.root)
  if (leaves.some((id) => !next.groups[id]) || !next.groups[next.focusedGroupId]) {
    const valid = leaves.filter((id) => next.groups[id])
    if (valid.length === 0) next = emptyLayout()
    else {
      let root: LayoutNode | null = next.root
      for (const id of leaves) if (!next.groups[id] && root) root = removeLeaf(root, id)
      const groups = Object.fromEntries(valid.map((id) => [id, next.groups[id]!]))
      next = { root: root ?? { type: 'leaf', groupId: valid[0]! }, groups, focusedGroupId: valid[0]! }
    }
  }

  const live = new Set(liveIds)
  if (prune) {
    const dead = new Set(Object.values(next.groups).flatMap((g) => g.tabOrder.filter((id) => !live.has(id))))
    if (dead.size > 0) {
      const groups = Object.fromEntries(Object.entries(next.groups).map(([id, g]) => [id, withoutTabs(g, dead)]))
      next = collapseEmptyGroups({ ...next, groups })
    }
  }

  const placed = new Set(Object.values(next.groups).flatMap((g) => g.tabOrder))
  const added = liveIds.filter((id) => !placed.has(id))
  if (added.length > 0) {
    const focused = next.groups[next.focusedGroupId]!
    let group: TabGroup = { ...focused, tabOrder: [...focused.tabOrder, ...added] }
    if (group.activeTabId === null) group = touch(group, added.at(-1)!)
    next = { ...next, groups: { ...next.groups, [group.id]: group } }
  }

  if (focusTabId && live.has(focusTabId)) {
    const owner = groupOfTab(next, focusTabId)
    if (owner && (owner.activeTabId !== focusTabId || next.focusedGroupId !== owner.id)) {
      next = { ...next, focusedGroupId: owner.id, groups: { ...next.groups, [owner.id]: touch(owner, focusTabId) } }
    }
  }
  return next
}

// ── Store actions ───────────────────────────────────────────────────────

export function layoutFor(workspaceId: string): WorkspaceLayout {
  return state.layouts[workspaceId] ?? emptyLayout()
}

function setLayout(workspaceId: string, layout: WorkspaceLayout): void {
  if (state.layouts[workspaceId] === layout) return
  commit({ ...state, layouts: { ...state.layouts, [workspaceId]: layout } })
}

/** Commits a reconciled layout only when it actually changed, so render-time reconciles stay quiet. */
export function storeReconciledLayout(workspaceId: string, layout: WorkspaceLayout): void {
  const current = state.layouts[workspaceId]
  if (current && JSON.stringify(current) === JSON.stringify(layout)) return
  setLayout(workspaceId, layout)
}

export function activateInGroup(workspaceId: string, groupId: string, tabId: string): void {
  const layout = layoutFor(workspaceId)
  const group = layout.groups[groupId]
  if (!group) return
  setLayout(workspaceId, { ...layout, focusedGroupId: groupId, groups: { ...layout.groups, [groupId]: touch(group, tabId) } })
}

export function focusGroup(workspaceId: string, groupId: string): void {
  const layout = layoutFor(workspaceId)
  if (layout.focusedGroupId === groupId || !layout.groups[groupId]) return
  setLayout(workspaceId, { ...layout, focusedGroupId: groupId })
}

/** Takes tabs out of the layout; returns the tab the focused group shows afterwards. */
export function removeTabsFromLayout(workspaceId: string, ids: string[]): string | null {
  const layout = layoutFor(workspaceId)
  const gone = new Set(ids)
  const groups = Object.fromEntries(Object.entries(layout.groups).map(([id, g]) => [id, withoutTabs(g, gone)]))
  const next = collapseEmptyGroups({ ...layout, groups })
  setLayout(workspaceId, next)
  return next.groups[next.focusedGroupId]?.activeTabId ?? null
}

/** Moves a tab to a position in a group (reorder within a group, or move across groups). */
export function moveTab(workspaceId: string, tabId: string, targetGroupId: string, index: number): void {
  const layout = layoutFor(workspaceId)
  const source = groupOfTab(layout, tabId)
  const target = layout.groups[targetGroupId]
  if (!source || !target) return
  const groups = { ...layout.groups }
  let insertAt = index
  if (source.id === target.id) {
    const from = source.tabOrder.indexOf(tabId)
    if (from < index) insertAt -= 1
    const order = source.tabOrder.filter((id) => id !== tabId)
    order.splice(Math.max(0, Math.min(insertAt, order.length)), 0, tabId)
    groups[target.id] = touch({ ...source, tabOrder: order }, tabId)
  } else {
    groups[source.id] = withoutTabs(source, new Set([tabId]))
    const order = [...target.tabOrder]
    order.splice(Math.max(0, Math.min(insertAt, order.length)), 0, tabId)
    groups[target.id] = touch({ ...target, tabOrder: order }, tabId)
  }
  setLayout(workspaceId, collapseEmptyGroups({ ...layout, groups, focusedGroupId: target.id }))
}

/** Orca's "Move Tab to Split": the tab opens a new group beside the target group. */
export function splitWithTab(workspaceId: string, tabId: string, targetGroupId: string, side: SplitSide): void {
  const layout = layoutFor(workspaceId)
  const source = groupOfTab(layout, tabId)
  if (!source || !layout.groups[targetGroupId]) return
  // Splitting a group's only tab beside itself would leave the original pane empty.
  if (source.id === targetGroupId && source.tabOrder.length <= 1) return
  const created = touch(newGroup([tabId]), tabId)
  const groups = { ...layout.groups, [source.id]: withoutTabs(source, new Set([tabId])), [created.id]: created }
  const root = insertBeside(layout.root, targetGroupId, created.id, side)
  setLayout(workspaceId, collapseEmptyGroups({ root, groups, focusedGroupId: created.id }))
}

export function canSplitTab(workspaceId: string, tabId: string): boolean {
  return (groupOfTab(layoutFor(workspaceId), tabId)?.tabOrder.length ?? 0) > 1
}

export function closeGroupLayout(workspaceId: string, groupId: string): void {
  setLayout(workspaceId, dropGroup(layoutFor(workspaceId), groupId))
}

export function setSplitRatio(workspaceId: string, path: string, ratio: number): void {
  const layout = layoutFor(workspaceId)
  setLayout(workspaceId, { ...layout, root: setRatioAt(layout.root, path ? path.split('.') : [], ratio) })
}

export function setTabMeta(tabId: string, patch: Partial<TabMeta>): void {
  const current = state.meta[tabId] ?? {}
  const merged: TabMeta = { ...current, ...patch }
  for (const key of Object.keys(merged) as (keyof TabMeta)[]) {
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') delete merged[key]
  }
  commit({ ...state, meta: { ...state.meta, [tabId]: merged } })
}

export function forgetTabMeta(ids: string[]): void {
  if (!ids.some((id) => state.meta[id])) return
  const meta = { ...state.meta }
  for (const id of ids) delete meta[id]
  commit({ ...state, meta })
}

export function pushClosedTab(workspaceId: string, entry: ClosedTab): void {
  const list = [entry, ...(state.closed[workspaceId] ?? [])].slice(0, MAX_CLOSED)
  commit({ ...state, closed: { ...state.closed, [workspaceId]: list } })
}

export function popClosedTab(workspaceId: string): ClosedTab | null {
  const [entry, ...rest] = state.closed[workspaceId] ?? []
  if (!entry) return null
  commit({ ...state, closed: { ...state.closed, [workspaceId]: rest } })
  return entry
}

/** Puts a tab at a slot in a group, falling back to the focused group when that one is gone. */
export function placeTab(workspaceId: string, tabId: string, preferredGroupId: string, index: number): void {
  const layout = layoutFor(workspaceId)
  const kept = Boolean(layout.groups[preferredGroupId])
  const groupId = kept ? preferredGroupId : layout.focusedGroupId
  // The old slot means nothing in another group; the tab goes last there.
  if (!kept) index = Number.MAX_SAFE_INTEGER
  if (groupOfTab(layout, tabId)) moveTab(workspaceId, tabId, groupId, index)
  else {
    const group = layout.groups[groupId]
    if (!group) return
    const order = [...group.tabOrder]
    order.splice(Math.min(index, order.length), 0, tabId)
    setLayout(workspaceId, {
      ...layout,
      focusedGroupId: groupId,
      groups: { ...layout.groups, [groupId]: touch({ ...group, tabOrder: order }, tabId) }
    })
  }
}

/** A terminal tab whose leader pane closed takes the next pane's id, keeping its slot, focus and title. */
export function renameTab(workspaceId: string, oldId: string, newId: string): void {
  const layout = state.layouts[workspaceId]
  const swap = (id: string) => (id === oldId ? newId : id)
  const layouts = layout
    ? {
        ...state.layouts,
        [workspaceId]: {
          ...layout,
          groups: Object.fromEntries(
            Object.entries(layout.groups).map(([id, g]) => [
              id,
              {
                ...g,
                tabOrder: g.tabOrder.map(swap),
                recentTabIds: g.recentTabIds.map(swap),
                activeTabId: g.activeTabId === null ? null : swap(g.activeTabId)
              }
            ])
          )
        }
      }
    : state.layouts
  const { [oldId]: moved, ...meta } = state.meta
  commit({ ...state, layouts, meta: moved ? { ...meta, [newId]: moved } : meta })
}

/** The group drawn at the tree's top-right corner, which carries the strip's trailing controls. */
export function topRightGroupId(node: LayoutNode): string {
  if (node.type === 'leaf') return node.groupId
  return topRightGroupId(node.direction === 'horizontal' ? node.second : node.first)
}
