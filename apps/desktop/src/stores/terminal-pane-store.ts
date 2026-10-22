import { useSyncExternalStore } from 'react'

// Orca's terminal pane tree (lib/pane-manager): a terminal tab split into panes, each its own daemon
// terminal. The tab keeps the id of its first terminal (the leader); the others live only here, so
// the tab list hides them. A tab with one pane has no entry.

export type PaneSplitDirection = 'horizontal' | 'vertical'

export type PaneNode =
  | { type: 'leaf'; terminalId: string }
  | {
      type: 'split'
      /** horizontal = side by side, as in the tab-group tree. */
      direction: PaneSplitDirection
      first: PaneNode
      second: PaneNode
      /** Flex ratio of the first child (0–1). */
      ratio?: number
    }

export interface TerminalPaneLayout {
  root: PaneNode
  activeTerminalId: string
  /** Orca's "Expand pane": this pane fills the tab while the others stay mounted underneath. */
  expandedTerminalId?: string | null
}

type PaneState = Record<string, TerminalPaneLayout>

const STORAGE_KEY = 'acp-harness.terminal-panes.v1'

function readSaved(): PaneState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  } catch {
    return {}
  }
}

let state: PaneState = readSaved()
let memberOwner = indexMembers(state)
const listeners = new Set<() => void>()

/** Every non-leader pane terminal → the tab that holds it. */
function indexMembers(next: PaneState): Map<string, string> {
  const owners = new Map<string, string>()
  for (const [tabId, layout] of Object.entries(next)) {
    for (const id of paneTerminalIds(layout.root)) if (id !== tabId) owners.set(id, tabId)
  }
  return owners
}

