import { createTerminal } from '@/daemon-connection'
import { groupOfTab, layoutFor, type SplitSide } from '@/stores/tab-layout-store'
import { splitTabTo } from '@/components/tab-layout/tab-group-commands'

const PLACEMENT_WAIT_MS = 2_000

/** Orca's "Split Terminal Right/Down": a new shell of the same kind, in a pane beside this one. */
export async function splitTerminal(
  workspaceId: string,
  terminalId: string,
  shellId: string | undefined,
  side: Extract<SplitSide, 'right' | 'down'>
): Promise<void> {
  const target = groupOfTab(layoutFor(workspaceId), terminalId)
  const id = await createTerminal(workspaceId, shellId)
  if (!target) return
  // The layout places a new tab on its next reconcile; split it out once it has a group.
  const deadline = Date.now() + PLACEMENT_WAIT_MS
  while (!groupOfTab(layoutFor(workspaceId), id) && Date.now() < deadline) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  if (groupOfTab(layoutFor(workspaceId), id)) splitTabTo(workspaceId, id, target.id, side)
}
