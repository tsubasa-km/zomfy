// Harness extension methods carried over the ACP connection. ACP reserves `_`-prefixed method
// names for extensions, so these never collide with protocol methods. Each area keeps its types,
// method names and request shapes in its own file; this one only composes them.

import { AUTOMATION_METHODS, type AutomationRequests } from './automations'
import { CHAT_AGENT_METHODS, type ChatAgentRequests } from './chat-agents'
import { CHAT_ATTACHMENT_METHODS, type ChatAttachmentRequests } from './chat-attachments'
import { FILE_METHODS, type FileRequests } from './files'
import { GIT_METHODS, type GitRequests } from './git'
import { HOSTING_METHODS, type HostingRequests } from './hosting'
import { PLUGIN_METHODS, type PluginRequests } from './plugins'
import { PORT_METHODS, type PortRequests } from './ports'
import { PROJECT_LINK_METHODS, type ProjectLinkRequests } from './project-links'
import { WORKFLOW_METHODS, type WorkflowRequests } from './workflows'
import { WORKFLOW_AGENT_METHODS, type WorkflowAgentRequests } from './workflow-access'
import { WORKFLOW_EXPERIMENT_METHODS, type WorkflowExperimentRequests } from './workflow-experiments'
import { WORKFLOW_SUGGESTION_METHODS, type WorkflowSuggestionRequests } from './workflow-suggestions'
import { QUICK_OPEN_METHODS, type QuickOpenRequests } from './quick-open'
import { SESSION_METHODS, type SessionRequests } from './sessions'
import { SESSION_NOTE_METHODS, type SessionNoteRequests } from './session-notes'
import { SETTINGS_METHODS, type SettingsRequests } from './settings'
import { SIDE_CHAT_METHODS, type SideChatRequests } from './side-chats'
import { SKILL_METHODS, type SkillRequests } from './skills'
import { TERMINAL_METHODS, type TerminalRequests } from './terminals'
import { TODO_METHODS, type TodoRequests } from './todos'
import { TURN_RECOVERY_METHODS, type TurnRecoveryRequests } from './turn-recovery'
import { VOICE_METHODS, type VoiceRequests } from './voice'
import { WORKSPACE_METHODS, type WorkspaceRequests } from './workspaces'

export * from './automation-schedules'
export * from './automations'
export * from './chat-agents'
export * from './chat-attachments'
export * from './files'
export * from './git'
export * from './hosting'
export * from './manager'
export * from './plugins'
export * from './ports'
export * from './project-links'
export * from './quick-open'
export * from './sessions'
export * from './session-notes'
export * from './settings'
export * from './side-chats'
export * from './skills'
export * from './terminals'
export * from './todos'
export * from './tui-agents'
export * from './turn-recovery'
export * from './voice'
export * from './workspaces'
export * from './workflows'
export * from './workflow-access'
export * from './workflow-scorecard'
export * from './workflow-experiments'
export * from './workflow-suggestions'

export const HARNESS_METHODS = {
  ...WORKSPACE_METHODS,
  ...SESSION_METHODS,
  ...SESSION_NOTE_METHODS,
  ...TERMINAL_METHODS,
  ...FILE_METHODS,
  ...GIT_METHODS,
  ...HOSTING_METHODS,
  ...SETTINGS_METHODS,
  ...QUICK_OPEN_METHODS,
  ...PORT_METHODS,
  ...CHAT_AGENT_METHODS,
  ...CHAT_ATTACHMENT_METHODS,
  ...TODO_METHODS,
  ...SIDE_CHAT_METHODS,
  ...AUTOMATION_METHODS,
  ...SKILL_METHODS,
  ...PLUGIN_METHODS,
  ...VOICE_METHODS,
  ...TURN_RECOVERY_METHODS,
  ...PROJECT_LINK_METHODS,
  ...WORKFLOW_METHODS,
  ...WORKFLOW_AGENT_METHODS,
  ...WORKFLOW_EXPERIMENT_METHODS,
  ...WORKFLOW_SUGGESTION_METHODS
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
    SessionNoteRequests,
    TerminalRequests,
    FileRequests,
    GitRequests,
    HostingRequests,
    SettingsRequests,
    QuickOpenRequests,
    PortRequests,
    ChatAgentRequests,
    ChatAttachmentRequests,
    TodoRequests,
    SideChatRequests,
    AutomationRequests,
    SkillRequests,
    PluginRequests,
    VoiceRequests,
    TurnRecoveryRequests,
    ProjectLinkRequests,
    WorkflowRequests,
    WorkflowAgentRequests,
    WorkflowExperimentRequests,
    WorkflowSuggestionRequests {}

export type HarnessMethod = keyof HarnessRequests
