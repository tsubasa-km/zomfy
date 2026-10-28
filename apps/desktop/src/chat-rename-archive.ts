import { toast } from 'sonner'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, selectTab, updateSession } from '@/session-store'
import { hideChats, removeTabsFromLayout, showChat } from '@/stores/tab-layout-store'

/** A daemon from before rename/archive answers JSON-RPC "method not found". */
function isUnsupported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === -32601
}

function describe(error: unknown): string {
  if (isUnsupported(error)) return "This chat's host runs an older daemon; update Zomfy there first."
  return error instanceof Error ? error.message : String(error)
}

/**
 * Renames a chat on its daemon, shown at once and reverted if the daemon refuses. 'unsupported' is an
 * older daemon, where a caller may fall back to a name kept in this window.
 */
export async function renameChat(sessionId: string, title: string): Promise<'ok' | 'unsupported' | 'failed'> {
  const before = getState().sessions.find((s) => s.id === sessionId)
  const next = title.replace(/\s+/g, ' ').trim()
  if (!before || !next) return 'failed'
  if (next === before.title) return 'ok'
  updateSession(sessionId, (s) => ({ ...s, title: next }))
  try {
    await harnessRequest(HARNESS_METHODS.sessionRename, { sessionId, title: next }, before.hostId)
    return 'ok'
  } catch (error) {
    updateSession(sessionId, (s) => ({ ...s, title: before.title }))
    if (isUnsupported(error)) return 'unsupported'
    toast.error("Couldn't rename the chat", { description: describe(error) })
    return 'failed'
  }
}

/** Archiving takes the chat out of the sidebar and closes its tab; the chat and its transcript stay. */
export async function setChatArchived(sessionId: string, archived: boolean): Promise<void> {
  const before = getState().sessions.find((s) => s.id === sessionId)
  if (!before || Boolean(before.archived) === archived) return
  updateSession(sessionId, (s) => ({ ...s, archived }))
  if (archived) {
    const next = removeTabsFromLayout(before.workspaceId, [sessionId])
    hideChats([sessionId])
    if (next) selectTab(before.workspaceId, next)
  }
  try {
    await harnessRequest(HARNESS_METHODS.sessionSetArchived, { sessionId, archived }, before.hostId)
  } catch (error) {
    updateSession(sessionId, (s) => ({ ...s, archived: before.archived }))
    if (archived) showChat(sessionId)
    toast.error(archived ? "Couldn't archive the chat" : "Couldn't unarchive the chat", { description: describe(error) })
  }
}
