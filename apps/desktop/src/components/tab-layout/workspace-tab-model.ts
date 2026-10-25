import { useMemo } from 'react'
import type { TerminalInfo } from '@acp-harness/protocol'
import { closeTerminal, createTerminal } from '@/daemon-connection'
import {
  allWorkspaces,
  closeEditorTab,
  getState,
  openEditorTab,
  selectTab,
  useStore,
  type EditorTab,
  type Session
} from '@/session-store'
import {
  addBrowserTab,
  browserTabTitle,
  currentUrl,
  getBrowserTabs,
  removeBrowserTabs,
  useBrowserTabs,
  type BrowserTab
} from '@/stores/browser-tab-store'
import {
  activateInGroup,
  forgetTabMeta,
  getTabLayoutState,
  groupOfTab,
  hideChats,
  layoutFor,
  placeTab,
  popClosedTab,
  pushClosedTab,
  removeTabsFromLayout,
  setTabMeta,
  showChat,
  useTabLayout,
  type ReopenSpec,
  type TabMeta
} from '@/stores/tab-layout-store'
import { forgetPanes, isSecondaryPane, useTerminalPaneState } from '@/stores/terminal-pane-store'
import { tabPaneTerminalIds } from '@/components/terminal/terminal-pane-commands'

/** Every kind of tab a workspace's tab groups hold, in one shape. */
export type WorkspaceTab =
  | { kind: 'chat'; id: string; createdAt: number; session: Session }
  | { kind: 'terminal'; id: string; createdAt: number; terminal: TerminalInfo }
  | { kind: 'editor'; id: string; createdAt: number; editor: EditorTab }
  | { kind: 'browser'; id: string; createdAt: number; browser: BrowserTab }

