import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { getState } from '@/session-store'
import { forkChat } from '@/chat-actions'

/** Chat commands for the palette and shortcuts editor; they act on the active workspace's chat tab. */
export function installChatCommands(): void {
  registerKeybindingDefinitions([
    {
      id: 'chat.fork',
      title: 'Fork Chat',
      group: 'Chat',
      keywords: ['fork', 'branch', 'copy', 'duplicate', 'conversation', 'session'],
      defaultBindings: []
    }
  ])
  registerCommandHandler('chat.fork', () => {
    const state = getState()
    const tabId = state.activeWorkspaceId ? state.activeSessionByWorkspace[state.activeWorkspaceId] : undefined
    // A non-Claude chat gets the reason as a notice in its transcript (forkChat says why).
    if (tabId && state.sessions.some((s) => s.id === tabId)) void forkChat(tabId)
  })
}
