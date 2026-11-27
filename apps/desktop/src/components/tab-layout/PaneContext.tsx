import { useEffect, useMemo } from 'react'
import { allWorkspaces, inWindowTabs, useStore } from '@/session-store'
import { tabScope, useTabLayout, WINDOW_TABS } from '@/stores/tab-layout-store'
import { resolvePaneContext } from '@/lib/pane-context'
import { tabWorkspaceId, type WorkspaceTab } from './workspace-tab-model'

// The workspace a split pane works in (docs/specs/panes-as-workspaces.md): the one of the tab it
// has in front, else the last one it had.

/** The last context of each pane of the window while it is open, by layout scope and group id. */
const lastContext = new Map<string, string>()

/**
 * The window's workspaces that can be a pane's context (a project's, not a quick thread's), as a
 * string so a fresh list of the same ones re-renders nothing.
 */
function useContextWorkspaceIds(): Set<string> {
  const known = useStore((s) =>
    allWorkspaces(s)
      .filter((w) => w.projectId !== null && !w.scratch && inWindowTabs(w.id, s))
      .map((w) => w.id)
      .join(' ')
  )
  return useMemo(() => new Set(known.split(' ').filter(Boolean)), [known])
}

/** What a tab gives its pane as context: a browser tab gives none, the New thread tab its place. */
function tabContext(tab: WorkspaceTab, startWorkspace: string | null): string | null {
  if (tab.kind === 'browser') return null
  if (tab.kind === 'start') return startWorkspace
  return tabWorkspaceId(tab)
}

/**
 * The pane's context, null for none. `layoutKey` is the tab layout's workspace argument:
 * WINDOW_TABS (or any workspace of the window) for the main window, whose panes each work it out;
 * a pop-out's or the floating panel's workspace, which is every one of its panes' context.
 */
export function usePaneContext(layoutKey: string, groupId: string, tabs: WorkspaceTab[], activeId: string | null): string | null {
  const scope = tabScope(layoutKey)
  const recent = useTabLayout((s) => s.layouts[scope]?.groups[groupId]?.recentTabIds)
  const startWorkspace = useStore((s) => s.startTab.workspaceId)
  const carries = useContextWorkspaceIds()
  const key = `${scope}:${groupId}`
  const context = useMemo(() => {
    if (scope !== WINDOW_TABS) return layoutKey
    const byId = new Map(tabs.map((tab) => [tab.id, tab]))
    const active = activeId ? byId.get(activeId) : undefined
    // Most recently shown first, then the tabs never shown, in strip order.
    const order = [...new Set([...(recent ?? []).slice().reverse(), ...tabs.map((tab) => tab.id)])]
    const others = order.flatMap((id) => (id === activeId || !byId.has(id) ? [] : [tabContext(byId.get(id)!, startWorkspace)]))
    return resolvePaneContext(
      { front: active ? tabContext(active, startWorkspace) : null, last: lastContext.get(key), others },
      (id) => carries.has(id)
    )
  }, [scope, layoutKey, tabs, activeId, recent, startWorkspace, carries, key])
  useEffect(() => {
    if (scope === WINDOW_TABS && context) lastContext.set(key, context)
  }, [scope, key, context])
  return context
}
