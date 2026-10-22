import { getState, openEditorTab, type EditorTab } from '@/session-store'
import { groupOfTab, layoutFor } from '@/stores/tab-layout-store'
import { splitTabTo } from '@/components/tab-layout/tab-group-commands'

// Orca's source-control/listing/split-open.ts: a modified click on a changed file opens it in a split
// to the right, keeping the current pane intact.

const PLACEMENT_WAIT_MS = 2_000

type ModifierKeys = Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>

export function isSourceControlSplitOpenModifier(event: ModifierKeys, isMac: boolean): boolean {
  const platformPrimary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return platformPrimary || event.shiftKey || event.altKey
}

/** Opens (or reveals) an editor tab, then moves it beside the pane that was focused. */
export async function openEditorTabInSplit(tab: Omit<EditorTab, 'id' | 'createdAt'>): Promise<void> {
  const { workspaceId } = tab
  const sourceGroupId = layoutFor(workspaceId).focusedGroupId
  openEditorTab(tab)
  const id = getState().activeSessionByWorkspace[workspaceId]
  if (!id) return
  // The layout places a new tab on its next reconcile; split it out once it has a group.
  const deadline = Date.now() + PLACEMENT_WAIT_MS
  while (!groupOfTab(layoutFor(workspaceId), id) && Date.now() < deadline) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  if (groupOfTab(layoutFor(workspaceId), id)) splitTabTo(workspaceId, id, sourceGroupId, 'right')
}
