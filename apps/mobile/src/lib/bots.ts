// The phone's side of Zomfy Bots (docs/specs/mobile/bots.md): which bots a host has, each bot's
// recent chats, how a bot and a bot chat are shown, and starting a chat with a bot from a first
// message. No React Native imports, so it is tested with bun.

import { BOT_METHODS, type Bot, type DeviceScope, type SessionInfo } from '@zomfy/protocol'

export const RECENT_BOT_CHATS = 5

/** A picture for an `http(s):` or `data:image/` avatar; otherwise one or two characters. */
export type BotAvatarView = { kind: 'image'; uri: string } | { kind: 'text'; text: string }

export function botAvatar(bot: Pick<Bot, 'name' | 'handle' | 'avatar'>): BotAvatarView {
  const avatar = bot.avatar?.trim() ?? ''
  if (/^(https?:|data:image\/)/.test(avatar)) return { kind: 'image', uri: avatar }
  if (avatar) return { kind: 'text', text: [...avatar].slice(0, 2).join('') }
  return { kind: 'text', text: (bot.name.trim()[0] ?? bot.handle[0] ?? '?').toUpperCase() }
}

/** The same colour for a handle every time, from a short fixed palette. */
const PALETTE = ['#5b7cfa', '#2fa37a', '#c0682f', '#a05bd6', '#d1495b', '#2f8fb3', '#8a8f2f']
export function botColour(handle: string): string {
  let hash = 0
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]!
}

/** The bot a chat belongs to, when it is a bot chat of a bot this host still has. */
export function botOfChat(chat: Pick<SessionInfo, 'origin' | 'botId'>, bots: readonly Bot[] | null): Bot | null {
  if (chat.origin !== 'bot' || !chat.botId || !bots) return null
  return bots.find((b) => b.id === chat.botId) ?? null
}

const recency = (s: SessionInfo): number => s.lastActivityAt ?? s.createdAt

/** Each bot's chats, newest first, archived ones left out, at most `limit` each. */
export function recentBotChats(sessions: readonly SessionInfo[], limit = RECENT_BOT_CHATS): Map<string, SessionInfo[]> {
  const byBot = new Map<string, SessionInfo[]>()
  for (const s of sessions) {
    if (s.origin !== 'bot' || !s.botId || s.archived) continue
    const list = byBot.get(s.botId) ?? []
    list.push(s)
    byBot.set(s.botId, list)
  }
  for (const [id, list] of byBot) byBot.set(id, list.sort((a, b) => recency(b) - recency(a)).slice(0, limit))
  return byBot
}

/** Bots in the order the Bots screen lists them: the default first, then by name. */
export const sortBots = (bots: readonly Bot[]): Bot[] =>
  [...bots].sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false) || a.name.localeCompare(b.name))

/** Whether this phone may start a chat with the bot. */
export const canTalk = (bot: Pick<Bot, 'paused'>, scopes: readonly DeviceScope[]): boolean =>
  !bot.paused && scopes.includes('chats:operate')

export const NOTHING_TO_SEND = 'Nothing to send'

/** Starts a bot chat with `text` as its first turn (the daemon runs it) and returns the chat's id. */
export async function startBotChat(
  connection: { request<T>(method: string, params?: unknown): Promise<T> },
  botId: string,
  text: string
): Promise<string> {
  const prompt = text.trim()
  if (!prompt) throw new Error(NOTHING_TO_SEND)
  const { sessionId } = await connection.request<{ sessionId: string }>(BOT_METHODS.botChatCreate, { id: botId, text: prompt })
  return sessionId
}
