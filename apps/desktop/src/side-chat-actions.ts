import { HARNESS_METHODS, SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES, type ChatAgentId } from '@acp-harness/protocol'
import { closeSession, harnessRequest } from '@/daemon-connection'
import { appendToDraft, requestComposerFocus } from '@/chat-actions'
import { addSession, getState, selectTab, setRightSidebar, type Session } from '@/session-store'

/** The workspace's side chat: the newest one, as starting another closes the previous. */
export function sideChatOf(sessions: Session[], workspaceId: string): Session | null {
  return sessions.findLast((s) => s.workspaceId === workspaceId && s.sideOf) ?? null
}

/** The chat a side chat sits beside: the workspace's active chat tab, else its newest chat. */
export function mainChatOf(
  sessions: Session[],
  activeTabByWorkspace: Record<string, string>,
  workspaceId: string
): Session | null {
  const chats = sessions.filter((s) => s.workspaceId === workspaceId && !s.sideOf)
  return chats.find((s) => s.id === activeTabByWorkspace[workspaceId]) ?? chats.at(-1) ?? null
}

/** Opens a fresh side chat beside `main`; the previous side chat of that workspace is closed. */
export async function startSideChat(main: Session, agent: ChatAgentId, contextMessages: number): Promise<void> {
  const previous = sideChatOf(getState().sessions, main.workspaceId)
  const info = await harnessRequest(
    HARNESS_METHODS.sideChatCreate,
    { sessionId: main.id, contextMessages, ...(agent !== 'claude' ? { agent } : {}) },
    main.hostId
  )
  // The host's broadcast may have brought it (and its replay) in already; re-adding would wipe that.
  if (!getState().sessions.some((s) => s.id === info.id)) {
    // addSession makes it the workspace's active tab; a side chat has none, so the old one returns.
    const activeTab = getState().activeSessionByWorkspace[main.workspaceId]
    addSession({ ...info, hostId: main.hostId, workspaceId: main.workspaceId, items: [], loaded: false })
    if (activeTab) selectTab(main.workspaceId, activeTab)
  }
  if (previous) closeSession(previous.id)
}

/** Puts side-chat text into the main chat's composer and brings that chat forward; nothing is sent. */
export function sendToMainChat(main: Session, text: string): void {
  appendToDraft(main.id, text.trim())
  selectTab(main.workspaceId, main.id)
}

/**
 * Puts `quote` in the composer of the side chat beside `main`, starting one (Claude, with recent
 * context) when that chat has none, and shows it; the user writes the question and sends.
 */
export async function askInSideChat(main: Session, quote: string): Promise<void> {
  setRightSidebar({ open: true, tab: 'side-chat' })
  const existing = sideChatOf(getState().sessions, main.workspaceId)
  if (existing?.sideOf !== main.id) await startSideChat(main, 'claude', SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES)
  const side = sideChatOf(getState().sessions, main.workspaceId)
  if (!side) return
  appendToDraft(side.id, quote)
  requestComposerFocus(side.id)
}
