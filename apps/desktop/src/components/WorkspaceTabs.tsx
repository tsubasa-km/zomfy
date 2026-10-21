import { useEffect, useMemo, useRef } from 'react'
import { allWorkspaces, useStore } from '@/session-store'
import {
  emptyLayout,
  layoutFor,
  leafGroupIds,
  reconcileLayout,
  storeReconciledLayout,
  topRightGroupId,
  useTabLayout
} from '@/stores/tab-layout-store'
import { SplitLayout } from '@/components/tab-layout/SplitLayout'
import { TabGroupPane } from '@/components/tab-layout/TabGroupPane'
import { useTabKeyboard } from '@/components/tab-layout/use-tab-keyboard'
import { syncWorkspaceFocus, useWorkspaceTabs } from '@/components/tab-layout/workspace-tab-model'
import { TerminalWorkspaceDialogs } from '@/components/terminal/TerminalWorkspaceDialogs'
import '@/components/tab-layout/tab-layout.css'

// A workspace's center area, as Orca draws it: a split tree of tab groups (TabGroupSplitNodeTree),
// each with its own tab strip (tab-bar/) and body.

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
  const focusTabId = useStore((s) => s.activeSessionByWorkspace[workspaceId])
  // Gone tabs are pruned only once the owning host has listed its sessions and terminals.
  const hostListed = useStore((s) => {
    const hostId = allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId
    return hostId !== undefined && s.hosts[hostId]?.connection.kind === 'connected'
  })
  const stored = useTabLayout((s) => s.layouts[workspaceId])
  const liveIds = useMemo(() => tabs.map((t) => t.id), [tabs])
  const layout = useMemo(
    () => reconcileLayout(stored ?? emptyLayout(), liveIds, focusTabId, hostListed),
    [stored, liveIds, focusTabId, hostListed]
  )

  useEffect(() => {
    // Recomputed from the store, not the render's copy, so a move made since then is kept.
    storeReconciledLayout(workspaceId, reconcileLayout(layoutFor(workspaceId), liveIds, focusTabId, hostListed))
    syncWorkspaceFocus(workspaceId)
  }, [workspaceId, layout, liveIds, focusTabId, hostListed])

  const rootRef = useRef<HTMLDivElement>(null)
  const switcher = useTabKeyboard({ workspaceId, rootRef, tabs, layout })
  const byId = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs])
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
          const groupTabs = group.tabOrder.flatMap((id) => byId.get(id) ?? [])
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
              emptyHint={hasSplit ? 'Empty pane' : emptyHint}
            />
          )
        }}
      />
      {switcher}
      <TerminalWorkspaceDialogs workspaceId={workspaceId} />
    </div>
  )
}
