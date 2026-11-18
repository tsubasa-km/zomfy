import { toast } from 'sonner'
import { getState, isFloating, selectSession, showQuickStart } from '@/session-store'
import { getSetting } from '@/stores/settings-store'
import { closeWorkspaceTabs } from '@/components/tab-layout/workspace-tab-model'
import { WINDOW_ROLE } from '@/lib/window-role'
import { t } from '@/i18n/i18n'

// "Send and move on": with the setting on, a sent message leaves its chat running in the background
// and the main view goes back to New Chat, ready for the next task. Chats keep their place in the
// sidebar, and the toast opens the one just sent to.

/** Whether a message sent now from a chat in this workspace should leave it for New Chat. */
export function returnsToNewChat(workspaceId: string, sideChat: boolean): boolean {
  if (getSetting('chatAfterSend') !== 'new-chat') return false
  // Only the main window's main view: side chats, the floating panel and popped-out workspaces stay.
  return WINDOW_ROLE === 'main' && !sideChat && !isFloating(workspaceId) && getState().activeWorkspaceId === workspaceId
}

/** Offers the chat just sent to, for a sender who wants to watch it after all. */
export function announceSent(sessionId: string): void {
  toast(t('Message sent. The thread keeps running in the sidebar.'), {
    action: { label: t('Open'), onClick: () => selectSession(sessionId) }
  })
}

/** Closes the chat's tab (the chat keeps running) and shows New Chat. */
export function leaveChatForNewChat(sessionId: string): void {
  const session = getState().sessions.find((s) => s.id === sessionId)
  if (!session) return
  closeWorkspaceTabs(session.workspaceId, [{ kind: 'chat', id: session.id, createdAt: session.createdAt, session }])
  showQuickStart()
  announceSent(sessionId)
}
