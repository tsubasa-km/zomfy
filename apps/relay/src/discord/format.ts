// What the relay posts in Discord: message splitting, buttons and the phrases for outcomes
// (docs/specs/bots/sources/discord.md#threads-and-replies).

import type { Failure, Prompt, ReplyOutcome } from '../contract'

export const MESSAGE_LIMIT = 2000
/** Answers that would need more messages than this go as a `.md` attachment. */
export const MAX_REPLY_MESSAGES = 4
export const MAX_BUTTONS = 25
export const BUTTONS_PER_ROW = 5
export const CUSTOM_ID_LIMIT = 100
export const THREAD_NAME_LIMIT = 100

const FENCE = /^\s*(```|~~~)/

/**
 * Splits text into messages of at most `limit` characters, at paragraph boundaries where it can,
 * else at line ends, else hard. A code block cut in two is closed and opened again, so each part
 * renders on its own.
 */
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed ? [trimmed] : []
  const parts: string[] = []
  let current = ''
  let fence: string | null = null // the fence line that opened the block we are in
  const room = (extra: string) => current.length + extra.length + (fence ? 4 : 0) <= limit

  const flush = () => {
    if (!current.trim()) return
    parts.push(fence ? `${current.replace(/\n$/, '')}\n\`\`\`` : current.replace(/\n+$/, ''))
    current = fence ? `${fence}\n` : ''
  }

  for (const raw of trimmed.split('\n')) {
    let line = `${raw}\n`
    const isFence = FENCE.test(raw)
    // A blank line outside code is a paragraph boundary: a good place to cut when space runs low.
    if (!room(line)) flush()
    while (line.length + (fence ? fence.length + 5 : 0) > limit) {
      const take = limit - current.length - (fence ? 4 : 0)
      current += line.slice(0, Math.max(take, 1))
      line = line.slice(Math.max(take, 1))
      flush()
    }
    current += line
    if (isFence) fence = fence ? null : raw.trim()
    if (!fence && raw.trim() === '' && current.length > limit * 0.75) flush()
  }
  flush()
  return parts
}

/** A thread name from the first words of the request. */
export function threadName(text: string): string {
  const words = text.replace(/<[@#!&:a-z0-9_]+>/gi, '').replace(/\s+/g, ' ').trim()
  const name = words.length > THREAD_NAME_LIMIT - 1 ? `${words.slice(0, THREAD_NAME_LIMIT - 2)}…` : words
  return name || 'Zomfy'
}

export type Button = { type: 2; style: number; label: string; custom_id: string; disabled?: boolean }
export type Row = { type: 1; components: Button[] }

export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4 } as const

export function rows(buttons: Button[]): Row[] {
  const out: Row[] = []
  for (let i = 0; i < Math.min(buttons.length, MAX_BUTTONS); i += BUTTONS_PER_ROW) {
    out.push({ type: 1, components: buttons.slice(i, i + BUTTONS_PER_ROW) })
  }
  return out
}

const label = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text || '…')

/** custom_ids: `z1:<promptId>:<optionIndex>` for prompts, `z1s:<turnId>` for Stop, `z1r:<botId>` for access. */
export const customId = {
  option: (promptKey: string, index: number | 'z') => `z1:${promptKey}:${index}`,
  stop: (turnKey: string) => `z1s:${turnKey}`,
  access: (botId: string) => `z1r:${botId}`
}

export type ParsedCustomId =
  | { kind: 'option'; promptKey: string; index: number | 'zomfy' }
  | { kind: 'stop'; turnKey: string }
  | { kind: 'access'; botId: string }

export function parseCustomId(id: string): ParsedCustomId | null {
  if (id.startsWith('z1s:')) return { kind: 'stop', turnKey: id.slice(4) }
  if (id.startsWith('z1r:')) return { kind: 'access', botId: id.slice(4) }
  if (id.startsWith('z1:')) {
    const at = id.lastIndexOf(':')
    const promptKey = id.slice(3, at)
    const index = id.slice(at + 1)
    if (!promptKey) return null
    if (index === 'z') return { kind: 'option', promptKey, index: 'zomfy' }
    if (/^\d+$/.test(index)) return { kind: 'option', promptKey, index: Number(index) }
  }
  return null
}

/** A key that fits a custom_id: the id itself when short enough, else `#<n>`. */
export function shortKey(id: string, fallback: number, extra = 8): string {
  return id.length + extra <= CUSTOM_ID_LIMIT && !id.includes(':') ? id : `#${fallback}`
}

export function stopRow(turnKey: string): Row[] {
  return rows([{ type: 2, style: ButtonStyle.Danger, label: 'Stop', custom_id: customId.stop(turnKey) }])
}

export function accessRow(botId: string): Row[] {
  return rows([{ type: 2, style: ButtonStyle.Primary, label: 'Request access', custom_id: customId.access(botId) }])
}

