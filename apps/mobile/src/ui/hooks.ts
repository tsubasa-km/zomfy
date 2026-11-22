import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ChatSession, type ChatState } from '../lib/chat-session'
import type { HostConnection, HostConnectionState } from '../lib/host-connection'
import { needsYouCount } from '../lib/host-tree'
import { Observable } from '../lib/observable'
import { app } from './app-model'

export function useObservable<T>(observable: Observable<T>): T {
  return useSyncExternalStore(observable.subscribe, observable.get, observable.get)
}

const idle = new Observable<HostConnectionState | null>(null)

export function useConnection(hostId: string | undefined): HostConnection | undefined {
  const connections = useObservable(app.connections)
  return hostId ? connections.get(hostId) : undefined
}

export function useConnectionState(connection: HostConnection | undefined): HostConnectionState | null {
  return useObservable<HostConnectionState | null>(connection?.state ?? idle)
}

export const useAsks = () => useObservable(app.asks.asks)

export function useHost(hostId: string | undefined) {
  const hosts = useObservable(app.hosts)
  return useMemo(() => hosts.find((h) => h.hostId === hostId), [hosts, hostId])
}

const emptyChat = new Observable<ChatState>({ items: [], loading: false, error: null, sending: false })

/** The open chat's transcript, loaded and kept live while the screen shows it. */
export function useChatSession(connection: HostConnection | undefined, sessionId: string | undefined) {
  const [chat, setChat] = useState<ChatSession | null>(null)
  useEffect(() => {
    if (!connection || !sessionId) return
    const session = new ChatSession(connection, sessionId)
    session.open()
    setChat(session)
    return () => session.close()
  }, [connection, sessionId])
  const state = useObservable(chat?.state ?? emptyChat)
  return { chat, state }
}

/** Re-renders every `ms`, for countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

/** Every host's connection state, re-rendering when any of them changes. */
export function useAllConnectionStates(): ReadonlyMap<string, HostConnectionState> {
  const connections = useObservable(app.connections)
  const store = useMemo(() => {
    let cached: { states: HostConnectionState[]; map: Map<string, HostConnectionState> } | null = null
    return {
      subscribe: (listener: () => void) => {
        const offs = [...connections.values()].map((c) => c.state.subscribe(listener))
        return () => offs.forEach((off) => off())
      },
      get: () => {
        const states = [...connections.values()].map((c) => c.state.get())
        if (cached && cached.states.length === states.length && cached.states.every((s, i) => s === states[i])) return cached.map
        cached = { states, map: new Map([...connections.keys()].map((id, i) => [id, states[i]!])) }
        return cached.map
      }
    }
  }, [connections])
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** Asks plus chats waiting for the person, across every host. */
export function useNeedsYouTotal(): number {
  const asks = useAsks()
  const states = useAllConnectionStates()
  let total = 0
  for (const [hostId, state] of states) {
    total += needsYouCount(asks.filter((a) => a.hostId === hostId), state.sessions)
  }
  return total
}
