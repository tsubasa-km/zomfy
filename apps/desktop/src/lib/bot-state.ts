import { BOT_NOTIFICATIONS, type Bot, type BotAccessRequest, type BotChatFrom, type BotNotice, type ConnectorStatus } from '@zomfy/protocol'
import type { Session } from '@/session-store'

// The bots state as pure functions, for the bots store and its tests (docs/specs/bots/desktop.md).

// This computer's host id (session-store's LOCAL_HOST): bots live on its daemon.
const LOCAL_HOST = 'local'

export interface BotsState {
  /** null until the daemon has answered; an older daemon with no bots stays null. */
  bots: Bot[] | null
  connector: ConnectorStatus | null
  accessRequests: BotAccessRequest[]
  /** Notices for the owner (a webhook refusing calls, or at its cap), shown in Needs you. */
  notices: BotNotice[]
  /** The Bots page the sidebar's Bots row opens. */
  pageOpen: boolean
  /** The bot Settings → Bots shows; null for the list. */
  selectedId: string | null
}

export const INITIAL_BOTS_STATE: BotsState = { bots: null, connector: null, accessRequests: [], notices: [], pageOpen: false, selectedId: null }

/** A bots notification applied to the state; unknown methods leave it as it was. */
export function reduceBotsNotification(state: BotsState, method: string, params: unknown): BotsState {
  switch (method) {
    case BOT_NOTIFICATIONS.botsChanged: {
      const bots = (params as { bots: Bot[] }).bots
      // A deleted bot's page closes back to the list.
      const selectedId = state.selectedId && bots.some((b) => b.id === state.selectedId) ? state.selectedId : null
      return { ...state, bots, selectedId }
    }
    case BOT_NOTIFICATIONS.connectorStatusChanged:
      return { ...state, connector: params as ConnectorStatus }
    case BOT_NOTIFICATIONS.accessRequestsChanged:
      return { ...state, accessRequests: (params as { requests: BotAccessRequest[] }).requests }
    case BOT_NOTIFICATIONS.noticesChanged:
      return { ...state, notices: (params as { notices: BotNotice[] }).notices }
    default:
      return state
  }
}

/** A bot's chats, newest first (bot chats on this computer only). */
export function botChats(sessions: readonly Session[], botId: string): Session[] {
  return sessions
    .filter((s) => s.hostId === LOCAL_HOST && s.origin === 'bot' && s.botId === botId && !s.parentId && !s.archived)
    .sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt))
}

export type BotActivity = 'paused' | 'waiting' | 'running' | 'idle'

/** The dot beside a bot: waiting on the person beats running; a paused bot says so. */
export function botActivity(bot: Bot, sessions: readonly Session[]): BotActivity {
  const mine = sessions.filter((s) => s.hostId === LOCAL_HOST && s.origin === 'bot' && s.botId === bot.id)
  if (mine.some((s) => s.status === 'needs-you')) return 'waiting'
  if (mine.some((s) => s.status === 'working')) return 'running'
  return bot.paused ? 'paused' : 'idle'
}


/**
 * The browser link to the thread a bot chat was asked from, when the source's id says where it is.
 * Discord ids (docs/specs/bots/sources/discord.md): `<guild>:<channel>:<message>` for a mention,
 * whose thread has the message's id; `@me:<dm>:<message>` for a DM; `…:i<interaction>` for `/ask`.
 */
export function botFromLink(from: BotChatFrom | undefined): string | null {
  if (!from?.externalId) return null
  if (from.source === 'discord') {
    const [place, channel, message] = from.externalId.split(':')
    if (!place || !channel) return null
    if (place === '@me' || !message || message.startsWith('i')) return `https://discord.com/channels/${place}/${channel}`
    return `https://discord.com/channels/${place}/${message}`
  }
  if (/^https:\/\//.test(from.externalId)) return from.externalId
  return null
}
