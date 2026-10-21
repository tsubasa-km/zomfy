import {
  closeGroupLayout,
  focusGroup as focusLayoutGroup,
  moveTab,
  splitWithTab,
  type SplitSide
} from '@/stores/tab-layout-store'
import { closeWorkspaceTabs, syncWorkspaceFocus, type WorkspaceTab } from './workspace-tab-model'

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

/** Orca's "Close split pane": the pane's tabs close with it. */
export function closeGroup(workspaceId: string, groupId: string, groupTabs: WorkspaceTab[]): void {
  if (groupTabs.length > 0 && !closeWorkspaceTabs(workspaceId, groupTabs)) return
  closeGroupLayout(workspaceId, groupId)
  syncWorkspaceFocus(workspaceId)
}
