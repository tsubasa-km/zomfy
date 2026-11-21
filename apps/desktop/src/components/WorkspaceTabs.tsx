import { useEffect, useMemo, useRef } from 'react'
import { allWorkspaces, getState, useStore } from '@/session-store'
import {
  emptyLayout,
  layoutFor,
  leafGroupIds,
  reconcileLayout,
  storeReconciledLayout,
  tabScope,
  topRightGroupId,
  useTabLayout,
  WINDOW_TABS
} from '@/stores/tab-layout-store'
import { SplitLayout } from '@/components/tab-layout/SplitLayout'
import { TabGroupPane } from '@/components/tab-layout/TabGroupPane'
import { useTabKeyboard } from '@/components/tab-layout/use-tab-keyboard'
import { syncWorkspaceFocus, useWorkspaceTabs } from '@/components/tab-layout/workspace-tab-model'
import { TerminalWorkspaceDialogs } from '@/components/terminal/TerminalWorkspaceDialogs'
import { reconcileWorkspacePanes } from '@/components/terminal/terminal-pane-commands'
import { paneOwnerTab, setActivePane, useTerminalPaneState } from '@/stores/terminal-pane-store'
import '@/components/tab-layout/tab-layout.css'
import { t } from '@/i18n/i18n'

// A set of tabs, as Orca draws it: a split tree of tab groups (TabGroupSplitNodeTree), each with its
// own tab strip (tab-bar/) and body. `workspaceId` names one workspace's tabs (the floating panel, a
// pop-out window), or with WINDOW_TABS the main window's, which hold every workspace's.

export function WorkspaceTabs({
  workspaceId,
  trailing,
  emptyHint
}: {
  workspaceId: string
  /** Controls drawn at the strip's right edge (the floating panel's window buttons). */
  trailing?: React.ReactNode
  emptyHint: string
}) {
  const tabs = useWorkspaceTabs(workspaceId)
  // The terminal menus' dialogs belong to a workspace: among the window's tabs, the one in front.
  const front = useStore((s) => s.activeWorkspaceId)
  const dialogsFor = workspaceId === WINDOW_TABS ? front : workspaceId
  const focusedId = useStore((s) => s.activeSessionByWorkspace[workspaceId])
  const panes = useTerminalPaneState()
  // Focusing a split pane's terminal (a notification, Jump to agent) focuses its tab and that pane.
  const focusTabId = useMemo(() => (focusedId ? paneOwnerTab(focusedId) : undefined), [focusedId, panes])
  // Gone tabs are pruned only once the owning host has listed its sessions and terminals: for the
  // window's tabs, every host it reconnects to, so a slow one does not lose its tabs' places.
  const hostListed = useStore((s) => {
    if (workspaceId === WINDOW_TABS) {
      const hosts = Object.values(s.hosts)
      const settled = (id: string) => s.hosts[id] !== undefined && s.hosts[id]!.connection.kind !== 'connecting'
      return hosts.some((h) => h.connection.kind === 'connected') && hosts.every((h) => settled(h.id)) && s.rememberedHosts.every(settled)
    }
    const hostId = allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId
    return hostId !== undefined && s.hosts[hostId]?.connection.kind === 'connected'
  })
  const stored = useTabLayout((s) => s.layouts[tabScope(workspaceId)])
  const liveIds = useMemo(() => tabs.map((t) => t.id), [tabs])
  const layout = useMemo(
    () => reconcileLayout(stored ?? emptyLayout(), liveIds, focusTabId, hostListed),
    [stored, liveIds, focusTabId, hostListed]
  )

  useEffect(() => {
    if (focusedId && focusTabId && focusedId !== focusTabId) setActivePane(focusTabId, focusedId)
  }, [focusedId, focusTabId])

  useEffect(() => {
    if (hostListed) reconcileWorkspacePanes(workspaceId === WINDOW_TABS ? null : workspaceId, getState().terminals)
    // Recomputed from the store, not the render's copy, so a move made since then is kept.
    storeReconciledLayout(workspaceId, reconcileLayout(layoutFor(workspaceId), liveIds, focusTabId, hostListed))
    syncWorkspaceFocus(workspaceId)
  }, [workspaceId, layout, liveIds, focusTabId, hostListed])

  const rootRef = useRef<HTMLDivElement>(null)
  const switcher = useTabKeyboard({ workspaceId, rootRef, tabs, layout })
  const byId = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs])
  // Each group's tabs, kept while neither the layout nor any tab changed, so its (memoised) pane does not redraw.
  const tabsByGroup = useMemo(
    () => new Map(Object.values(layout.groups).map((g) => [g.id, g.tabOrder.flatMap((id) => byId.get(id) ?? [])])),
    [layout, byId]
  )
  const hasSplit = leafGroupIds(layout.root).length > 1
  const trailingGroup = topRightGroupId(layout.root)

  return (
    <div ref={rootRef} data-workspace-tabs={workspaceId} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SplitLayout
        workspaceId={workspaceId}
        node={layout.root}
        renderLeaf={(groupId) => {
          const group = layout.groups[groupId]
          if (!group) return null
          const groupTabs = tabsByGroup.get(groupId) ?? []
          const activeId =
            groupTabs.find((t) => t.id === group.activeTabId)?.id ??
            [...group.recentTabIds].reverse().find((id) => byId.has(id) && group.tabOrder.includes(id)) ??
            groupTabs[0]?.id ??
            null
          return (
            <TabGroupPane
              key={groupId}
              workspaceId={workspaceId}
              groupId={groupId}
              tabs={groupTabs}
              activeId={activeId}
              isFocused={groupId === layout.focusedGroupId}
              hasSplit={hasSplit}
              trailing={groupId === trailingGroup ? trailing : undefined}
              emptyHint={hasSplit ? t('Empty pane') : emptyHint}
            />
          )
        }}
      />
      {switcher}
      {dialogsFor && <TerminalWorkspaceDialogs workspaceId={dialogsFor} />}
    </div>
  )
}
