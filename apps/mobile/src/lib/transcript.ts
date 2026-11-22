// Turns a chat's ACP `session/update` stream into the items the Chat screen shows, the essentials of
// the desktop's chat-transcript.ts: message chunks merged, thoughts, one item per tool call (its
// updates folded in), the latest plan, and notices. Usage, modes and commands are ignored.

import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META } from '@zomfy/protocol'

export type PlanEntry = { content: string; status: string; priority?: string }

export type TranscriptItem =
  | { kind: 'user'; id: string; text: string; messageId?: string }
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      toolCallId: string
      title: string
      toolKind: string
      status: string
      /** Claude's tool name (Bash, Edit, Task…), when the daemon reports it. */
      toolName?: string
      input: unknown
      output: string
    }
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  | { kind: 'notice'; id: string; title: string; description?: string; severity: string }

export type SessionUpdate = acp.SessionNotification['update']

const metaString = (meta: Record<string, unknown> | null | undefined, key: string): string | undefined => {
  const value = meta?.[key]
  return typeof value === 'string' ? value : undefined
}

function toolOutputText(content: readonly acp.ToolCallContent[]): string {
  return content
    .map((part) => {
      if (part.type === 'content' && part.content.type === 'text') return part.content.text
      if (part.type === 'diff') return `${part.path}`
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/** Folds one update into the items; returns the same array when it changes nothing shown. */
export function applyUpdate(items: readonly TranscriptItem[], update: SessionUpdate): TranscriptItem[] {
  const last = items.at(-1)
  const nextId = (kind: string): string => `${kind}:${items.length}`
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      if (update.content.type !== 'text') return items as TranscriptItem[]
      const messageId = update.messageId ?? undefined
      if (last?.kind === 'user' && (messageId === undefined || last.messageId === messageId)) {
        const text = last.text ? `${last.text}\n${update.content.text}` : update.content.text
        return [...items.slice(0, -1), { ...last, text }]
      }
      return [...items, { kind: 'user', id: nextId('user'), text: update.content.text, ...(messageId ? { messageId } : {}) }]
    }
    case 'agent_message_chunk':
    case 'agent_thought_chunk': {
      if (update.content.type !== 'text') return items as TranscriptItem[]
      const kind = update.sessionUpdate === 'agent_message_chunk' ? 'agent' : 'thought'
      if (last?.kind === kind) return [...items.slice(0, -1), { ...last, text: last.text + update.content.text }]
      return [...items, { kind, id: nextId(kind), text: update.content.text }]
    }
    case 'tool_call': {
      const toolName = metaString(update._meta, CHAT_META.toolName)
      return upsertTool(items, update.toolCallId, {
        title: update.title,
        toolKind: update.kind ?? 'other',
        status: update.status ?? 'pending',
        input: update.rawInput ?? null,
        ...(toolName ? { toolName } : {}),
        ...(update.content ? { output: toolOutputText(update.content) } : {})
      })
    }
    case 'tool_call_update':
      return upsertTool(items, update.toolCallId, {
        ...(update.title ? { title: update.title } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...(update.kind ? { toolKind: update.kind } : {}),
        ...(update.rawInput !== undefined && update.rawInput !== null ? { input: update.rawInput } : {}),
        ...(update.content ? { output: toolOutputText(update.content) } : {})
      })
    case 'plan': {
      // A plan is the whole list each time: the newest replaces one that is still the last item.
      const entries = update.entries.map((e) => ({ content: e.content, status: e.status, priority: e.priority }))
      if (last?.kind === 'plan') return [...items.slice(0, -1), { ...last, entries }]
      return [...items, { kind: 'plan', id: nextId('plan'), entries }]
    }
    case 'notice':
      return [
        ...items,
        {
          kind: 'notice',
          id: nextId('notice'),
          title: update.title,
          ...(update.description ? { description: update.description } : {}),
          severity: update.severity
        }
      ]
    default:
      return items as TranscriptItem[]
  }
}

function upsertTool(
  items: readonly TranscriptItem[],
  toolCallId: string,
  patch: Partial<Extract<TranscriptItem, { kind: 'tool' }>>
): TranscriptItem[] {
  const index = items.findIndex((item) => item.kind === 'tool' && item.toolCallId === toolCallId)
  if (index === -1) {
    return [
      ...items,
      {
        kind: 'tool',
        id: `tool:${toolCallId}`,
        toolCallId,
        title: 'Tool',
        toolKind: 'other',
        status: 'pending',
        input: null,
        output: '',
        ...patch
      }
    ]
  }
  const next = items.slice()
  const current = next[index]
  if (current?.kind === 'tool') next[index] = { ...current, ...patch }
  return next
}

export function transcriptFrom(updates: readonly SessionUpdate[]): TranscriptItem[] {
  return updates.reduce<TranscriptItem[]>((items, update) => applyUpdate(items, update), [])
}

/** One line for a collapsed tool call: its title, or the command it runs. */
export function toolSummary(item: Extract<TranscriptItem, { kind: 'tool' }>): string {
  const input = item.input as Record<string, unknown> | null
  const command = typeof input?.command === 'string' ? input.command : null
  const title = item.title && item.title !== 'Tool' ? item.title : (item.toolName ?? 'Tool')
  return (command && !title.includes(command) ? `${title}: ${command}` : title).split('\n')[0]!
}
