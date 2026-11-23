import { TURN_RECOVERY_META } from '@zomfy/protocol'

// A tool call whose turn or process stopped before it finished reads as stopped, not running nor
// failed (stopped-tool-calls.md).

/** A tool call's status once its turn or process stopped before it finished. */
export const STOPPED_TOOL = 'stopped'

/** The status a tool_call_update sets: the daemon's closing update for a stopped call is `failed` in ACP. */
export function updatedToolStatus(status: string, meta: Record<string, unknown> | null | undefined): string {
  return meta?.[TURN_RECOVERY_META.toolStopped] === true ? STOPPED_TOOL : status
}

/** `items` with every pending or running call stopped; the same array when none is. */
export function stopOpenTools<T extends { kind: string; status?: unknown }>(items: T[]): T[] {
  return items.some(isOpenTool) ? items.map((item) => (isOpenTool(item) ? { ...item, status: STOPPED_TOOL } : item)) : items
}

function isOpenTool(item: { kind: string; status?: unknown }): boolean {
  return item.kind === 'tool' && (item.status === 'pending' || item.status === 'in_progress')
}