function optionStyle(kind: string | undefined, labelText: string): number {
  const k = `${kind ?? ''} ${labelText}`.toLowerCase()
  if (/deny|reject|cancel/.test(k)) return ButtonStyle.Danger
  if (/allow|approve|accept|yes/.test(k)) return ButtonStyle.Success
  return ButtonStyle.Secondary
}

/** The message showing a question or approval, with one button per option and Answer in Zomfy. */
export function promptMessage(prompt: Prompt, promptKey: string, botName: string): { content: string; components: Row[] } {
  if (prompt.kind === 'unsupported') {
    return { content: `**${botName}** needs you in Zomfy:\n${prompt.text}`, components: [] }
  }
  const options = prompt.options.slice(0, MAX_BUTTONS - 1)
  const buttons: Button[] = options.map((o, i) => ({
    type: 2,
    style: optionStyle(o.kind, o.label),
    label: label(o.label),
    custom_id: customId.option(promptKey, i)
  }))
  buttons.push({ type: 2, style: ButtonStyle.Secondary, label: 'Answer in Zomfy', custom_id: customId.option(promptKey, 'z') })
  const content =
    prompt.kind === 'approval'
      ? `**${botName}** asks to use **${prompt.tool}**:\n${prompt.summary}`
      : `${prompt.header ? `**${prompt.header}**\n` : ''}${prompt.text}${prompt.byReply ? '\n-# Reply in this thread to answer.' : ''}`
  return { content: content.slice(0, MESSAGE_LIMIT), components: rows(buttons) }
}

export function statusText(text?: string, steps?: { text: string; status: string }[]): string {
  const running = steps?.find((s) => s.status === 'running')?.text
  const detail = text || running
  return detail ? `-# Working… ${detail}` : '-# Working…'
}

export function phraseFailure(failure: Failure | undefined): string {
  switch (failure?.category) {
    case 'signed_out':
      return 'The agent on the computer is signed out; sign in again in Zomfy.'
    case 'usage_limit':
      return failure.resetsAt
        ? `The agent hit its usage limit; it resumes <t:${Math.floor(failure.resetsAt / 1000)}:R>.`
        : 'The agent hit its usage limit.'
    case 'not_set_up':
      return 'This bot is not set up on the computer yet.'
    case 'folder_missing':
      return 'The bot’s home folder is missing on the computer.'
    case 'unconfirmed':
      return 'The computer could not confirm the request ran.'
    default:
      return failure?.category === 'agent_error' && failure.message ? `The agent failed: ${failure.message}` : 'The agent failed.'
  }
}

/** What a reply posts for its outcome; `null` posts nothing. */
export function replyText(outcome: ReplyOutcome, text: string, failure?: Failure): string | null {
  switch (outcome) {
    case 'answered':
      return text.trim() || 'Done.'
    case 'quiet':
      return text.trim() || null
    case 'failed':
      return text.trim() ? `${text.trim()}\n\n-# ${phraseFailure(failure)}` : phraseFailure(failure)
    case 'cancelled':
      return text.trim() ? `${text.trim()}\n\n-# Stopped.` : 'Stopped.'
    case 'interrupted':
      return text.trim() ? `${text.trim()}\n\n-# Interrupted.` : 'Interrupted.'
    case 'no_answer':
      return text.trim() || 'No answer.'
    default:
      return text.trim() || null
  }
}

/** What the status message becomes when a turn ends without a reply replacing it. */
export function endedText(outcome: ReplyOutcome): string {
  switch (outcome) {
    case 'cancelled':
      return 'Stopped.'
    case 'interrupted':
      return 'Interrupted.'
    case 'failed':
      return 'Failed.'
    default:
      return '-# Done.'
  }
}

export const NOTES = {
  expired: 'Your computer was offline; this expired.',
  refused: (bot: string) => `**${bot}** could not take this request.`,
  unsupported: (bot: string) => `**${bot}**’s computer cannot handle this yet; update Zomfy.`,
  noBots: 'No bots are set up on this relay yet. Create one in Zomfy and pair it with this relay.',
  unknownBot: (handles: string[]) =>
    `Which bot? Ask with \`@Zomfy <handle> …\`${handles.length ? `; bots here: ${handles.map((h) => `\`${h}\``).join(', ')}` : ''}.`,
  askOwner: (bot: string, ownerId?: string) =>
    `You can’t ask **${bot}** yet. Ask its owner${ownerId ? ` <@${ownerId}>` : ''} to add you in Zomfy, or request access.`,
  onlyAsker: (askerId: string | null) => `Only ${askerId ? `<@${askerId}>` : 'the person who asked'} or the bot’s owner can answer this.`,
  answerInZomfy: (bot: string) => `Open Zomfy to answer: the chat is in **${bot}**’s home.`,
  accessRequested: 'Access requested; the owner will see it in Zomfy.',
  accessAnswered: (bot: string, allowed: boolean) =>
    allowed ? `The owner let you ask **${bot}**; ask again whenever you like.` : `The owner declined your request to ask **${bot}**.`,
  asked: (bot: string) => `Asked **${bot}**.`,
  stopping: 'Stopping…'
}
