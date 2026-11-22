// Zomfy Bots (docs/specs/bots/daemon.md): named agents with a home folder on one host, asked from
// Zomfy and, through the person's own Zomfy Relay, from Discord, Slack, GitHub, Linear and webhooks.
// These are the methods the windows call; the daemon ↔ relay messages live in
// @zomfy/relay-contract.

import type { ChatAgentId } from './chat-agents'
import type { ChatPermissionMode } from './sessions'

export type BotSource = 'discord' | 'slack' | 'github' | 'linear'

export interface BotAsker {
  /** The person's id on that source. */
  id: string
  /** Shown in settings; the source's own display name when known. */
  name?: string
  role: 'owner' | 'member'
}

export interface Bot {
  id: string
  name: string
  /** Lower-case, unique per deployment: `@Zomfy reviewer …`. */
  handle: string
  avatar: string | null
  purpose: string | null
  agent: ChatAgentId
  model: string | null
  /** `default` (ask for approval) for new bots. */
  permissionMode: ChatPermissionMode
  homeWorkspaceId: string
  owner: Partial<Record<BotSource, string>>
  askers: Partial<Record<BotSource, BotAsker[]>>
  paused: boolean
  createdAt: number
  /**
   * The deployment's default bot: it takes a source message that names no bot by handle. At most
   * one bot is the default; absent from older daemons.
   */
  isDefault?: boolean
}

export type BotInput = Pick<Bot, 'name' | 'handle' | 'agent'> &
  Partial<Pick<Bot, 'avatar' | 'purpose' | 'model' | 'permissionMode' | 'owner' | 'askers' | 'isDefault'>> & {
    /** An existing workspace as the home; omitted: a new folder `~/zomfy/bots/<handle>`. */
    homeWorkspaceId?: string
    /** An existing folder or repository on this host as the home, when it is not a workspace yet. */
    homePath?: string
  }

export type ConnectorState =
  /** No relay configured: bots answer in Zomfy only. */
  | 'unpaired'
  | 'connecting'
  | 'online'
  /** Waiting to reconnect after a drop; `retryAt` says when. */
  | 'offline'
  /** The relay refused the host key (revoked or reset); pair again. */
  | 'unauthorized'

export interface ConnectorStatus {
  state: ConnectorState
  relayUrl: string | null
  hostId: string | null
  /** Sources the relay has secrets for, from its `/health`. */
  sources: string[]
  lastConnectedAt: number | null
  retryAt: number | null
  error: string | null
}

export interface BotAccessRequest {
  id: string
  botId: string
  source: BotSource
  requester: { id: string; name: string }
  message: string | null
  createdAt: number
}

export const BOT_METHODS = {
  botsList: '_harness/bots/list',
  botCreate: '_harness/bots/create',
  botUpdate: '_harness/bots/update',
  botDelete: '_harness/bots/delete',
  botPause: '_harness/bots/pause',
  botsConnectorStatus: '_harness/bots/connectorStatus',
  botsConnectorPair: '_harness/bots/connectorPair',
  botsConnectorUnpair: '_harness/bots/connectorUnpair',
  botAskers: '_harness/bots/askers',
  botsAccessRequests: '_harness/bots/accessRequests',
  botsAnswerAccessRequest: '_harness/bots/answerAccessRequest',
  /** A new chat with the bot in its home: the sidebar's New chat, or a `@handle …` prompt. */
  botChatCreate: '_harness/bots/chatCreate'
} as const

export const BOT_NOTIFICATIONS = {
  /** Every client hears the whole list after any change: `{ bots: Bot[] }`. */
  botsChanged: '_harness/bots/changed',
  /** A `ConnectorStatus`. */
  connectorStatusChanged: '_harness/bots/connectorStatusChanged',
  /** Pending access requests after one arrives or is answered: `{ requests: BotAccessRequest[] }`. */
  accessRequestsChanged: '_harness/bots/accessRequestsChanged'
} as const

export interface BotNotifications {
  [BOT_NOTIFICATIONS.botsChanged]: { bots: Bot[] }
  [BOT_NOTIFICATIONS.connectorStatusChanged]: ConnectorStatus
  [BOT_NOTIFICATIONS.accessRequestsChanged]: { requests: BotAccessRequest[] }
}

export interface BotRequests {
  [BOT_METHODS.botsList]: { params: Record<string, never>; result: { bots: Bot[] } }
  [BOT_METHODS.botCreate]: { params: { input: BotInput }; result: Bot }
  [BOT_METHODS.botUpdate]: { params: { id: string; patch: Partial<Omit<BotInput, 'homeWorkspaceId'>> }; result: Bot }
  /** Removes the record; the home folder and its chats stay unless `deleteHome` (a folder Zomfy made only). */
  [BOT_METHODS.botDelete]: { params: { id: string; deleteHome?: boolean }; result: Record<string, never> }
  [BOT_METHODS.botPause]: { params: { id: string; paused: boolean }; result: Bot }
  [BOT_METHODS.botsConnectorStatus]: { params: Record<string, never>; result: ConnectorStatus }
  /** Registers this host with the relay (setup code or host invite) and connects. */
  [BOT_METHODS.botsConnectorPair]: {
    params: { relayUrl: string; setupCode?: string; invite?: string; hostName?: string }
    result: ConnectorStatus
  }
  /** Forgets the relay and the host key locally. */
  [BOT_METHODS.botsConnectorUnpair]: { params: Record<string, never>; result: ConnectorStatus }
  [BOT_METHODS.botAskers]: {
    params: { id: string; source: BotSource; askers: BotAsker[] }
    result: Bot
  }
  [BOT_METHODS.botsAccessRequests]: { params: Record<string, never>; result: { requests: BotAccessRequest[] } }
  [BOT_METHODS.botsAnswerAccessRequest]: {
    params: { id: string; allow: boolean }
    result: Record<string, never>
  }
  /**
   * Opens a chat with `origin: 'bot'` in the bot's home. With `text`, the daemon runs it as the
   * chat's first turn (its approvals go to any open window); without, the window sends the first
   * prompt itself. `fromSessionId` is the chat a `@handle …` prompt was typed in.
   */
  [BOT_METHODS.botChatCreate]: {
    params: { id: string; text?: string; fromSessionId?: string }
    result: { sessionId: string }
  }
}
