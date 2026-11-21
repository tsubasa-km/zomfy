import { useMemo, useRef } from 'react'
import { keepUnchangedTabs } from './keep-unchanged-tabs'
import type { TerminalInfo } from '@acp-harness/protocol'
import { closeTerminal, createTerminal } from '@/daemon-connection'
import {
  allWorkspaces,
  closeEditorTab,
  closeStartTab,
  expectDrawerTerminal,
  getState,
  inWindowTabs,
  openEditorTab,
  selectTab,
  START_TAB,
  useStore,
  type EditorTab,
  type Session,
  type StoreState
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
  tabScope,
  useTabLayout,
  WINDOW_TABS,
  type ReopenSpec,
  type TabMeta
} from '@/stores/tab-layout-store'
import { forgetPanes, isSecondaryPane, useTerminalPaneState } from '@/stores/terminal-pane-store'
import { addPanelTab, getPanelTabs, panelTabOf, removePanelTabs, usePanelTabs, type PanelTab } from '@/stores/panel-tab-store'
import { requestDrawer } from '@/stores/drawer-request-store'
import { panelLabel } from './workspace-panels'
import { tabPaneTerminalIds } from '@/components/terminal/terminal-pane-commands'
import { t } from '@/i18n/i18n'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { useProjectCatalog } from '@/stores/project-catalog-store'

/** Every kind of tab the tab groups hold, in one shape. */
export type WorkspaceTab =
  /** The "New thread" tab: the quick start, which belongs to no workspace. */
  | { kind: 'start'; id: string; createdAt: number }
  | { kind: 'chat'; id: string; createdAt: number; session: Session }
  | { kind: 'terminal'; id: string; createdAt: number; terminal: TerminalInfo }
  | { kind: 'editor'; id: string; createdAt: number; editor: EditorTab }
  | { kind: 'browser'; id: string; createdAt: number; browser: BrowserTab }
  | { kind: 'panel'; id: string; createdAt: number; panel: PanelTab }

/** The workspace a tab belongs to: where its chat works, its shell runs or its file lives. */
export function tabWorkspaceId(tab: WorkspaceTab): string | null {
  switch (tab.kind) {
    case 'start':
      return null
    case 'chat':
      return tab.session.workspaceId
    case 'terminal':
      return tab.terminal.workspaceId
    case 'editor':
      return tab.editor.workspaceId
    case 'browser':
      return tab.browser.workspaceId
    case 'panel':
      return tab.panel.workspaceId
  }
}

/** A short name for where a workspace is: its project, and its branch when it is a worktree of it. */
export function useWorkspacePlace(workspaceId: string | null): string {
  // Re-renders when a project is renamed: its name is in the catalog.
  useProjectCatalog()
  return useStore((s) => {
    const w = workspaceId ? allWorkspaces(s).find((x) => x.id === workspaceId) : undefined
    if (!w) return ''
    const project = w.projectId ? s.hosts[w.hostId]?.harness?.projects.find((p) => p.id === w.projectId) : undefined
    const own = w.displayName ?? w.name
    if (!project) return w.scratch ? t('Quick thread') : own
    const name = projectLabel({ ...project, hostId: w.hostId })
    return w.isPrimary ? name : `${name} · ${(w.branch ?? own).split('/').pop()}`
  })
}

/** The same, from the tab's id alone. */
export function workspaceOfTab(tabId: string): string | null {
  const s = getState()
  return (
    s.sessions.find((x) => x.id === tabId)?.workspaceId ??
    s.terminals.find((x) => x.id === tabId)?.workspaceId ??
    s.editorTabs.find((x) => x.id === tabId)?.workspaceId ??
    getBrowserTabs().find((x) => x.id === tabId)?.workspaceId ??
    getPanelTabs().find((x) => x.id === tabId)?.workspaceId ??
    null
  )
}

/**
 * A set of tabs: a workspace's own (the floating panel's, a pop-out window's), or with WINDOW_TABS
 * the main window's, which holds the tabs of every workspace shown there. `drawer` asks for the
 * terminals and browsers kept in a workspace's pull-down drawer instead of the strip.
 */
