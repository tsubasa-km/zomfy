import { useSyncExternalStore } from 'react'
import type { ChatCatalog } from '@acp-harness/protocol'
import type { ChatImage } from '@/session-store'

/** Context-window use the daemon reported after the session's latest turn. */
export interface ContextUsage {
  used: number
  size: number
  costUsd: number | null
  estimated: boolean
  categories: { name: string; tokens: number }[]
}

/** A message typed while a turn ran; sent when the agent is free (Orca's follow-up queue). */
export interface QueuedMessage {
  id: string
  text: string
  images: ChatImage[]
}

/** What the chat UI keeps per session beyond the transcript; lives only in this window. */
export interface ChatSessionState {
  draft: string
  draftImages: ChatImage[]
  queue: QueuedMessage[]
  /** After Stop the queue waits for Resume instead of sending into the next turn. */
  queuePaused: boolean
  usage: ContextUsage | null
}

export type Loadable<T> =
  | { status: 'loading'; value: T | null }
  | { status: 'ready'; value: T }
  | { status: 'error'; value: T | null; error: string }

interface ChatState {
  sessions: Record<string, ChatSessionState>
  /** By workspace: Claude's `/` menu and models for its folder. */
  catalogs: Record<string, Loadable<ChatCatalog>>
  /** By workspace: the @ menu's file list. */
  mentionFiles: Record<string, Loadable<string[]>>
}

const EMPTY_SESSION: ChatSessionState = {
  draft: '',
  draftImages: [],
  queue: [],
  queuePaused: false,
  usage: null
}

let state: ChatState = { sessions: {}, catalogs: {}, mentionFiles: {} }
const listeners = new Set<() => void>()

function set(next: ChatState): void {
  state = next
  for (const listener of listeners) listener()
}

export function useChatStore<T>(select: (s: ChatState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => select(state)
  )
}

export function getChatState(): ChatState {
  return state
}

export function chatSession(sessionId: string, s: ChatState = state): ChatSessionState {
  return s.sessions[sessionId] ?? EMPTY_SESSION
}

export function useChatSession(sessionId: string): ChatSessionState {
  return useChatStore((s) => chatSession(sessionId, s))
}

export function patchChatSession(
  sessionId: string,
  patch: Partial<ChatSessionState> | ((current: ChatSessionState) => Partial<ChatSessionState>)
): void {
  const current = chatSession(sessionId)
  const change = typeof patch === 'function' ? patch(current) : patch
  set({ ...state, sessions: { ...state.sessions, [sessionId]: { ...current, ...change } } })
}

export function setCatalog(workspaceId: string, entry: Loadable<ChatCatalog>): void {
  set({ ...state, catalogs: { ...state.catalogs, [workspaceId]: entry } })
}

export function setMentionFiles(workspaceId: string, entry: Loadable<string[]>): void {
  set({ ...state, mentionFiles: { ...state.mentionFiles, [workspaceId]: entry } })
}
