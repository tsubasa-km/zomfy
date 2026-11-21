import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, chatAgentLabel, isChatAgentId, type AgentSwitchMeta, type ChatAgentId } from '@zomfy/protocol'
import { conversationMessages, type ConversationMessage } from './conversation-messages.ts'

// A chat whose agent was changed keeps its transcript; the agent that takes over knows none of it.
// It is handed the conversation as text with its next prompt: a selection the daemon makes from its
// own transcript, never the previous agent's context. Each change leaves a notice in the transcript
// (agentSwitchNotice), and those notices are the record of which agent ran which stretch.

/** The most conversation text a handoff carries; its few lines of instructions come on top. */
export const HANDOFF_CHAR_BUDGET = 24_000
/** One message longer than this keeps its start and end, so a pasted log cannot use up the budget. */
export const HANDOFF_MESSAGE_CHAR_LIMIT = 6_000
const MESSAGE_HEAD_CHARS = 4_000
const MESSAGE_TAIL_CHARS = 1_500
/** The newest messages are always kept, however long the conversation. */
const ALWAYS_RECENT = 2
const MAX_COMMANDS = 6
const COMMAND_CHAR_LIMIT = 160
const MAX_EDITS = 10

export const HANDOFF_OPEN = '<agent-handoff>'
export const HANDOFF_CLOSE = '</agent-handoff>'

const REPLY_UPDATES = new Set<acp.SessionUpdate['sessionUpdate']>(['agent_message_chunk', 'agent_thought_chunk', 'tool_call'])

/** A stretch of the transcript one agent ran: `transcript.slice(start, end)`. */
export interface AgentEra {
  agent: ChatAgentId
  start: number
  end: number
  /** The agent answered here, so its own conversation holds this stretch and whatever it was handed for it. */
  replied: boolean
}

/** The transcript's mark of an agent change; `returning` when `to` picks its own earlier conversation back up. */
export function agentSwitchNotice(from: ChatAgentId, to: ChatAgentId, returning: boolean): acp.SessionUpdate {
  const meta: AgentSwitchMeta = { from, to, ...(returning ? { resumed: true } : {}) }
  const [was, now] = [chatAgentLabel(from), chatAgentLabel(to)]
  return {
    sessionUpdate: 'notice',
    severity: 'info',
    title: returning
      ? `Switched from ${was} to ${now}. ${now} resumes its own conversation and gets a selection of what happened since, not ${was}'s full context.`
      : `Switched from ${was} to ${now}. ${now} gets a selection of this conversation, not ${was}'s full context.`,
    _meta: { [CHAT_META.agentSwitch]: meta }
  }
}

function agentSwitch(update: acp.SessionUpdate): AgentSwitchMeta | null {
  if (update.sessionUpdate !== 'notice') return null
  const meta: unknown = update._meta?.[CHAT_META.agentSwitch]
  if (typeof meta !== 'object' || meta === null) return null
  const { from, to } = meta as { from?: unknown; to?: unknown }
  return isChatAgentId(from) && isChatAgentId(to) ? { from, to } : null
}

/** Who ran each stretch of the transcript, in order; `current` is the chat's agent now. */
export function agentEras(transcript: readonly acp.SessionUpdate[], current: ChatAgentId): AgentEra[] {
  const first = transcript.map(agentSwitch).find((s) => s !== null)
  const eras: AgentEra[] = [{ agent: first?.from ?? current, start: 0, end: transcript.length, replied: false }]
  transcript.forEach((update, index) => {
    const era = eras.at(-1)
    if (!era) return
    const change = agentSwitch(update)
    if (change) {
      era.end = index
      eras.push({ agent: change.to, start: index + 1, end: transcript.length, replied: false })
    } else if (REPLY_UPDATES.has(update.sessionUpdate)) era.replied = true
  })
  const last = eras.at(-1)
  // The session record says who runs the chat now, whatever the last notice names.
  if (last) last.agent = current
  return eras
}

/** Whether `agent` answered in this chat before, so its own conversation holds part of it. */
export function answeredBefore(transcript: readonly acp.SessionUpdate[], current: ChatAgentId, agent: ChatAgentId): boolean {
  return agentEras(transcript, current).some((era) => era.agent === agent && era.replied)
}

export interface HandoffTarget {
  /** The chat's agent now. */
  agent: ChatAgentId
  cwd: string
  /** The agent still has its own conversation of this chat to pick up (Claude's session, an ACP session id). */
  resumes: boolean
}

