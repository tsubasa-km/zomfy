import type * as acp from '@agentclientprotocol/sdk'

// The conversation in a stretch of the daemon's transcript, as whole messages: what a side chat is
// seeded with and what an agent taking over a chat is handed (agent-handoff.ts).

export interface ConversationMessage {
  role: 'User' | 'Assistant'
  text: string
  /** Assistant only: the commands it ran and the files it changed during this turn. */
  commands: string[]
  edits: string[]
}

type ToolCall = Extract<acp.SessionUpdate, { sessionUpdate: 'tool_call' }>

function rawInput(update: ToolCall): Record<string, unknown> {
  return update.rawInput && typeof update.rawInput === 'object' ? (update.rawInput as Record<string, unknown>) : {}
}

/** The command line a tool call ran, when its input names one. */
export function toolCallCommand(update: ToolCall): string {
  const { command } = rawInput(update)
  return typeof command === 'string' ? command : Array.isArray(command) ? command.join(' ') : ''
}

/** The files a tool call names: its locations, or the path in its input. */
export function toolCallPaths(update: ToolCall): string[] {
  const input = rawInput(update)
  return [...(update.locations ?? []).map((l) => l.path), input.file_path, input.notebook_path].filter(
    (p): p is string => typeof p === 'string' && !!p
  )
}

/**
 * The transcript's user and agent text, with streamed chunks joined into whole messages: one per
 * prompt, and one per turn for the agent's words. Thoughts and tool output are left out; the
 * commands a turn ran and the files it changed ride on its message.
 */
export function conversationMessages(updates: readonly acp.SessionUpdate[]): ConversationMessage[] {
  const messages: ConversationMessage[] = []
  let promptId: string | null | undefined
  // Agent text after a tool call or a thought starts a new paragraph of the same message.
  let midText = false
  const assistant = (): ConversationMessage => {
    const last = messages.at(-1)
    if (last?.role === 'Assistant') return last
    const message: ConversationMessage = { role: 'Assistant', text: '', commands: [], edits: [] }
    messages.push(message)
    midText = false
    return message
  }
  for (const update of updates) {
    if (update.sessionUpdate === 'user_message_chunk') {
      if (update.content.type !== 'text') continue
      const id = update.messageId ?? null
      const last = messages.at(-1)
      if (last?.role === 'User' && id !== null && id === promptId) last.text += `\n${update.content.text}`
      else messages.push({ role: 'User', text: update.content.text, commands: [], edits: [] })
      promptId = id
    } else if (update.sessionUpdate === 'agent_message_chunk') {
      if (update.content.type !== 'text') continue
      const message = assistant()
      message.text += !midText && message.text.trim() ? `\n\n${update.content.text}` : update.content.text
      midText = true
    } else if (update.sessionUpdate === 'agent_thought_chunk') {
      midText = false
    } else if (update.sessionUpdate === 'tool_call') {
      midText = false
      const command = update.kind === 'execute' ? toolCallCommand(update) || (update.title ?? '') : ''
      const paths = update.kind === 'edit' ? toolCallPaths(update) : []
      if (!command && paths.length === 0) continue
      const message = assistant()
      if (command) message.commands.push(command)
      for (const path of paths) if (!message.edits.includes(path)) message.edits.push(path)
    }
  }
  return messages.filter((m) => m.text.trim() || m.commands.length > 0 || m.edits.length > 0)
}
