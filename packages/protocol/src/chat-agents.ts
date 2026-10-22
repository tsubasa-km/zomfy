// Agents a chat tab can run. Claude runs in-process through the Agent SDK; every other agent is an
// external ACP server the daemon spawns on its own host (Orca's acp-launch-specs). Ids are the
// terminal catalog's (tui-agents.ts), so icons, labels and detection are shared.

import { tuiAgentSpec } from './tui-agents'

export const CHAT_AGENT_IDS = ['claude', 'codex', 'opencode', 'gemini', 'grok', 'copilot', 'qwen-code', 'goose', 'kimi'] as const
export type ChatAgentId = (typeof CHAT_AGENT_IDS)[number]

export function isChatAgentId(value: unknown): value is ChatAgentId {
  return typeof value === 'string' && CHAT_AGENT_IDS.some((id) => id === value)
}

export function chatAgentLabel(id: string): string {
  return tuiAgentSpec(id)?.label ?? id
}

/** `ready`: the ACP server runs here. `missing`: not on this host's PATH. `needs-adapter`: the CLI
 *  is installed but its ACP server is a separate program. `unsupported`: this release has no ACP mode. */
export type ChatAgentStatus = 'ready' | 'missing' | 'needs-adapter' | 'unsupported'

export interface ChatAgentInfo {
  id: ChatAgentId
  label: string
  status: ChatAgentStatus
  /** Why it is not ready, or the command line it starts with. */
  detail: string | null
  /** The agent's account folder variable (CODEX_HOME…), suggested in settings; null when it has none. */
  accountVariable: string | null
  /** Custom launch command for this host; null runs the catalog's. */
  command: string | null
  /** Environment variable names set for this agent on this host; values never leave the host. */
  envNames: string[]
}

/** One choice the agent's ACP server offers for a session (its model, effort, mode…). */
export interface ChatAgentOption {
  /** The ACP config option id; `harness/mode` and `harness/model` stand for ACP's session modes and models. */
  id: string
  name: string
  /** ACP's category: `model`, `thought_level`, `mode`, or the agent's own. */
  category: string | null
  currentValue: string
  choices: { value: string; name: string; description: string | null }[]
}

/** What an external agent's session reported about itself; absent on Claude sessions. */
export interface ChatAgentSessionState {
  phase: 'starting' | 'ready' | 'failed'
  error: string | null
  options: ChatAgentOption[]
  commands: { name: string; description: string; argumentHint: string }[]
}

export const CHAT_AGENT_OPTION_IDS = { mode: 'harness/mode', model: 'harness/model' } as const

export const CHAT_AGENT_METHODS = {
  chatAgentsList: '_harness/chatAgents/list',
  chatAgentSetLaunch: '_harness/chatAgents/setLaunch'
} as const

export interface ChatAgentRequests {
  [CHAT_AGENT_METHODS.chatAgentsList]: { params: { refresh?: boolean }; result: ChatAgentInfo[] }
  /** `env.value: null` removes the variable; `command: null` restores the catalog command. */
  [CHAT_AGENT_METHODS.chatAgentSetLaunch]: {
    params: { agent: ChatAgentId; command?: string | null; env?: { name: string; value: string | null } }
    result: ChatAgentInfo[]
  }
}