function commit(next: PaneState): void {
  state = next
  memberOwner = indexMembers(next)
  for (const listener of listeners) listener()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage can be unavailable; panes then last for this session only.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTerminalPaneLayout(tabId: string): TerminalPaneLayout | undefined {
  return useSyncExternalStore(subscribe, () => state[tabId])
}

/** Re-renders when any tab's panes change (the tab list hides non-leader panes). */
export function useTerminalPaneState(): PaneState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Tabs that are split into panes. */
export function paneTabIds(): string[] {
  return Object.keys(state)
}

export function paneLayoutFor(tabId: string): TerminalPaneLayout | undefined {
  return state[tabId]
}

export function paneTerminalIds(node: PaneNode): string[] {
  return node.type === 'leaf' ? [node.terminalId] : [...paneTerminalIds(node.first), ...paneTerminalIds(node.second)]
}

/** The tab a terminal is drawn in: its own id, or the tab whose pane it is. */
export function paneOwnerTab(terminalId: string): string {
  return memberOwner.get(terminalId) ?? terminalId
}

export function isSecondaryPane(terminalId: string, panes: PaneState = state): boolean {
  if (panes === state) return memberOwner.has(terminalId)
  return Object.entries(panes).some(([tabId, l]) => tabId !== terminalId && paneTerminalIds(l.root).includes(terminalId))
}

// ── Pure tree operations ────────────────────────────────────────────────

function insertBeside(node: PaneNode, targetId: string, newId: string, direction: PaneSplitDirection): PaneNode {
  if (node.type === 'leaf') {
    if (node.terminalId !== targetId) return node
    return { type: 'split', direction, first: node, second: { type: 'leaf', terminalId: newId }, ratio: 0.5 }
  }
  return { ...node, first: insertBeside(node.first, targetId, newId, direction), second: insertBeside(node.second, targetId, newId, direction) }
}

function removeLeaf(node: PaneNode, terminalId: string): PaneNode | null {
  if (node.type === 'leaf') return node.terminalId === terminalId ? null : node
  const first = removeLeaf(node.first, terminalId)
  const second = removeLeaf(node.second, terminalId)
  if (!first) return second
  if (!second) return first
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

function setRatioAt(node: PaneNode, path: string[], ratio: number): PaneNode {
  if (node.type === 'leaf') return node
  if (path.length === 0) return { ...node, ratio }
  const [head, ...rest] = path
  return head === 'first' ? { ...node, first: setRatioAt(node.first, rest, ratio) } : { ...node, second: setRatioAt(node.second, rest, ratio) }
}

/** Orca's pane-tree-equalization: same-axis nested splits weigh by pane count, so three side-by-side panes become thirds. */
function equalizeWeight(node: PaneNode, direction: PaneSplitDirection): number {
  if (node.type === 'leaf' || node.direction !== direction) return 1
  return equalizeWeight(node.first, direction) + equalizeWeight(node.second, direction)
}

function equalize(node: PaneNode): PaneNode {
  if (node.type === 'leaf') return node
  const first = equalizeWeight(node.first, node.direction)
  const second = equalizeWeight(node.second, node.direction)
  return { ...node, ratio: first / (first + second), first: equalize(node.first), second: equalize(node.second) }
}

// ── Store actions ───────────────────────────────────────────────────────

function setLayout(tabId: string, layout: TerminalPaneLayout | null): void {
  const next = { ...state }
  if (layout && layout.root.type === 'split') next[tabId] = layout
  else delete next[tabId]
  commit(next)
}

/** Puts `newTerminalId` in a pane right of (or below) `targetTerminalId` inside tab `tabId`. */
export function addPane(tabId: string, targetTerminalId: string, newTerminalId: string, side: 'right' | 'down'): void {
  const root = state[tabId]?.root ?? { type: 'leaf', terminalId: tabId }
  const direction: PaneSplitDirection = side === 'right' ? 'horizontal' : 'vertical'
  setLayout(tabId, { root: insertBeside(root, targetTerminalId, newTerminalId, direction), activeTerminalId: newTerminalId, expandedTerminalId: null })
}

/**
 * Takes a pane out of its tab. Returns the tab's id afterwards: unchanged, or the next pane's id
 * when the leader went (null when no pane is left).
 */
export function removePane(tabId: string, terminalId: string): string | null {
  const layout = state[tabId]
  if (!layout) return terminalId === tabId ? null : tabId
  const root = removeLeaf(layout.root, terminalId)
  if (!root) {
    setLayout(tabId, null)
    return null
  }
  const ids = paneTerminalIds(root)
  const nextTabId = ids.includes(tabId) ? tabId : ids[0]!
  const activeTerminalId = ids.includes(layout.activeTerminalId) ? layout.activeTerminalId : ids[0]!
  const expandedTerminalId = layout.expandedTerminalId && ids.includes(layout.expandedTerminalId) ? layout.expandedTerminalId : null
  const next = { ...state }
  delete next[tabId]
  if (root.type === 'split') next[nextTabId] = { root, activeTerminalId, expandedTerminalId }
  commit(next)
  return nextTabId
}

export function forgetPanes(tabIds: string[]): void {
  if (!tabIds.some((id) => state[id])) return
  const next = { ...state }
  for (const id of tabIds) delete next[id]
  commit(next)
}

export function setActivePane(tabId: string, terminalId: string): void {
  const layout = state[tabId]
  if (!layout || layout.activeTerminalId === terminalId || !paneTerminalIds(layout.root).includes(terminalId)) return
  setLayout(tabId, { ...layout, activeTerminalId: terminalId })
}

export function setPaneRatio(tabId: string, path: string, ratio: number): void {
  const layout = state[tabId]
  if (!layout) return
  setLayout(tabId, { ...layout, root: setRatioAt(layout.root, path ? path.split('.') : [], ratio) })
}

export function equalizePanes(tabId: string): boolean {
  const layout = state[tabId]
  if (!layout) return false
  setLayout(tabId, { ...layout, root: equalize(layout.root) })
  return true
}

/** Orca's terminal.expandPane: the active pane fills the tab, or the split comes back. */
export function toggleExpandedPane(tabId: string): boolean {
  const layout = state[tabId]
  if (!layout) return false
  setLayout(tabId, { ...layout, expandedTerminalId: layout.expandedTerminalId ? null : layout.activeTerminalId })
  return true
}

/**
 * Drops panes whose terminal is gone, once the host has listed its terminals. Returns the tab ids
 * that changed, old → new, so the tab layout can follow a leader that went.
 */
export function prunePanes(liveTerminalIds: ReadonlySet<string>, tabIds: readonly string[]): [string, string | null][] {
  const renamed: [string, string | null][] = []
  for (const tabId of tabIds) {
    const layout = state[tabId]
    if (!layout) continue
    let current: string | null = tabId
    for (const id of paneTerminalIds(layout.root)) {
      if (!liveTerminalIds.has(id) && current) current = removePane(current, id)
    }
    if (current !== tabId) renamed.push([tabId, current])
  }
  return renamed
}
