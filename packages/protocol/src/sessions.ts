import type { ChatAgentId, ChatAgentSessionState } from './chat-agents'
import type { SessionRole } from './manager'
import type { AutoResumeState } from './turn-recovery'
import type { TerminalInfo } from './terminals'

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
  /** When a turn last started or ended, for ordering chats by recency; absent from older daemons and until the first turn. */
  lastActivityAt?: number
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
  /**
   * The chat this one works for: a workflow step's chat sits under the chat that started the run.
   * One level only, so a parent never has a parent of its own. A side chat's parent is `sideOf`.
   */
  parentId?: string
  /** Set while the daemon will resume this chat after a usage limit; absent from older daemons. */
  autoResume?: AutoResumeState | null
  /** Claude's guess at the next prompt, offered as the composer's Tab completion; cleared by the next turn. */
  promptSuggestion?: string | null
  /** A workflow step's chat that works with local-only data: never relayed to the Lead or read by its tools. */
  localOnly?: boolean
  /** Hidden from the sidebar and tab strip until unarchived; absent from older daemons. */
  archived?: boolean
  /** 'workflow' for a chat a workflow run made for one of its steps or helpers; the sidebar leaves those out unless asked. */
  origin?: 'workflow'
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

/**
 * A conversation an agent's own CLI recorded on this host (Claude Code, Codex, an ACP agent that
 * lists its sessions), shown by a thread or not.
 */
export interface PastConversation {
  /** The agent that recorded it. Absent from older daemons, which list Claude's only. */
  agent?: ChatAgentId
  /** The agent's own id for the conversation. Absent from older daemons (see `claudeSessionId`). */
  conversationId?: string
  /** The same id, under the name windows read before other agents' conversations were listed. */
  claudeSessionId: string
  title: string
  lastModified: number
  gitBranch: string | null
  /** The folder it ran in, when the agent recorded one. Absent from older daemons. */
  cwd?: string | null
  /** The workspace whose folder that is, if any: where importing it puts the thread. */
  workspaceId?: string | null
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
  contextUsage: 'harness/contextUsage',
  /** notice: the chat's agent changed here (AgentSwitchMeta). */
  agentSwitch: 'harness/agentSwitch',
  /** session/request_permission response: the person's answers to an AskUserQuestion (QuestionAnswers). */
  answers: 'harness/answers'
} as const

/**
 * The options of an AskUserQuestion permission request: answering it sends `QuestionAnswers` on the
 * response's `_meta`, skipping it tells the agent the person declined.
 */
export const QUESTION_OPTION_IDS = {
  answer: 'answer',
  skip: 'reject'
} as const

/** The person's answers to an agent's questions, keyed by each question's text. */
export interface QuestionAnswers {
  /** The picked option's label, several joined by ", ", or the person's own words. */
  answers: Record<string, string>
}

/** Which agent a chat left and which took over, on the notice that marks the change in its transcript. */
export interface AgentSwitchMeta {
  from: ChatAgentId
  to: ChatAgentId
  /** `to` ran this chat before and picks its own conversation back up, told only what it missed. */
  resumed?: boolean
}

/**
 * `_meta` keys that let a window splice a `session/load` replay with the live updates that raced it.
 * Older daemons send none, and the window then applies what it got in arrival order.
 */
export const SESSION_REPLAY_META = {
  /** session/update (live): the update's place in its session's transcript, counted by this daemon run. */
  seq: 'harness/seq',
  /** session/update: part of a `session/load` replay, not a live update. */
  replay: 'harness/replay',
  /** session/load response: the last `seq` the replay holds; live updates up to it are already in it. */
  replayedThrough: 'harness/replayedThrough',
  /**
   * session/load request: true asks for the replay inside the response (`updates`) rather than as one
   * notification per update, which a long chat makes thousands of messages. A daemon that predates
   * it ignores it and notifies as before.
   */
  inResponse: 'harness/replayInResponse',
  /** session/load response to `inResponse`: the replayed updates, in order. */
  updates: 'harness/replayUpdates'
} as const

export interface ContextUsageMeta {
  estimated: boolean
  /**
   * The window's rows. Without `kind` (older daemons) a row is content in the window; newer daemons
   * also send the free space, the autocompact buffer and the deferred tools (out of the window).
   */
  categories: { name: string; tokens: number; id?: string; kind?: 'used' | 'free' | 'buffer' | 'deferred' }[]
  /** Claude: each skill, MCP server, memory file and subagent in the context (absent from older daemons). */
  items?: { kind: 'skill' | 'mcp' | 'memory' | 'agent'; name: string; tokens: number }[]
  /** Claude: each MCP tool, and whether its schema is loaded or deferred (absent from older daemons). */
  mcpTools?: { name: string; server: string; tokens: number; loaded: boolean }[]
  /** Claude: each memory file (CLAUDE.md, AGENTS.md, auto-memory) in the context (absent from older daemons). */
  memoryFiles?: { path: string; type: string; tokens: number }[]
}

