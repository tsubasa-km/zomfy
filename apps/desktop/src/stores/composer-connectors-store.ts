import { useEffect } from 'react'
import { HARNESS_METHODS, type ChatMcpServer } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { createExternalStore } from './external-store'
import { connectorsConnecting as connecting, type KnownConnectors } from '@/components/right-sidebar/session-panel/connectors-read'

// The MCP servers a chat's composer offers in its @ and + menus (composer-skills-and-connectors.md):
// read when a menu first needs them (again while servers are still connecting), with the request the Session panel's Connectors
// uses, and replaced whenever that panel reads the list. Only connected servers are offered, never
// Zomfy's own tools server.

/** `stale`: read again the next time a menu wants it. `readAt`: when a read last answered. */
type Entry = { status: 'loading' | 'ready' | 'error'; servers: ChatMcpServer[]; stale?: boolean; readAt?: number }

const store = createExternalStore<Record<string, Entry>>({})
const EMPTY: Entry = { status: 'ready', servers: [] }

/** How often, and how many times, a list with servers still connecting is read again. */
const RETRY_MS = 1500
const RETRIES = 20

/** The Session panel read the chat's servers: the composer offers the same. */
export function noteChatConnectors(sessionId: string, servers: ChatMcpServer[]): void {
  store.update((all) => ({ ...all, [sessionId]: { status: connecting(servers) ? 'loading' : 'ready', servers, readAt: Date.now() } }))
}

/** What was last read of a chat's servers, by the panel or a menu; the panel shows it at once. */
export function knownChatConnectors(sessionId: string): KnownConnectors | undefined {
  const entry = store.get()[sessionId]
  if (!entry) return undefined
  return { servers: entry.servers, ...(entry.readAt !== undefined ? { readAt: entry.readAt } : {}), ...(entry.stale ? { stale: true } : {}) }
}

function read(sessionId: string, hostId: HostId, retries: number): void {
  harnessRequest(HARNESS_METHODS.chatMcpStatus, { sessionId }, hostId).then(
    (result) => {
      noteChatConnectors(sessionId, result.servers)
      if (!connecting(result.servers)) return
      if (retries > 0) setTimeout(() => read(sessionId, hostId, retries - 1), RETRY_MS)
      // Still connecting after the retries: offer what is connected; the next open reads again.
      else store.update((all) => ({ ...all, [sessionId]: { status: 'ready', servers: result.servers, stale: true, readAt: Date.now() } }))
    },
    // Not a Claude chat, or the host could not say: none offered now; the next open asks again.
    () => store.update((all) => ({ ...all, [sessionId]: { status: 'error', servers: [], stale: true } }))
  )
}

function load(sessionId: string, hostId: HostId): void {
  const entry = store.get()[sessionId]
  if (entry && !entry.stale) return
  store.update((all) => ({ ...all, [sessionId]: { ...entry, status: 'loading', servers: entry?.servers ?? [], stale: false } }))
  read(sessionId, hostId, RETRIES)
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