export function useWorkspaceTabs(workspaceId: string): WorkspaceTab[] {
  const sessions = useStore((s) => s.sessions)
  const terminals = useStore((s) => s.terminals)
  const editorTabs = useStore((s) => s.editorTabs)
  const browserTabs = useBrowserTabs()
  // A split terminal tab is its leader terminal; the other panes are not tabs of their own.
  const panes = useTerminalPaneState()
  const hidden = useTabLayout((s) => s.hidden)
  return useMemo(
    () =>
      [
        ...sessions
          .filter((s) => s.workspaceId === workspaceId && !s.sideOf && !hidden[s.id])
          .map((session) => ({ kind: 'chat' as const, id: session.id, createdAt: session.createdAt, session })),
        ...terminals
          // Inline terminals live under a chat code block until opened as a tab.
          .filter((t) => t.workspaceId === workspaceId && !t.inline && !isSecondaryPane(t.id, panes))
          .map((terminal) => ({ kind: 'terminal' as const, id: terminal.id, createdAt: terminal.createdAt, terminal })),
        ...editorTabs
          .filter((t) => t.workspaceId === workspaceId)
          .map((editor) => ({ kind: 'editor' as const, id: editor.id, createdAt: editor.createdAt, editor })),
        ...browserTabs
          .filter((t) => t.workspaceId === workspaceId)
          .map((browser) => ({ kind: 'browser' as const, id: browser.id, createdAt: browser.createdAt, browser }))
      ].sort((a, b) => a.createdAt - b.createdAt),
    [sessions, terminals, editorTabs, browserTabs, workspaceId, panes, hidden]
  )
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

export function defaultTabTitle(tab: WorkspaceTab): string {
  switch (tab.kind) {
    case 'chat':
      return tab.session.title
    case 'terminal':
      return tab.terminal.title
    case 'editor':
      return `${fileName(tab.editor.path)}${tab.editor.kind === 'diff' ? (tab.editor.staged ? ' (staged)' : ' (diff)') : ''}`
    case 'browser':
      return browserTabTitle(tab.browser)
  }
}

export function tabTitle(tab: WorkspaceTab, meta: TabMeta | undefined): string {
  return meta?.customTitle ?? defaultTabTitle(tab)
}

/** Only terminals and chats take a custom title, as in Orca's "Change Title". */
export function canRenameTab(tab: WorkspaceTab): boolean {
  return tab.kind === 'chat' || tab.kind === 'terminal'
}

export function workspacePath(workspaceId: string): string | null {
  return allWorkspaces(getState()).find((w) => w.id === workspaceId)?.path ?? null
}

/** Absolute path of an editor tab's file, joined with the workspace root's own separator. */
export function absoluteEditorPath(workspaceId: string, relative: string): string {
  const root = workspacePath(workspaceId)
  if (!root) return relative
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${relative.replaceAll(/[\\/]/g, sep)}`
}

// ── Focus ───────────────────────────────────────────────────────────────

/** Keeps the app-wide "active tab of this workspace" equal to the focused group's active tab. */
export function syncWorkspaceFocus(workspaceId: string): void {
  const layout = layoutFor(workspaceId)
  const active = layout.groups[layout.focusedGroupId]?.activeTabId
  if (active && getState().activeSessionByWorkspace[workspaceId] !== active) selectTab(workspaceId, active)
}

export function activateTab(workspaceId: string, groupId: string, tabId: string): void {
  activateInGroup(workspaceId, groupId, tabId)
  syncWorkspaceFocus(workspaceId)
}

// ── Close and reopen ────────────────────────────────────────────────────

function reopenSpec(tab: WorkspaceTab, meta: TabMeta | undefined): ReopenSpec | null {
  switch (tab.kind) {
    case 'terminal':
      return { kind: 'terminal', ...(meta?.shellId ? { shellId: meta.shellId } : {}), ...(meta?.customTitle ? { customTitle: meta.customTitle } : {}) }
    case 'editor':
      return { kind: 'editor', editor: { kind: tab.editor.kind, path: tab.editor.path, staged: tab.editor.staged } }
    case 'browser':
      return { kind: 'browser', url: currentUrl(tab.browser) }
    case 'chat':
      return { kind: 'chat', sessionId: tab.id }
  }
}

/** Closes tabs as one action: one prompt for unsaved files, then each source is released. */
export function closeWorkspaceTabs(workspaceId: string, tabs: WorkspaceTab[]): boolean {
  const meta = getTabLayoutState().meta
  if (tabs.length === 0) return false
  const dirty = tabs.filter((t) => t.kind === 'editor' && t.editor.dirty)
  if (dirty.length > 0) {
    const names = dirty.map((t) => (t.kind === 'editor' ? t.editor.path : '')).join('\n')
    if (!window.confirm(`Discard unsaved changes?\n\n${names}`)) return false
  }

  const layout = layoutFor(workspaceId)
  for (const tab of [...tabs].reverse()) {
    const spec = reopenSpec(tab, meta[tab.id])
    const group = groupOfTab(layout, tab.id)
    if (spec && group) pushClosedTab(workspaceId, { groupId: group.id, index: group.tabOrder.indexOf(tab.id), spec })
  }

  const ids = tabs.map((t) => t.id)
  const next = removeTabsFromLayout(workspaceId, ids)
  // A chat's tab goes but the chat stays, running or not; deleting it is the sidebar's, with a confirm.
  hideChats(tabs.filter((t) => t.kind === 'chat').map((t) => t.id))
  for (const tab of tabs) {
    if (tab.kind === 'terminal') for (const id of tabPaneTerminalIds(tab.id)) closeTerminal(id)
    else if (tab.kind === 'editor') closeEditorTab(tab.id)
  }
  removeBrowserTabs(tabs.filter((t) => t.kind === 'browser').map((t) => t.id))
  forgetTabMeta(tabs.filter((t) => t.kind !== 'chat').map((t) => t.id))
  forgetPanes(ids)
  // Session close picks its own fallback; the focused group's MRU choice wins, as in Orca.
  if (next) selectTab(workspaceId, next)
  return true
}

/** Orca's Ctrl+Shift+T: a fresh shell, the same file, or the same page, back in its old slot. */
export async function reopenClosedTab(workspaceId: string): Promise<void> {
  const closed = popClosedTab(workspaceId)
  if (!closed) return
  const { spec } = closed
  let id: string
  if (spec.kind === 'terminal') {
    id = await createTerminal(workspaceId, spec.shellId)
    setTabMeta(id, { shellId: spec.shellId, customTitle: spec.customTitle })
  } else if (spec.kind === 'editor') {
    openEditorTab({ workspaceId, ...spec.editor })
    const opened = getState().editorTabs.find(
      (t) => t.workspaceId === workspaceId && t.kind === spec.editor.kind && t.path === spec.editor.path && t.staged === spec.editor.staged
    )
    if (!opened) return
    id = opened.id
  } else if (spec.kind === 'chat') {
    if (!getState().sessions.some((s) => s.id === spec.sessionId)) return
    showChat(spec.sessionId)
    id = spec.sessionId
  } else {
    id = addBrowserTab(workspaceId, spec.url).id
  }
  placeTab(workspaceId, id, closed.groupId, closed.index)
  syncWorkspaceFocus(workspaceId)
}

export function openBrowserTab(workspaceId: string, url?: string): string {
  const tab = addBrowserTab(workspaceId, url)
  selectTab(workspaceId, tab.id)
  return tab.id
}

/** Orca's browser "Duplicate Tab": the copy opens right after the original. */
export function duplicateBrowserTab(workspaceId: string, tabId: string): void {
  const source = getBrowserTabs().find((t) => t.id === tabId)
  const group = groupOfTab(layoutFor(workspaceId), tabId)
  if (!source || !group) return
  const copy = addBrowserTab(workspaceId, currentUrl(source))
  placeTab(workspaceId, copy.id, group.id, group.tabOrder.indexOf(tabId) + 1)
  syncWorkspaceFocus(workspaceId)
}

export async function newTerminalTab(workspaceId: string, shellId?: string): Promise<void> {
  const id = await createTerminal(workspaceId, shellId)
  if (shellId) setTabMeta(id, { shellId })
}
