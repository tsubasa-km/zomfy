import { CHAT_AGENT_IDS, type ChatAgentId, type PastConversation } from '@zomfy/protocol'
import { chatFolderBelow } from './link-targets'

// What the Import threads dialog lists: the conversations each agent's own CLI recorded on a host,
// as its daemon reports them (`_harness/sessions/history`), grouped by agent and narrowed by a search.

/** A conversation the dialog can import. */
export interface ImportableThread extends PastConversation {
  agent: ChatAgentId
  conversationId: string
  /** Unique among a host's conversations of every agent. */
  key: string
}

export interface ThreadGroup {
  agent: ChatAgentId
  threads: ImportableThread[]
}

/**
 * A daemon's answer for one agent. A daemon that predates thread import lists Claude's
 * conversations whichever agent is asked for, so its answer counts for Claude alone.
 */
export function listedThreads(asked: ChatAgentId, list: PastConversation[]): ImportableThread[] {
  return list.flatMap((c): ImportableThread[] => {
    const agent = c.agent ?? 'claude'
    if (agent !== asked) return []
    const conversationId = c.conversationId ?? c.claudeSessionId
    return [{ ...c, agent, conversationId, key: `${agent}:${conversationId}` }]
  })
}

/** Whether every word of `query` is in the thread's title, folder or branch. */
export function matchesSearch(thread: ImportableThread, query: string): boolean {
  const text = [thread.title, thread.cwd ?? '', thread.gitBranch ?? ''].join('\n').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

/** The threads that match, by agent in the app's own order, each agent's newest first. */
export function threadGroups(threads: ImportableThread[], query: string): ThreadGroup[] {
  return CHAT_AGENT_IDS.flatMap((agent): ThreadGroup[] => {
    const own = threads.filter((t) => t.agent === agent && matchesSearch(t, query)).sort((a, b) => b.lastModified - a.lastModified)
    return own.length > 0 ? [{ agent, threads: own }] : []
  })
}

/** The last part of a folder's path, whichever way its slashes lean. */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path
}

/**
 * Where a listed thread would run, seen from the workspace the dialog was opened from: its folder,
 * a subfolder of it, another workspace's folder (or one no workspace has), or a folder since removed.
 */
export type ThreadPlace =
  | { kind: 'here' }
  | { kind: 'below'; path: string }
  | { kind: 'elsewhere'; workspaceId: string | null }
  | { kind: 'gone' }

export function threadPlace(thread: Pick<PastConversation, 'cwd' | 'workspaceId' | 'folderMissing'>, here: { id: string; path: string }): ThreadPlace {
  if (thread.folderMissing) return { kind: 'gone' }
  if ((thread.workspaceId ?? null) !== here.id) return { kind: 'elsewhere', workspaceId: thread.workspaceId ?? null }
  const below = chatFolderBelow(thread.cwd, here.path)
  return below ? { kind: 'below', path: below } : { kind: 'here' }
}

/** An empty thread's Recent conversations: those its workspace owns that no thread shows yet. */
export function recentConversations(list: PastConversation[], workspaceId: string): PastConversation[] {
  return list.filter((c) => !c.openSessionId && (c.workspaceId ?? null) === workspaceId && !c.folderMissing)
}
