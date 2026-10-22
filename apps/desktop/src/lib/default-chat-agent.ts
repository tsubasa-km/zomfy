import { isChatAgentId, type ChatAgentId } from '@acp-harness/protocol'
import { getSetting } from '@/stores/settings-store'

/** The agent new chats start with (Orca's defaultTuiAgent), set by onboarding or Settings › Agents. */
export function defaultChatAgent(): ChatAgentId {
  const saved = getSetting('defaultChatAgent')
  return isChatAgentId(saved) ? saved : 'claude'
}
