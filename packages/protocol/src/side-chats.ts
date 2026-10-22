// Side chats: a short-lived chat beside a workspace's main conversation (Claude Code's /btw). It is
// an ordinary session the daemon runs, marked with `sideOf` so tab strips leave it out.

import type { ChatAgentId } from './chat-agents'
import type { SessionInfo } from './sessions'

/** How many of the main chat's latest messages a new side chat sees, unless the request says. */
export const SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES = 8

export const SIDE_CHAT_METHODS = {
  sideChatCreate: '_harness/sideChats/create'
} as const

export interface SideChatRequests {
  /**
   * Opens a side chat in the main chat's workspace. Its first turn carries the main chat's last
   * `contextMessages` messages (0 for none); Claude side chats start on low effort.
   */
  [SIDE_CHAT_METHODS.sideChatCreate]: {
    params: { sessionId: string; agent?: ChatAgentId; contextMessages?: number }
    result: SessionInfo
  }
}
