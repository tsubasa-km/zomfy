import { useEffect, useSyncExternalStore } from 'react'
import { HARNESS_METHODS, type ChatAgentId, type ChatAgentInfo } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, allWorkspaces, getState, type HostId, type Session } from '@/session-store'

// The chat agents each daemon host can run, and why the others can't. Asked of that host, as the
// terminal's agent detection is (detected-agents.ts).

export type ChatAgentsState =
  | { kind: 'loading'; agents: ChatAgentInfo[] }
  | { kind: 'ready'; agents: ChatAgentInfo[] }
  | { kind: 'failed'; agents: ChatAgentInfo[]; reason: string }

const EMPTY: ChatAgentsState = { kind: 'loading', agents: [] }
const byHost = new Map<HostId, ChatAgentsState>()
const inFlight = new Map<HostId, Promise<void>>()
const listeners = new Set<() => void>()

function set(hostId: HostId, state: ChatAgentsState): void {
  byHost.set(hostId, state)
  for (const listener of listeners) listener()
}

export function loadChatAgents(hostId: HostId, refresh = false): Promise<void> {
  const running = inFlight.get(hostId)
  if (running && !refresh) return running
  const previous = byHost.get(hostId)?.agents ?? []
  set(hostId, { kind: 'loading', agents: previous })
  const request = harnessRequest(HARNESS_METHODS.chatAgentsList, refresh ? { refresh } : {}, hostId)
    .then(
      (agents) => set(hostId, { kind: 'ready', agents }),
      (error: unknown) =>
        set(hostId, { kind: 'failed', agents: previous, reason: error instanceof Error ? error.message : String(error) })
    )
    .finally(() => inFlight.delete(hostId))
  inFlight.set(hostId, request)
  return request
}

export function setChatAgents(hostId: HostId, agents: ChatAgentInfo[]): void {
  set(hostId, { kind: 'ready', agents })
}

export function useChatAgents(hostId: HostId): ChatAgentsState {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => byHost.get(hostId) ?? EMPTY
  )
  useEffect(() => {
    if (!byHost.has(hostId) || byHost.get(hostId)?.kind === 'failed') void loadChatAgents(hostId)
  }, [hostId])
  return state
}

export function workspaceHostId(workspaceId: string): HostId {
  return allWorkspaces(getState()).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST
}

/** The agent a session runs; sessions from daemons that predate agents are Claude's. */
export function sessionAgent(session: Pick<Session, 'agent'>): ChatAgentId {
  return session.agent ?? 'claude'
}

export function isExternalAgentSession(session: Pick<Session, 'agent'>): boolean {
  return sessionAgent(session) !== 'claude'
}