/**
 * What the chat's agent must be told before its next prompt, or null when it is up to date: it took
 * over at the transcript's last agent change and has not answered since. An agent that ran this
 * chat before, and can resume that conversation, gets only what happened after it last answered;
 * any other gets a selection of the whole conversation.
 */
export function pendingHandoff(transcript: readonly acp.SessionUpdate[], target: HandoffTarget): string | null {
  const eras = agentEras(transcript, target.agent)
  const now = eras.at(-1)
  const before = eras.at(-2)
  if (!now || !before || now.replied) return null
  const own = target.resumes ? eras.slice(0, -1).findLast((era) => era.agent === target.agent && era.replied) : undefined
  const messages = attributedMessages(transcript, eras, own ? own.end : 0)
  if (messages.length === 0) return null
  const others = otherAgents(messages, target.agent)
  return handoffText({
    kind: own ? 'return' : 'takeover',
    from: others.length > 0 ? others : [before.agent],
    to: target.agent,
    cwd: target.cwd,
    messages
  })
}

/**
 * For an agent whose own conversation of this chat is gone (its server could not reopen it) and
 * that starts a new one: a selection of the whole conversation, its own earlier part included.
 */
export function restartHandoff(transcript: readonly acp.SessionUpdate[], target: Pick<HandoffTarget, 'agent' | 'cwd'>): string | null {
  const messages = attributedMessages(transcript, agentEras(transcript, target.agent), 0)
  if (messages.length === 0) return null
  const others = otherAgents(messages, target.agent)
  return handoffText({ kind: others.length > 0 ? 'takeover' : 'restart', from: others, to: target.agent, cwd: target.cwd, messages })
}

/**
 * For a thread imported from a conversation the agent recorded itself (its own CLI's) and cannot
 * reopen from here, such as one imported into another folder: a selection of the whole thread.
 */
export function importHandoff(
  transcript: readonly acp.SessionUpdate[],
  target: Pick<HandoffTarget, 'agent' | 'cwd'> & { origin: string | null }
): string | null {
  const messages = attributedMessages(transcript, agentEras(transcript, target.agent), 0)
  if (messages.length === 0) return null
  return handoffText({ kind: 'import', from: [], to: target.agent, cwd: target.cwd, messages, origin: target.origin })
}

/** The conversation from `since` on, each message with the agent that ran the chat then. */
function attributedMessages(transcript: readonly acp.SessionUpdate[], eras: AgentEra[], since: number): AttributedMessage[] {
  const messages: AttributedMessage[] = []
  for (const era of eras) {
    if (era.end <= since) continue
    for (const message of conversationMessages(transcript.slice(Math.max(era.start, since), era.end))) {
      messages.push({ ...message, agent: era.agent })
    }
  }
  return messages
}

function otherAgents(messages: AttributedMessage[], agent: ChatAgentId): ChatAgentId[] {
  return [...new Set(messages.filter((m) => m.role === 'Assistant' && m.agent !== agent).map((m) => m.agent))]
}

export interface AttributedMessage extends ConversationMessage {
  /** The agent that ran the chat when the message was written. */
  agent: ChatAgentId
}

export interface HandoffInput {
  /**
   * `takeover`: `to` continues other agents' work and knows none of it. `return`: `to` resumes its
   * own conversation of this chat, and `messages` is what it missed. `restart`: the conversation was
   * `to`'s alone, and it lost it. `import`: the conversation was `to`'s own, had outside this app and
   * imported as a thread it cannot reopen.
   */
  kind: 'takeover' | 'return' | 'restart' | 'import'
  /** The agents whose work the new one continues. */
  from: ChatAgentId[]
  to: ChatAgentId
  cwd: string
  messages: AttributedMessage[]
  /** `import`: the folder the conversation was had in, when it is another than `cwd`. */
  origin?: string | null
}

