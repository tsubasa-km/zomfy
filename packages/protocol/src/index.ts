// Harness extension methods carried over the ACP connection. ACP reserves `_`-prefixed method
// names for extensions, so these never collide with protocol methods. Each area keeps its types,
// method names and request shapes in its own file; this one only composes them.

import { AUTOMATION_METHODS, type AutomationRequests } from './automations'
import { CHAT_AGENT_METHODS, type ChatAgentRequests } from './chat-agents'
import { FILE_METHODS, type FileRequests } from './files'
import { GIT_METHODS, type GitRequests } from './git'
import { HOSTING_METHODS, type HostingRequests } from './hosting'
import { PORT_METHODS, type PortRequests } from './ports'
import { QUICK_OPEN_METHODS, type QuickOpenRequests } from './quick-open'
import { SESSION_METHODS, type SessionRequests } from './sessions'
import { SETTINGS_METHODS, type SettingsRequests } from './settings'
import { SIDE_CHAT_METHODS, type SideChatRequests } from './side-chats'
import { TERMINAL_METHODS, type TerminalRequests } from './terminals'
import { TODO_METHODS, type TodoRequests } from './todos'
import { WORKSPACE_METHODS, type WorkspaceRequests } from './workspaces'

export * from './automation-schedules'
export * from './automations'
export * from './chat-agents'
export * from './files'
export * from './git'
export * from './hosting'
export * from './manager'
export * from './ports'
export * from './quick-open'
export * from './sessions'
export * from './settings'
export * from './side-chats'
export * from './terminals'
export * from './todos'
export * from './tui-agents'
export * from './workspaces'

export const HARNESS_METHODS = {
  ...WORKSPACE_METHODS,
  ...SESSION_METHODS,
  ...TERMINAL_METHODS,
  ...FILE_METHODS,
  ...GIT_METHODS,
  ...HOSTING_METHODS,
  ...SETTINGS_METHODS,
  ...QUICK_OPEN_METHODS,
  ...PORT_METHODS,
  ...CHAT_AGENT_METHODS,
  ...TODO_METHODS,
  ...SIDE_CHAT_METHODS,
  ...AUTOMATION_METHODS
} as const

export const HARNESS_NOTIFICATIONS = {
  stateChanged: '_harness/state/changed',
  sessionsChanged: '_harness/sessions/changed',
  terminalsChanged: '_harness/terminals/changed',
  terminalOutput: '_harness/terminals/output'
} as const

export interface HarnessRequests
  extends WorkspaceRequests,
    SessionRequests,
    TerminalRequests,
    FileRequests,
    GitRequests,
    HostingRequests,
    SettingsRequests,
    QuickOpenRequests,
    PortRequests,
    ChatAgentRequests,
    TodoRequests,
    SideChatRequests,
    AutomationRequests {}

export type HarnessMethod = keyof HarnessRequests
