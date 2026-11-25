// Agents a chat tab can run. Claude uses the Agent SDK. The daemon spawns the other agents on
// their host and talks to them over ACP or, for Codex, App Server. Ids are the
// terminal catalog's (tui-agents.ts), so icons, labels and detection are shared.

import { tuiAgentSpec } from './tui-agents'

export const CHAT_AGENT_IDS = ['claude', 'codex', 'opencode', 'gemini', 'grok', 'copilot', 'qwen-code', 'goose', 'kimi', 'antigravity'] as const
export type ChatAgentId = (typeof CHAT_AGENT_IDS)[number]

export function isChatAgentId(value: unknown): value is ChatAgentId {
  return typeof value === 'string' && CHAT_AGENT_IDS.some((id) => id === value)
}

export function chatAgentLabel(id: string): string {
  return tuiAgentSpec(id)?.label ?? id
}

/**
 * Agents whose vendor forbids driving them from another app on consumer plans, and suspends accounts
 * that do (Antigravity's terms and FAQ). They run only after the person turns them on for the host,
 * and only in chats the person starts: never from automations, workflows, side chats or a switch of
 * a chat's agent, where another agent's conversation or a schedule would drive them.
 */
export const GUARDED_CHAT_AGENTS: readonly ChatAgentId[] = ['antigravity']

export function isGuardedChatAgent(id: string | null | undefined): boolean {
  return !!id && GUARDED_CHAT_AGENTS.some((g) => g === id)
}

/** What a chat is called until its first message names it. Windows show it in their own language. */
export const NEW_CHAT_TITLE = 'New thread'
/** The same, from daemons that still called a thread a chat. */
export const LEGACY_NEW_CHAT_TITLE = 'New chat'

/** Whether a chat still has the name it was created with; older daemons named a new chat after its agent. */
export function isUntitledChat(title: string): boolean {
  return title === NEW_CHAT_TITLE || title === LEGACY_NEW_CHAT_TITLE || CHAT_AGENT_IDS.some((id) => chatAgentLabel(id) === title)
}

/** `ready`: the ACP server runs here. `missing`: not on this host's PATH. `needs-adapter`: the CLI
 *  is installed but its ACP server is a separate program. `unsupported`: this release has no ACP mode.
 *  `needs-consent`: a guarded agent (GUARDED_CHAT_AGENTS) the person has not turned on for this host. */
export type ChatAgentStatus = 'ready' | 'missing' | 'needs-adapter' | 'unsupported' | 'needs-consent'

export type CodexConnection = 'acp' | 'app-server'

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
  /** The vendor's page for installing the agent, or the part of it this host lacks. */
  installUrl?: string | null
  /** A newer release of one of the agent's npm packages, found by the daemon's periodic check. */
  update?: ChatAgentUpdate | null
  /** For a guarded agent: whether the person turned it on for this host. Absent on the others. */
  consent?: boolean
  /** Present when this daemon supports selecting how Codex connects. */
  codexConnection?: CodexConnection
  /** Claude only: whether this host's Claude chats start with Claude in Chrome (`--chrome`). Absent on older daemons. */
  claudeChrome?: boolean
}

export interface ChatAgentLaunchPatch {
  command?: string | null
  env?: { name: string; value: string | null }
  consent?: boolean
  codexConnection?: CodexConnection
  /** Claude only: turn Claude in Chrome on or off for this host's Claude chats. */
  claudeChrome?: boolean
}

export interface ChatAgentUpdate {
  /** The npm package with the newer release (`@openai/codex`, `@agentclientprotocol/codex-acp`…). */
  packageName: string
  installed: string
  latest: string
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

export const CHAT_AGENT_NOTIFICATIONS = {
  /** The host's agents, sent when its update check finds something new. */
  chatAgentsChanged: '_harness/chatAgents/changed'
} as const

export interface ChatAgentRequests {
  [CHAT_AGENT_METHODS.chatAgentsList]: { params: { refresh?: boolean }; result: ChatAgentInfo[] }
  /** `env.value: null` removes the variable; `command: null` restores the catalog command; `consent` turns a guarded agent on or off. */
  [CHAT_AGENT_METHODS.chatAgentSetLaunch]: {
    params: { agent: ChatAgentId } & ChatAgentLaunchPatch
    result: ChatAgentInfo[]
  }
}