/**
 * Set (true) in a prompt reply's `_meta` when no turn ran for the prompt (its conversation is open in
 * a Claude terminal, its chat is a split's helper at work, or it was stopped while it waited): the
 * message was not sent and goes back to its box.
 */
export const PROMPT_NOT_SENT_META = 'acp-harness/notSent'

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
  sessionConsultLead: '_harness/sessions/consultLead',
  /** Absent from older daemons: the request fails as an unknown method. */
  sessionRename: '_harness/sessions/rename',
  sessionSetArchived: '_harness/sessions/setArchived',
  sessionSetAgent: '_harness/sessions/setAgent',
  /** Absent from older daemons: the request fails as an unknown method. */
  sessionContinueInTerminal: '_harness/sessions/continueInTerminal'
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
  /**
   * The conversations agents recorded on this host, newest first. `workspaceId` keeps those of that
   * workspace's folder; without it every folder's are listed (older daemons need it). `agents`
   * names whose to list; without it Claude's only, which is all an older daemon lists.
   */
  [SESSION_METHODS.sessionHistory]: {
    params: { workspaceId?: string; agents?: ChatAgentId[] }
    result: PastConversation[]
  }
  /**
   * Imports a listed conversation as a thread with its transcript, or returns the thread that
   * already shows it. `agent` defaults to Claude, and `claudeSessionId` is `conversationId` under
   * its older name. The thread goes to `workspaceId`, else to the workspace of the conversation's
   * own folder, which is added as a project when no workspace has it. In the conversation's own
   * folder the next message continues the agent's conversation itself; in any other, the agent
   * starts a new one and is handed a selection of the imported thread. The agent's files are only read.
   */
  [SESSION_METHODS.sessionResume]: {
    params: { workspaceId?: string; agent?: ChatAgentId; conversationId?: string; claudeSessionId?: string }
    result: SessionInfo
  }
  /** Workspace-relative paths for the composer's @ menu, gitignore respected. */
  [SESSION_METHODS.sessionMentionFiles]: { params: { workspaceId: string }; result: string[] }
  /** Sets one of an external agent's own session options (see ChatAgentOption). */
  [SESSION_METHODS.sessionSetAgentOption]: {
    params: { sessionId: string; optionId: string; value: string }
    result: SessionInfo
  }
  [SESSION_METHODS.sessionMove]: { params: MoveSessionParams; result: MoveSessionResult }
  /**
   * Opens a terminal in the chat's folder running the `claude` CLI on the chat's conversation
   * (`claude --resume`). The CLI is reported to use less of the person's usage limit than the Agent
   * SDK the chat runs on; the chat picks the conversation up again, terminal turns included, on its next prompt.
   */
  [SESSION_METHODS.sessionContinueInTerminal]: { params: { sessionId: string }; result: TerminalInfo }
  /** Queues a line the session's next turn starts with, unseen in its transcript (a lead's project activity). */
  [SESSION_METHODS.sessionAddContext]: { params: { sessionId: string; text: string }; result: Record<string, never> }
  /** Puts a session's question to another chat (a run's starting chat) as a turn of its own, once it is free: an answer, or the question for the person. */
  [SESSION_METHODS.sessionConsultLead]: {
    params: { leadSessionId: string; from: string; question: string }
    result: LeadConsultResult
  }
  /** A blank title is refused. */
  [SESSION_METHODS.sessionRename]: { params: { sessionId: string; title: string }; result: SessionInfo }
  [SESSION_METHODS.sessionSetArchived]: { params: { sessionId: string; archived: boolean }; result: SessionInfo }
  /**
   * Replaces the agent behind a chat; its transcript, title and place stay. The new agent gets a
   * selection of the conversation as text with its next prompt, not the old agent's own context.
   * Refused while a turn runs, and a no-op for the agent the chat already has. `permissionMode`: the
   * mode Claude starts in when it has not answered in this chat before. Absent from older daemons.
   */
  [SESSION_METHODS.sessionSetAgent]: {
    params: { sessionId: string; agent: ChatAgentId; permissionMode?: ChatPermissionMode }
    result: SessionInfo
  }
}
