import {
  closeGroupLayout,
  focusGroup as focusLayoutGroup,
  keepTab,
  layoutFor,
  moveTab,
  placeTab,
  splitWithTab,
  type SplitSide
} from '@/stores/tab-layout-store'
import { getState, openEditorTab } from '@/session-store'
import { closeWorkspaceTabs, syncWorkspaceFocus, type WorkspaceTab } from './workspace-tab-model'
import type { TabDropTarget } from './tab-drag'

// Layout commands that also move the app-wide focused tab, so the two stores never disagree.

export function focusGroup(workspaceId: string, groupId: string): void {
  focusLayoutGroup(workspaceId, groupId)
  syncWorkspaceFocus(workspaceId)
}

export function splitTabTo(workspaceId: string, tabId: string, groupId: string, side: SplitSide): void {
  splitWithTab(workspaceId, tabId, groupId, side)
  syncWorkspaceFocus(workspaceId)
}

export function moveTabTo(workspaceId: string, tabId: string, groupId: string, index: number): void {
  moveTab(workspaceId, tabId, groupId, index)
  syncWorkspaceFocus(workspaceId)
}

/**
 * Files dragged from the explorer onto a pane, as onto an editor group in VS Code: dropped on the
 * tab row they open at that place, on the pane's edge in a new split beside it, elsewhere at the end
 * of that pane's tabs. A file already open moves there. Tabs opened this way are kept, not previews.
 */
export function openFilesAt(layoutWorkspaceId: string, fileWorkspaceId: string, paths: string[], target: TabDropTarget): void {
  if (target.kind === 'none') return
  let groupId = target.groupId
  let index = target.kind === 'insert' ? target.index : Number.MAX_SAFE_INTEGER
  for (const [i, path] of paths.entries()) {
    const spec = { workspaceId: fileWorkspaceId, kind: 'file' as const, path, staged: false }
    openEditorTab(spec)
    const tab = getState().editorTabs.find((t) => t.workspaceId === fileWorkspaceId && t.kind === 'file' && t.path === path && !t.staged)
    if (!tab) continue
    keepTab(tab.id)
    placeTab(layoutWorkspaceId, tab.id, groupId, index)
    if (target.kind === 'split' && i === 0) {
      splitWithTab(layoutWorkspaceId, tab.id, groupId, target.side)
      // The rest follow the first into the new pane.
      groupId = layoutFor(layoutWorkspaceId).focusedGroupId
    }
    if (index !== Number.MAX_SAFE_INTEGER) index += 1
  }
  syncWorkspaceFocus(layoutWorkspaceId)
}

/** Orca's "Close split pane": the pane's tabs close with it. */
export function closeGroup(workspaceId: string, groupId: string, groupTabs: WorkspaceTab[]): void {
  if (groupTabs.length > 0 && !closeWorkspaceTabs(workspaceId, groupTabs)) return
  closeGroupLayout(workspaceId, groupId)
  syncWorkspaceFocus(workspaceId)
}
