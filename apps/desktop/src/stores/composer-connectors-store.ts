import { useEffect } from 'react'
import { HARNESS_METHODS, type ChatMcpServer } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { createExternalStore } from './external-store'

// The MCP servers a chat's composer offers in its @ and + menus (composer-skills-and-connectors.md):
// read once per chat when a menu first needs them, with the request the Session panel's Connectors
// uses, and replaced whenever that panel reads the list. Only connected servers are offered, never
// Zomfy's own tools server.

type Entry = { status: 'loading' | 'ready' | 'error'; servers: ChatMcpServer[] }

const store = createExternalStore<Record<string, Entry>>({})
const EMPTY: Entry = { status: 'ready', servers: [] }

/** The Session panel read the chat's servers: the composer offers the same. */
export function noteChatConnectors(sessionId: string, servers: ChatMcpServer[]): void {
  store.update((all) => ({ ...all, [sessionId]: { status: 'ready', servers } }))
}

function load(sessionId: string, hostId: HostId): void {
  if (store.get()[sessionId]) return
  store.update((all) => ({ ...all, [sessionId]: { status: 'loading', servers: [] } }))
  harnessRequest(HARNESS_METHODS.chatMcpStatus, { sessionId }, hostId).then(
    (result) => noteChatConnectors(sessionId, result.servers),
    // Not a Claude chat, or the host could not say: no connectors are offered.
    () => store.update((all) => ({ ...all, [sessionId]: { status: 'error', servers: [] } }))
  )
}

/**
 * The connectors a chat's composer offers; `wanted` asks for them (a menu that lists them is open).
 * null `sessionId` (the New thread tab, another agent) offers none.
 */
export function useComposerConnectors(sessionId: string | null, hostId: HostId, wanted: boolean): Entry {
  const entry = store.use((all) => (sessionId ? all[sessionId] : undefined))
  useEffect(() => {
    if (sessionId && wanted) load(sessionId, hostId)
  }, [sessionId, hostId, wanted])
  return entry ?? EMPTY
}