/** The block the agent's next prompt starts with. */
export function handoffText({ kind, from, to, cwd, messages, origin }: HandoffInput): string {
  const others = listOf(from.map(chatAgentLabel))
  const theirs = from.length === 1 ? `${others}'s` : 'their'
  const recorded = 'as the app hosting this chat (Zomfy) recorded it'
  const intro = {
    return: [
      `You are this chat's agent again (${chatAgentLabel(to)}). Since your last turn here the user went on with ${others}, in the same working directory: ${cwd}`,
      `Below is a selection of what was said and done since then, ${recorded}. It is not ${theirs} full context: reasoning and tool output are left out, and a long stretch is shortened. Files may have changed since you last read them.`
    ],
    takeover: [
      `You are taking over this conversation from ${others}: the user changed this chat's agent to you (${chatAgentLabel(to)}). Continue it in the same working directory: ${cwd}`,
      `Below is a selection of the conversation so far, ${recorded}. It is not ${theirs} full context: reasoning and tool output are left out, and a long conversation is shortened. Read files and run commands again when you need a detail that is not here.`
    ],
    restart: [
      `Your earlier conversation in this chat could not be reopened, so you (${chatAgentLabel(to)}) continue it in a new one, in the same working directory: ${cwd}`,
      `Below is a selection of the conversation so far, ${recorded}. It is not the context you had: reasoning and tool output are left out, and a long conversation is shortened. Read files and run commands again when you need a detail that is not here.`
    ],
    import: [
      `The user imported an earlier conversation they had with you (${chatAgentLabel(to)})${origin ? `, in ${origin},` : ''} into this app, and continues it here in a new one. Your working directory now: ${cwd}`,
      `Below is a selection of that conversation, as the app hosting this chat (Zomfy) read it from your own record. It is not the context you had: reasoning and tool output are left out, and a long conversation is shortened. Read files and run commands again when you need a detail that is not here.`
    ]
  }[kind]
  return [
    HANDOFF_OPEN,
    ...intro,
    "Do not answer this block itself. The user's next message follows it.",
    '',
    kind === 'return' ? 'The conversation since your last turn:' : 'The conversation so far:',
    '',
    selectWithinBudget(messages.map(renderMessage)).join('\n\n'),
    HANDOFF_CLOSE
  ].join('\n')
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'another agent'
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

interface Rendered {
  user: boolean
  text: string
}

function renderMessage(message: AttributedMessage): Rendered {
  const label = chatAgentLabel(message.agent)
  const lines = [message.role === 'User' ? 'User:' : `Assistant (${label}):`]
  const text = clip(message.text.trim())
  if (text) lines.push(text)
  if (message.commands.length > 0) {
    const shown = message.commands.slice(0, MAX_COMMANDS).map((c) => oneLine(c, COMMAND_CHAR_LIMIT))
    lines.push(`[${label} ran: ${shown.join(' ; ')}${more(message.commands.length - shown.length)}]`)
  }
  if (message.edits.length > 0) {
    const shown = message.edits.slice(0, MAX_EDITS)
    lines.push(`[${label} changed: ${shown.join(', ')}${more(message.edits.length - shown.length)}]`)
  }
  return { user: message.role === 'User', text: lines.join('\n') }
}

function more(count: number): string {
  return count > 0 ? ` (+${count} more)` : ''
}

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function clip(text: string): string {
  if (text.length <= HANDOFF_MESSAGE_CHAR_LIMIT) return text
  const dropped = text.length - MESSAGE_HEAD_CHARS - MESSAGE_TAIL_CHARS
  return `${text.slice(0, MESSAGE_HEAD_CHARS)}\n[… ${dropped} characters left out …]\n${text.slice(-MESSAGE_TAIL_CHARS)}`
}

/**
 * The first user request and as many of the newest messages as fit the budget, in order, with a
 * line where messages were left out.
 */
function selectWithinBudget(rendered: Rendered[]): string[] {
  const keep = new Set<number>()
  let used = 0
  const take = (index: number): void => {
    const message = rendered[index]
    if (!message || keep.has(index)) return
    keep.add(index)
    used += message.text.length
  }
  take(rendered.findIndex((m) => m.user))
  for (let index = rendered.length - 1; index >= 0; index--) {
    if (keep.has(index)) continue
    const message = rendered[index]
    if (!message) break
    const recent = rendered.length - index <= ALWAYS_RECENT
    // The kept tail is unbroken: the first message that does not fit ends it.
    if (!recent && used + message.text.length > HANDOFF_CHAR_BUDGET) break
    take(index)
  }
  const out: string[] = []
  let omitted = 0
  rendered.forEach((message, index) => {
    if (!keep.has(index)) {
      omitted++
      return
    }
    if (omitted > 0) out.push(`[${omitted} earlier message${omitted === 1 ? '' : 's'} left out]`)
    omitted = 0
    out.push(message.text)
  })
  return out
}
