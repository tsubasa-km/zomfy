import type { ChatAgentId, ChatAgentSessionState } from './chat-agents'
import type { SessionRole } from './manager'
import type { AutoResumeState } from './turn-recovery'

/** The execution host owns session status; clients only present it (Orca's agent-status rule). */
export type SessionStatus = 'idle' | 'working' | 'needs-you' | 'error'

/** Claude's permission modes, as the Agent SDK names them. */
export type ChatPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions'
export type ChatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** What the next turn launches with; null leaves the choice to Claude's own settings. */
export interface SessionOptions {
  model: string | null
  permissionMode: ChatPermissionMode
  effort: ChatEffort | null
}

export interface SessionInfo {
  id: string
  /** null for sessions an outside ACP client opened by cwd alone. */
  workspaceId: string | null
  cwd: string
  title: string
  status: SessionStatus
  createdAt: number
  /** Set while a turn runs. */
  turnStartedAt: number | null
  /** Absent from daemons that predate composer options. */
  options?: SessionOptions
  /** The agent the session runs; absent (older daemons) means Claude. */
  agent?: ChatAgentId
  /** An external ACP agent's own options and commands; absent on Claude sessions. */
  agentState?: ChatAgentSessionState
  /** 'manager' for the Manager chat, which gets the orchestration system prompt. */
  role?: SessionRole
  /** Set on a side chat: the main chat it was opened beside. Tab strips leave side chats out. */
  sideOf?: string
  /** Set while the daemon will resume this chat after a usage limit; absent from older daemons. */
  autoResume?: AutoResumeState | null
  /** Claude's guess at the next prompt, offered as the composer's Tab completion; cleared by the next turn. */
  promptSuggestion?: string | null
  /** A workflow step's chat that works with local-only data: never relayed to the Lead or read by its tools. */
  localOnly?: boolean
}

export interface ChatModel {
  value: string
  displayName: string
  description: string
  efforts: ChatEffort[]
  supportsAutoMode?: boolean
}

export interface ChatCommand {
  name: string
  description: string
  argumentHint: string
  /** Claude Code's own command, not one from the user, project, a plugin or an MCP server. */
  builtin?: boolean
}

/** Claude's `/` menu and model list for a folder, read without running a turn. */
export interface ChatCatalog {
  models: ChatModel[]
  commands: ChatCommand[]
}

/** A Claude conversation on disk for this folder, open in a tab or not. */
export interface PastConversation {
  claudeSessionId: string
  title: string
  lastModified: number
  gitBranch: string | null
  /** The harness session already showing it, if any. */
  openSessionId: string | null
}

/** `_meta` keys the daemon puts on ACP updates for this UI; other clients ignore them. */
export const CHAT_META = {
  /** tool_call: Claude's tool name (TodoWrite, Task, Edit…). */
  toolName: 'harness/toolName',
  /** tool_call: the Task call whose subagent made this call. */
  parentToolCallId: 'harness/parentToolCallId',
  /** usage_update: per-category breakdown and whether it is an estimate. */
  contextUsage: 'harness/contextUsage'
} as const

export interface ContextUsageMeta {
  estimated: boolean
  categories: { name: string; tokens: number }[]
  /** Claude: each skill, MCP server, memory file and subagent in the context (absent from older daemons). */
  items?: { kind: 'skill' | 'mcp' | 'memory' | 'agent'; name: string; tokens: number }[]
}

export const SESSION_METHODS = {
  sessionsList: '_harness/sessions/list',
  sessionCreate: '_harness/sessions/create',
  sessionClose: '_harness/sessions/close',
  sessionSetOptions: '_harness/sessions/setOptions',
  sessionCatalog: '_harness/sessions/catalog',
  sessionFork: '_harness/sessions/fork',
  sessionRewind: '_harness/sessions/rewind',
  sessionHistory: '_harness/sessions/history',
  sessionResume: '_harness/sessions/resume',
  sessionMentionFiles: '_harness/sessions/mentionFiles',
  sessionSetAgentOption: '_harness/sessions/setAgentOption',
  sessionMove: '_harness/sessions/move',
  sessionAddContext: '_harness/sessions/addContext',
  sessionConsultLead: '_harness/sessions/consultLead'
} as const

/** What a chat made of a question put to it by another session (sessionConsultLead). */
export type LeadConsultResult = { answer: string } | { escalate: string }

/** Moves a Claude chat into another workspace on the same host; exactly one target. */
export interface MoveSessionParams {
  sessionId: string
  workspaceId?: string
  /** A folder on the host: its workspace, or added as a project when it is none yet. */
  folder?: string
}

export interface MoveSessionResult {
  session: SessionInfo
  /** The target's workspace, which may have just been added. */
  workspaceId: string
  /** false while a turn runs: the chat moves when it ends and then continues there by itself. */
  moved: boolean
}

export interface SessionRequests {
  [SESSION_METHODS.sessionsList]: { params: Record<string, never>; result: SessionInfo[] }
  /** `agent` defaults to Claude. */
  [SESSION_METHODS.sessionCreate]: {
    /** `permissionMode`: the mode a Claude chat starts in (older daemons start in 'default'). */
    params: { workspaceId: string; agent?: ChatAgentId; role?: SessionRole; permissionMode?: ChatPermissionMode }
    result: SessionInfo
  }
  [SESSION_METHODS.sessionClose]: { params: { sessionId: string }; result: Record<string, never> }
  [SESSION_METHODS.sessionSetOptions]: {
    params: { sessionId: string; options: Partial<SessionOptions> }
    result: SessionInfo
  }
  [SESSION_METHODS.sessionCatalog]: { params: { workspaceId: string; refresh?: boolean }; result: ChatCatalog }
  /** A new tab continuing a copy of the conversation. */
  /** `fromMessageId`: the copy ends with that user message's exchange ("Fork from here"). */
  [SESSION_METHODS.sessionFork]: { params: { sessionId: string; fromMessageId?: string }; result: SessionInfo }
  /** Drops the conversation from this user message on; returns the message's text for the composer. */
  [SESSION_METHODS.sessionRewind]: { params: { sessionId: string; messageId: string }; result: { text: string } }
  [SESSION_METHODS.sessionHistory]: { params: { workspaceId: string }; result: PastConversation[] }
  [SESSION_METHODS.sessionResume]: { params: { workspaceId: string; claudeSessionId: string }; result: SessionInfo }
  /** Workspace-relative paths for the composer's @ menu, gitignore respected. */
  [SESSION_METHODS.sessionMentionFiles]: { params: { workspaceId: string }; result: string[] }
  /** Sets one of an external agent's own session options (see ChatAgentOption). */
  [SESSION_METHODS.sessionSetAgentOption]: {
    params: { sessionId: string; optionId: string; value: string }
    result: SessionInfo
  }
  [SESSION_METHODS.sessionMove]: { params: MoveSessionParams; result: MoveSessionResult }
  /** Queues a line the session's next turn starts with, unseen in its transcript (a lead's project activity). */
  [SESSION_METHODS.sessionAddContext]: { params: { sessionId: string; text: string }; result: Record<string, never> }
  /** Puts a session's question to another chat (a run's starting chat) as a turn of its own, once it is free: an answer, or the question for the person. */
  [SESSION_METHODS.sessionConsultLead]: {
    params: { leadSessionId: string; from: string; question: string }
    result: LeadConsultResult
  }
}
