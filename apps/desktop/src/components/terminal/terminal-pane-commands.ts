import type { TerminalInfo } from '@acp-harness/protocol'
import { closeTerminal, createTerminal } from '@/daemon-connection'
import { getState, selectTab } from '@/session-store'
import { renameTab } from '@/stores/tab-layout-store'
import {
  addPane,
  paneLayoutFor,
  paneOwnerTab,
  paneTabIds,
  paneTerminalIds,
  prunePanes,
  removePane,
  setActivePane
} from '@/stores/terminal-pane-store'

// Orca's terminal pane actions (pane-manager splits, pane-split-close): split, close and focus panes
// inside one terminal tab. Each pane is its own daemon terminal on the workspace's host.

/** The xterm input of a pane, which is what keyboard focus means for a terminal. */
export function focusPaneTerminal(terminalId: string): boolean {
  const input = document.querySelector<HTMLElement>(`[data-terminal-pane="${CSS.escape(terminalId)}"] .xterm-helper-textarea`)
  if (!input) return false
  input.focus({ preventScroll: true })
  return true
}

/** The pane holding keyboard focus, if any. */
export function focusedPaneTerminalId(): string | null {
  const active = document.activeElement
  return active instanceof Element ? (active.closest('[data-terminal-pane]')?.getAttribute('data-terminal-pane') ?? null) : null
}

/** Orca's Split Terminal Right/Down: a new shell of the same kind in a pane beside `terminalId`. */
export async function splitTerminalPane(workspaceId: string, terminalId: string, side: 'right' | 'down'): Promise<void> {
  const tabId = paneOwnerTab(terminalId)
  const shellId = getState().terminals.find((t) => t.id === terminalId)?.shellId
  const created = await createTerminal(workspaceId, shellId, undefined, { select: false })
  addPane(tabId, terminalId, created, side)
}

function followRename(workspaceId: string, oldTabId: string, newTabId: string | null): void {
  if (!newTabId || newTabId === oldTabId) return
  renameTab(workspaceId, oldTabId, newTabId)
  if (getState().activeSessionByWorkspace[workspaceId] === oldTabId) selectTab(workspaceId, newTabId)
}

/** Orca's "Close pane": the terminal ends and its neighbour takes the space; the last pane closes the tab. */
export function closeTerminalPane(workspaceId: string, terminalId: string): void {
  const tabId = paneOwnerTab(terminalId)
  if (!paneLayoutFor(tabId)) {
    closeTerminal(terminalId)
    return
  }
  const nextTabId = removePane(tabId, terminalId)
  followRename(workspaceId, tabId, nextTabId)
  closeTerminal(terminalId)
  const active = nextTabId ? (paneLayoutFor(nextTabId)?.activeTerminalId ?? nextTabId) : null
  if (active) requestAnimationFrame(() => focusPaneTerminal(active))
}

/** Every terminal a tab's panes hold (just the tab's own when it is not split). */
export function tabPaneTerminalIds(tabId: string): string[] {
  const layout = paneLayoutFor(tabId)
  return layout ? paneTerminalIds(layout.root) : [tabId]
}

/** Drops panes whose terminals the host no longer lists, keeping each tab in its slot. */
export function reconcileWorkspacePanes(workspaceId: string, terminals: readonly TerminalInfo[]): void {
  const live = new Set(terminals.map((t) => t.id))
  const own = new Set(terminals.filter((t) => t.workspaceId === workspaceId).map((t) => t.id))
  const tabIds = paneTabIds().filter((tabId) => tabPaneTerminalIds(tabId).some((id) => own.has(id)))
  for (const [oldId, newId] of prunePanes(live, tabIds)) followRename(workspaceId, oldId, newId)
}

/** Moves focus to the next or previous pane of the focused terminal tab, wrapping around. */
export function focusSiblingPane(step: 1 | -1): boolean {
  const current = focusedPaneTerminalId()
  if (!current) return false
  const tabId = paneOwnerTab(current)
  const ids = tabPaneTerminalIds(tabId)
  if (ids.length < 2) return false
  const next = ids[(ids.indexOf(current) + step + ids.length) % ids.length]!
  setActivePane(tabId, next)
  return focusPaneTerminal(next)
}
