import type { Bot } from '@zomfy/protocol'

// `@<handle> …` at the very start of a prompt asks that bot in a new bot chat
// (docs/specs/bots/desktop.md#talking-to-a-bot-from-zomfy). Anywhere else, `@` is a file mention.

const LEADING_HANDLE = /^@([a-z0-9][a-z0-9_-]*)(?=\s|$)/i

/** The bot a prompt opens with and the words for it; null when the prompt does not start with a bot's handle. */
export function parseBotMention(text: string, bots: readonly Bot[]): { bot: Bot; text: string } | null {
  const match = LEADING_HANDLE.exec(text.trimStart())
  if (!match) return null
  const handle = match[1]!.toLowerCase()
  const bot = bots.find((b) => b.handle === handle)
  if (!bot) return null
  return { bot, text: text.trimStart().slice(match[0].length).trim() }
}
