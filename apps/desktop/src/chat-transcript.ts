import type * as acp from '@agentclientprotocol/sdk'
import {
  CHAT_META,
  TURN_RECOVERY_META,
  type ContextUsageMeta,
  type TurnEndMeta,
  type TurnResumeKind
} from '@acp-harness/protocol'
import { appendText, getState, updateSession, upsertTool, type ThreadItem } from '@/session-store'
import { patchChatSession } from '@/stores/chat-store'

/** Folds one ACP session update into the window's transcript and chat state. */
export function applyChatUpdate({ sessionId, update }: acp.SessionNotification): void {
  // A tab that has not replayed its transcript would get a fragment; load fills it in later.
  if (!getState().sessions.some((s) => s.id === sessionId && s.loaded)) return
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      appendUserContent(sessionId, update.content, update.messageId ?? undefined, resumeKind(update._meta))
      break
    case 'agent_message_chunk':
      if (update.content.type === 'text') appendText(sessionId, 'agent', update.content.text)
      break
    case 'agent_thought_chunk':
      if (update.content.type === 'text') appendText(sessionId, 'thought', update.content.text)
      break
    case 'tool_call': {
      const toolName = metaString(update._meta, CHAT_META.toolName)
      const parentId = metaString(update._meta, CHAT_META.parentToolCallId)
      upsertTool(sessionId, update.toolCallId, {
        title: update.title,
        toolKind: update.kind ?? 'other',
        status: update.status ?? 'pending',
        input: update.rawInput ?? null,
        ...(toolName ? { toolName } : {}),
        parentId: parentId ?? null
      })
      break
    }
    case 'tool_call_update':
      upsertTool(sessionId, update.toolCallId, {
        ...(update.title ? { title: update.title } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...(update.content ? { output: toolOutputText(update.content) } : {})
      })
      break
    case 'usage_update': {
      const meta = contextUsageMeta(update._meta)
      patchChatSession(sessionId, {
        usage: {
          used: update.used,
          size: update.size,
          costUsd: update.cost?.currency === 'USD' ? update.cost.amount : null,
          estimated: meta?.estimated ?? true,
          categories: meta?.categories ?? []
        }
      })
      break
    }
    case 'plan':
      // An ACP plan is the whole list each time, as a TodoWrite call is; it reads as one.
      updateSession(sessionId, (s) => ({
        ...s,
        items: [
          ...s.items,
          {
            kind: 'tool',
            id: `plan:${s.items.length}`,
            title: 'Plan',
            toolKind: 'think',
            toolName: 'TodoWrite',
            status: 'completed',
            input: { todos: update.entries.map((e) => ({ content: e.content, status: e.status })) },
            output: '',
            parentId: null
          }
        ]
      }))
      break
    case 'notice': {
      const turnEnd = turnEndMeta(update._meta)
      pushItem(sessionId, { kind: 'notice', text: update.title, severity: update.severity, ...(turnEnd ? { turnEnd } : {}) })
      break
    }
    case 'compaction_update':
      updateSession(sessionId, (s) => {
        const index = s.items.findIndex((i) => i.kind === 'compaction' && i.id === update.compactionId)
        const item: ThreadItem = { kind: 'compaction', id: update.compactionId, status: update.status }
        if (index === -1) return { ...s, items: [...s.items, item] }
        const items = s.items.slice()
        items[index] = item
        return { ...s, items }
      })
      break
  }
}

function pushItem(sessionId: string, item: ThreadItem): void {
  updateSession(sessionId, (s) => ({ ...s, items: [...s.items, item] }))
}

/** A prompt's blocks share one messageId; text and images gather on its one bubble. */
function appendUserContent(
  sessionId: string,
  content: acp.ContentBlock,
  messageId: string | undefined,
  resumed: TurnResumeKind | null
): void {
  if (content.type !== 'text' && content.type !== 'image') return
  updateSession(sessionId, (s) => {
    const last = s.items.at(-1)
    const same = last?.kind === 'user' && (messageId === undefined || last.messageId === messageId)
    const base: Extract<ThreadItem, { kind: 'user' }> =
      same && last?.kind === 'user'
        ? last
        : { kind: 'user', text: '', ...(messageId ? { messageId } : {}), ...(resumed ? { resumed } : {}) }
    const next: ThreadItem =
      content.type === 'text'
        ? { ...base, text: base.text ? `${base.text}\n${content.text}` : content.text }
        : { ...base, images: [...(base.images ?? []), { mimeType: content.mimeType, data: content.data }] }
    return { ...s, items: same ? [...s.items.slice(0, -1), next] : [...s.items, next] }
  })
}

const RESUME_KINDS: readonly TurnResumeKind[] = ['continue', 'retry', 'resume', 'auto', 'moved']

function resumeKind(meta: Record<string, unknown> | null | undefined): TurnResumeKind | null {
  const value = meta?.[TURN_RECOVERY_META.resumed]
  return RESUME_KINDS.find((kind) => kind === value) ?? null
}

function turnEndMeta(meta: Record<string, unknown> | null | undefined): TurnEndMeta | null {
  const value = meta?.[TURN_RECOVERY_META.turnEnd]
  if (typeof value !== 'object' || value === null || !('reason' in value)) return null
  switch (value.reason) {
    case 'interrupted':
      return { reason: 'interrupted' }
    case 'error':
      return { reason: 'error' }
    case 'usage-limit': {
      const resetsAt = 'resetsAt' in value && typeof value.resetsAt === 'number' ? value.resetsAt : null
      return { reason: 'usage-limit', resetsAt }
    }
    default:
      return null
  }
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = meta?.[key]
  return typeof value === 'string' ? value : null
}

function contextUsageMeta(meta: Record<string, unknown> | null | undefined): ContextUsageMeta | null {
  const value = meta?.[CHAT_META.contextUsage]
  if (typeof value !== 'object' || value === null || !('estimated' in value) || !('categories' in value)) return null
  const { estimated, categories } = value
  if (typeof estimated !== 'boolean' || !Array.isArray(categories)) return null
  return {
    estimated,
    categories: categories.flatMap((c: unknown) =>
      typeof c === 'object' && c !== null && 'name' in c && 'tokens' in c && typeof c.name === 'string' && typeof c.tokens === 'number'
        ? [{ name: c.name, tokens: c.tokens }]
        : []
    )
  }
}

function toolOutputText(content: acp.ToolCallContent[]): string {
  return content
    .map((part) => (part.type === 'content' && part.content.type === 'text' ? part.content.text : ''))
    .join('\n')
}

/**
 * How the chat's latest turn ended short, if it did and nothing came after: the newest item that
 * is not a status line ("Worked for 3s", warnings) is a notice carrying a turn end.
 */
export function latestTurnEnd(items: readonly ThreadItem[]): TurnEndMeta | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'compaction') continue
    if (item.kind !== 'notice') return null
    if (item.turnEnd) return item.turnEnd
    if (item.severity === 'error') return null
  }
  return null
}
