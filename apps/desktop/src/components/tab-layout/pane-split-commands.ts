import { getState } from '@/session-store'
import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { layoutFor } from '@/stores/tab-layout-store'
import { equalizePanes, paneLayoutFor, paneOwnerTab, toggleExpandedPane } from '@/stores/terminal-pane-store'
import {
  closeTerminalPane,
  focusPaneTerminal,
  focusSiblingPane,
  focusedPaneTerminalId,
  splitTerminalPane
} from '@/components/terminal/terminal-pane-commands'
import { splitTabTo } from './tab-group-commands'
import { t } from '@/i18n/i18n'

// Orca's Terminal Panes shortcuts (shared/keybindings definitions-core-3/4) and its native-chat split
// (native-chat-split-shortcut.ts, native-chat-layout-actions.ts): the split keys split the focused
// terminal into panes, or move the focused chat into a new pane column.

export type SplitDirection = 'right' | 'down'

interface TabContext {
  workspaceId: string
  groupId: string
  tabId: string
}

/**
 * The tab group under keyboard focus. With nothing focused, or from the command palette, the main
 * workspace's focused group; focus in other chrome (sidebar, panels) means no target.
 */
function activeTabContext(): TabContext | null {
  const active = document.activeElement
  const inWorkspace = active instanceof Element ? active.closest('[data-workspace-tabs]') : null
  const unfocused = !active || active === document.body || !!active.closest('[cmdk-root]')
  if (!inWorkspace && !unfocused) return null
  const focused = inWorkspace ? active : null
  const workspaceId = inWorkspace ? inWorkspace.getAttribute('data-workspace-tabs') : getState().activeWorkspaceId
  if (!workspaceId) return null
  const layout = layoutFor(workspaceId)
  const groupId = focused ? focused.closest('[data-tab-group-id]')?.getAttribute('data-tab-group-id') : layout.focusedGroupId
  const tabId = groupId ? layout.groups[groupId]?.activeTabId : null
  return groupId && tabId ? { workspaceId, groupId, tabId } : null
}

function isChatTab(tabId: string): boolean {
  return getState().sessions.some((s) => s.id === tabId)
}

/** Orca's moveTabToNewPaneColumn: only a chat sharing its group with other tabs can move out. */
export function canSplitActiveChat(): boolean {
  const context = activeTabContext()
  return !!context && isChatTab(context.tabId) && (layoutFor(context.workspaceId).groups[context.groupId]?.tabOrder.length ?? 0) > 1
}

export function splitActiveChat(direction: SplitDirection): boolean {
  const context = activeTabContext()
  if (!context || !canSplitActiveChat()) return false
  splitTabTo(context.workspaceId, context.tabId, context.groupId, direction)
  return true
}

/** The pane a terminal-pane command acts on: the focused one, else the active tab's active pane. */
function targetPane(): string | null {
  const focused = focusedPaneTerminalId()
  if (focused) return focused
  const context = activeTabContext()
  if (!context || !getState().terminals.some((t) => t.id === context.tabId)) return null
  return paneLayoutFor(context.tabId)?.activeTerminalId ?? context.tabId
}

function split(direction: SplitDirection): boolean {
  const pane = targetPane()
  const terminal = pane ? getState().terminals.find((t) => t.id === pane) : undefined
  if (terminal) {
    void splitTerminalPane(terminal.workspaceId, terminal.id, direction)
    return true
  }
  return splitActiveChat(direction)
}

/** Closes the target pane when its tab is split; an unsplit tab is left to the tab close command. */
export function closeActivePane(): boolean {
  const pane = targetPane()
  if (!pane || !paneLayoutFor(paneOwnerTab(pane))) return false
  const terminal = getState().terminals.find((t) => t.id === pane)
  if (!terminal) return false
  closeTerminalPane(terminal.workspaceId, pane)
  return true
}

registerKeybindingDefinitions([
  {
    id: 'terminal.splitRight',
    title: t('Split terminal right'),
    group: 'Terminal Panes',
    keywords: ['pane', 'split', 'right', 'chat'],
    defaultBindings: { mac: ['Mod+D'], other: ['Mod+Shift+D'] },
    allowInTerminal: true,
    scope: 'terminal'
  },
  {
    id: 'terminal.splitDown',
    title: t('Split terminal down'),
    group: 'Terminal Panes',
    keywords: ['pane', 'split', 'down', 'chat'],
    defaultBindings: { mac: ['Mod+Shift+D'], other: ['Alt+Shift+D'] },
    allowInTerminal: true,
    scope: 'terminal'
  },
  {
    id: 'terminal.closePane',
    title: t('Close active pane'),
    group: 'Terminal Panes',
    keywords: ['pane', 'close'],
    defaultBindings: ['Mod+W'],
    allowInTerminal: true,
    scope: 'terminal'
  },
  {
    id: 'terminal.focusNextPane',
    title: t('Focus next pane'),
    group: 'Terminal Panes',
    keywords: ['pane', 'focus', 'next'],
    defaultBindings: ['Mod+BracketRight'],
    allowInTerminal: true,
    scope: 'terminal'
  },
  {
    id: 'terminal.focusPreviousPane',
    title: t('Focus previous pane'),
    group: 'Terminal Panes',
    keywords: ['pane', 'focus', 'previous'],
    defaultBindings: ['Mod+BracketLeft'],
    allowInTerminal: true,
    scope: 'terminal'
  },
  {
    id: 'terminal.equalizePaneSizes',
    title: t('Equalize pane sizes'),
    group: 'Terminal Panes',
    keywords: ['pane', 'split', 'equalize', 'resize', 'balance', 'size'],
    defaultBindings: [],
    allowInTerminal: true,
    scope: 'terminal'
  },
  {
    id: 'terminal.expandPane',
    title: t('Expand / collapse pane'),
    group: 'Terminal Panes',
    keywords: ['pane', 'expand', 'collapse', 'zoom'],
    defaultBindings: ['Mod+Shift+Enter'],
    allowInTerminal: true,
    scope: 'terminal'
  }
])

registerCommandHandler('terminal.splitRight', () => split('right'))
registerCommandHandler('terminal.splitDown', () => split('down'))
registerCommandHandler('terminal.closePane', () => closeActivePane())
registerCommandHandler('terminal.focusNextPane', () => focusSiblingPane(1))
registerCommandHandler('terminal.focusPreviousPane', () => focusSiblingPane(-1))
registerCommandHandler('terminal.equalizePaneSizes', () => {
  const pane = targetPane()
  return pane ? equalizePanes(paneOwnerTab(pane)) : false
})
registerCommandHandler('terminal.expandPane', () => {
  const pane = targetPane()
  if (!pane || !toggleExpandedPane(paneOwnerTab(pane))) return false
  requestAnimationFrame(() => focusPaneTerminal(pane))
})