export function useWorkspaceTabs(workspaceId: string, where: 'strip' | 'drawer' = 'strip'): WorkspaceTab[] {
  // Only the chats and terminals this set of tabs can hold, kept while none of them changed: a
  // chat streaming or a terminal retitling elsewhere does not redraw these tabs.
  const inScope = (id: string, s: StoreState) => (workspaceId === WINDOW_TABS ? inWindowTabs(id, s) : id === workspaceId)
  const sessions = useStableList((s) => s.sessions.filter((x) => !x.sideOf && inScope(x.workspaceId, s)))
  const terminals = useStableList((s) => s.terminals.filter((t) => !t.inline && inScope(t.workspaceId, s)))
  const editorTabs = useStore((s) => s.editorTabs)
  const browserTabs = useBrowserTabs()
  const panelTabs = usePanelTabs()
  // A split terminal tab is its leader terminal; the other panes are not tabs of their own.
  const panes = useTerminalPaneState()
  const open = useTabLayout((s) => s.open)
  const meta = useTabLayout((s) => s.meta)
  const startOpen = useStore((s) => s.startTab.open)
  // Which workspaces the window's tabs take in changes with the floating workspace and the pop-outs.
  const floating = useStore((s) => s.hosts.local?.harness?.floatingWorkspaceId ?? null)
  const poppedOut = useStore((s) => s.poppedOut)
  // A string, not a list: the store hands out fresh workspace objects on every read.
  const known = useStore((s) => allWorkspaces(s).map((w) => w.id).join(' '))
  const previous = useRef<WorkspaceTab[]>([])
  const fresh = useMemo(() => {
    // A page or panel left behind by a deleted workspace is nobody's tab.
    const exists = new Set(known.split(' '))
    const here = (id: string) => (workspaceId === WINDOW_TABS ? exists.has(id) && inWindowTabs(id) : id === workspaceId)
    const tabs: WorkspaceTab[] = [
      ...sessions
        // A chat has a tab only while it is open; the sidebar lists the rest.
        .filter((s) => here(s.workspaceId) && !s.sideOf && open[s.id])
        .map((session) => ({ kind: 'chat' as const, id: session.id, createdAt: session.createdAt, session })),
      ...terminals
        // Inline terminals live under a chat code block until opened as a tab.
        .filter((t) => here(t.workspaceId) && !t.inline && !isSecondaryPane(t.id, panes))
        .map((terminal) => ({ kind: 'terminal' as const, id: terminal.id, createdAt: terminal.createdAt, terminal })),
      ...editorTabs.filter((t) => here(t.workspaceId)).map((editor) => ({ kind: 'editor' as const, id: editor.id, createdAt: editor.createdAt, editor })),
      ...browserTabs
        .filter((t) => here(t.workspaceId))
        .map((browser) => ({ kind: 'browser' as const, id: browser.id, createdAt: browser.createdAt, browser })),
      ...panelTabs.filter((t) => here(t.workspaceId)).map((panel) => ({ kind: 'panel' as const, id: panel.id, createdAt: panel.createdAt, panel }))
    ]
    if (workspaceId === WINDOW_TABS && startOpen && where === 'strip') tabs.push({ kind: 'start', id: START_TAB, createdAt: 0 })
    return tabs.filter((tab) => (meta[tab.id]?.drawer === true) === (where === 'drawer')).sort((a, b) => a.createdAt - b.createdAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `floating` and `poppedOut` change what inWindowTabs answers
  }, [sessions, terminals, editorTabs, browserTabs, panelTabs, workspaceId, panes, open, meta, where, startOpen, floating, poppedOut, known])
  const tabs = useMemo(() => keepUnchangedTabs(previous.current, fresh), [fresh])
  previous.current = tabs
  return tabs
}

/** A list from the store that keeps its identity while its items do, so an unrelated change re-renders nothing. */
function useStableList<T>(select: (s: StoreState) => T[]): T[] {
  const last = useRef<T[]>([])
  return useStore((s) => {
    const list = select(s)
    const before = last.current
    if (list.length === before.length && list.every((item, i) => item === before[i])) return before
    last.current = list
    return list
  })
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

export function defaultTabTitle(tab: WorkspaceTab): string {
  switch (tab.kind) {
    case 'start':
      return t('New thread')
    case 'chat':
      return tab.session.title
    case 'terminal':
      return tab.terminal.title
    case 'editor':
      return `${fileName(tab.editor.path)}${tab.editor.kind === 'diff' ? (tab.editor.staged ? ' (staged)' : ' (diff)') : ''}`
    case 'browser':
      return browserTabTitle(tab.browser)
    case 'panel':
      return panelLabel(tab.panel.panel)
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

/**
 * Keeps the app-wide focus equal to the focused group's active tab: the tab's own workspace
 * remembers it, and among the window's tabs that workspace becomes the active one.
 */
export function syncWorkspaceFocus(workspaceId: string): void {
  const layout = layoutFor(workspaceId)
  const active = layout.groups[layout.focusedGroupId]?.activeTabId ?? null
  // A window left with no tab at all has no workspace in front either, and offers a new chat.
  if (active || getState().activeWorkspaceId !== null) selectLayoutTab(active, workspaceId)
}

/**
 * Puts the tab a layout shows in front into the app-wide focus, under the tab's own workspace
 * (`workspaceId` only says which layout it is). With no tab left among the window's, no workspace
 * is in front.
 */
export function selectLayoutTab(tabId: string | null, workspaceId: string): void {
  if (tabId) selectTab(tabId === START_TAB ? null : (workspaceOfTab(tabId) ?? workspaceId), tabId)
  else if (tabScope(workspaceId) === WINDOW_TABS) selectTab(null, '')
}

export function activateTab(workspaceId: string, groupId: string, tabId: string): void {
  activateInGroup(workspaceId, groupId, tabId)
  syncWorkspaceFocus(workspaceId)
}

// ── Close and reopen ────────────────────────────────────────────────────

function reopenSpec(tab: WorkspaceTab, meta: TabMeta | undefined): ReopenSpec | null {
  switch (tab.kind) {
    case 'start':
      return null
    case 'terminal':
      return { kind: 'terminal', ...(meta?.shellId ? { shellId: meta.shellId } : {}), ...(meta?.customTitle ? { customTitle: meta.customTitle } : {}) }
    case 'editor':
      return { kind: 'editor', editor: { kind: tab.editor.kind, path: tab.editor.path, staged: tab.editor.staged } }
    case 'browser':
      return { kind: 'browser', url: currentUrl(tab.browser) }
    case 'chat':
      return { kind: 'chat', sessionId: tab.id }
    case 'panel':
      return { kind: 'panel', panel: tab.panel.panel }
  }
}

/** Closes tabs as one action: one prompt for unsaved files, then each source is released. */
export function closeWorkspaceTabs(workspaceId: string, tabs: WorkspaceTab[]): boolean {
  const meta = getTabLayoutState().meta
  if (tabs.length === 0) return false
  const dirty = tabs.filter((t) => t.kind === 'editor' && t.editor.dirty)
  if (dirty.length > 0) {
    const names = dirty.map((t) => (t.kind === 'editor' ? t.editor.path : '')).join('\n')
    if (!window.confirm(t('Discard unsaved changes?\n\n{names}', { names }))) return false
  }

  const layout = layoutFor(workspaceId)
  for (const tab of [...tabs].reverse()) {
    const spec = reopenSpec(tab, meta[tab.id])
    const group = groupOfTab(layout, tab.id)
    if (spec && group) {
      pushClosedTab(tabWorkspaceId(tab) ?? workspaceId, { groupId: group.id, index: group.tabOrder.indexOf(tab.id), spec })
    }
  }

  const ids = tabs.map((t) => t.id)
  const next = removeTabsFromLayout(workspaceId, ids)
  // A chat's tab goes but the chat stays, running or not; deleting it is the sidebar's, with a confirm.
  hideChats(tabs.filter((t) => t.kind === 'chat').map((t) => t.id))
  for (const tab of tabs) {
    if (tab.kind === 'terminal') for (const id of tabPaneTerminalIds(tab.id)) closeTerminal(id)
    else if (tab.kind === 'editor') closeEditorTab(tab.id)
    else if (tab.kind === 'start') closeStartTab()
  }
  removeBrowserTabs(tabs.filter((t) => t.kind === 'browser').map((t) => t.id))
  removePanelTabs(tabs.filter((t) => t.kind === 'panel').map((t) => t.id))
  forgetTabMeta(tabs.filter((t) => t.kind !== 'chat').map((t) => t.id))
  forgetPanes(ids)
  // Session close picks its own fallback; the focused group's MRU choice wins, as in Orca.
  selectLayoutTab(next, workspaceId)
  return true
}

/** Orca's Ctrl+Shift+T: a fresh shell, the same file, or the same page, back in its old slot. */
export async function reopenClosedTab(scopeId: string): Promise<void> {
  const closed = popClosedTab(scopeId)
  if (!closed) return
  const { spec } = closed
  // Back in the workspace it was closed in, which among the window's tabs is not the one asking.
  const workspaceId = closed.workspaceId ?? scopeId
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
  } else if (spec.kind === 'panel') {
    id = addPanelTab(workspaceId, spec.panel).id
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

/** Opens a panel as a tab in the focused group, or shows the tab already open on it. */
export function openPanelTab(workspaceId: string, panel: string): string {
  const id = panelTabOf(workspaceId, panel)?.id ?? addPanelTab(workspaceId, panel).id
  selectTab(workspaceId, id)
  return id
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

/** `select: false` opens it without switching the pane's tab; `drawer` keeps it in the pull-down drawer. */
export async function newTerminalTab(
  workspaceId: string,
  shellId?: string,
  options: { select?: boolean; drawer?: boolean } = {}
): Promise<string> {
  const unclaimed = options.drawer ? expectDrawerTerminal(workspaceId) : null
  try {
    const id = await createTerminal(workspaceId, shellId, undefined, { select: options.select })
    setTabMeta(id, { shellId, drawer: options.drawer || undefined })
    return id
  } finally {
    // Normally the new terminal took it; a failed create must not hand the next one to the drawer.
    unclaimed?.()
  }
}

/** A browser tab kept in the pull-down drawer. */
export function newDrawerBrowser(workspaceId: string): string {
  const tab = addBrowserTab(workspaceId)
  setTabMeta(tab.id, { drawer: true })
  return tab.id
}

/** A drawer terminal or browser becomes a tab of the strip, in front. */
export function moveToTabStrip(workspaceId: string, tabId: string): void {
  setTabMeta(tabId, { drawer: undefined })
  selectTab(workspaceId, tabId)
}

/** A strip terminal or browser goes into the pull-down drawer, which then shows it. */
export function moveToDrawer(workspaceId: string, tabId: string): void {
  setTabMeta(tabId, { drawer: true })
  requestDrawer(workspaceId, tabId, 'show')
}
