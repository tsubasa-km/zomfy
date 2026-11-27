import { stat } from 'node:fs/promises'
import type * as acp from '@agentclientprotocol/sdk'
import { chatAgentLabel, isChatAgentId, type ChatAgentId, type HarnessMethod, type HarnessRequests, type PastConversation } from '@zomfy/protocol'
import { acpConversationUpdates, listAcpConversations } from './acp-agent-history.ts'
import { importHandoff } from './agent-handoff.ts'
import { conversationUpdates, findConversation, listConversations } from './claude-history.ts'
import { codexConversationUpdates, findCodexConversation, listCodexConversations } from './codex-history.ts'
import { folderBelow, folderUnder, owningWorkspace, sameFolder } from './folder-paths.ts'
import type { HandlerContext } from './handlers/handler-context.ts'
import { log } from './log.ts'
import type { SessionRecord } from './session-registry.ts'
import { FLOATING_WORKSPACE_ID } from './workspace-manager.ts'

// Conversations the person had in an agent's own CLI, listed and imported as threads. Each agent's
// record is read where that agent keeps it, and only read: Claude Code's through its SDK, Codex's
// rollout files, any other agent's through its ACP server when that lists and replays sessions.

/** A conversation as its agent recorded it. */
export interface AgentConversation {
  /** The agent's own id for it: what reopens it (Claude's session id, an ACP session id). */
  conversationId: string
  title: string
  lastModified: number
  /** The folder it ran in, when the agent recorded one. */
  cwd: string | null
  gitBranch: string | null
}

interface ConversationSource {
  /** Newest first; `cwd` keeps one folder's. */
  list(cwd: string | null): Promise<AgentConversation[]>
  /** `cwd`: the folder it is expected in, looked at first. */
  find(conversationId: string, cwd: string | null): Promise<AgentConversation | null>
  /** The conversation as the ACP updates a live turn would have sent. */
  updates(conversation: AgentConversation): Promise<acp.SessionUpdate[]>
  /** Whether the agent, run in `cwd`, can reopen the conversation itself. */
  resumesIn(conversation: AgentConversation, cwd: string): Promise<boolean>
}

/** Conversations listed for one folder, and for every folder at once. */
const FOLDER_LIMIT = 100
const HOST_LIMIT = 300
const TITLE_CHARS = 80

type Deps = Pick<HandlerContext, 'sessions' | 'workspaces' | 'workspaceRoot'>
type Params<M extends HarnessMethod> = HarnessRequests[M]['params']

function sourceOf(agent: ChatAgentId): ConversationSource {
  if (agent === 'claude') {
    const plain = ({ claudeSessionId, ...rest }: Awaited<ReturnType<typeof listConversations>>[number]): AgentConversation => ({
      conversationId: claudeSessionId,
      ...rest
    })
    return {
      list: async (cwd) => (await listConversations(cwd ?? undefined, cwd ? FOLDER_LIMIT : HOST_LIMIT)).map(plain),
      find: async (id, cwd) => {
        const found = (cwd ? await findConversation(id, cwd) : null) ?? (await findConversation(id))
        return found ? plain(found) : null
      },
      // Read from the folder Claude filed it under; a missing folder is no obstacle to reading.
      updates: (conversation) => conversationUpdates(conversation.conversationId),
      // Claude files a conversation under the folder it ran in and resumes it only from there.
      resumesIn: async ({ conversationId, cwd: recorded }, cwd) => {
        if (!(await findConversation(conversationId, cwd))) return false
        if (!recorded || sameFolder(recorded, cwd)) return true
        // Found from here, yet recorded elsewhere (another worktree of the repository, a subfolder).
        return (await listConversations(cwd, 1000)).some((c) => c.claudeSessionId === conversationId)
      }
    }
  }
  if (agent === 'codex') {
    return {
      list: (cwd) => listCodexConversations(cwd ? (recorded) => sameFolder(recorded, cwd) : null, cwd ? FOLDER_LIMIT : HOST_LIMIT),
      find: (id) => findCodexConversation(id),
      updates: (conversation) => codexConversationUpdates(conversation.conversationId),
      resumesIn: async (conversation, cwd) => !!conversation.cwd && sameFolder(conversation.cwd, cwd)
    }
  }
  return {
    list: (cwd) => listAcpConversations(agent, cwd, cwd ? (recorded) => sameFolder(recorded, cwd) : null, cwd ? FOLDER_LIMIT : HOST_LIMIT),
    find: async (id, cwd) => {
      const inFolder = cwd ? (await listAcpConversations(agent, cwd, null, HOST_LIMIT)).find((c) => c.conversationId === id) : undefined
      return inFolder ?? (await listAcpConversations(agent, null, null, HOST_LIMIT)).find((c) => c.conversationId === id) ?? null
    },
    updates: (conversation) => {
      if (!conversation.cwd) throw new Error(`${chatAgentLabel(agent)} did not record this conversation's folder`)
      return acpConversationUpdates(agent, conversation.conversationId, conversation.cwd)
    },
    resumesIn: async (conversation, cwd) => !!conversation.cwd && sameFolder(conversation.cwd, cwd)
  }
}

/** The session that shows a conversation: it runs on it, or was imported from it. */
function shownBy(sessions: SessionRecord[], agent: ChatAgentId, conversationId: string): SessionRecord | undefined {
  return sessions.find(
    (s) =>
      (agent === 'claude' ? s.claudeSessionId === conversationId : s.agentSessionIds?.[agent] === conversationId) ||
      (s.importedFrom?.agent === agent && s.importedFrom.conversationId === conversationId)
  )
}

/** Whether a folder is there to work in; each folder is looked at once per listing. */
function folderCheck(): (path: string) => Promise<boolean> {
  const seen = new Map<string, Promise<boolean>>()
  return (path) => {
    let found = seen.get(path)
    if (!found) {
      found = stat(path).then((s) => s.isDirectory(), () => false)
      seen.set(path, found)
    }
    return found
  }
}

/** Newest first, each conversation once. */
function merged(...lists: AgentConversation[][]): AgentConversation[] {
  const seen = new Set<string>()
  return lists
    .flat()
    .sort((a, b) => b.lastModified - a.lastModified)
    .filter((c) => !seen.has(c.conversationId) && !!seen.add(c.conversationId))
}

/** `_harness/sessions/history`. */
export async function pastConversations(deps: Deps, p: Params<'_harness/sessions/history'>): Promise<PastConversation[]> {
  const agents = (p.agents ?? ['claude']).filter(isChatAgentId)
  const cwd = p.workspaceId ? deps.workspaceRoot(p.workspaceId) : null
  const workspaces = (await deps.workspaces.snapshot()).workspaces.filter((w) => w.id !== FLOATING_WORKSPACE_ID)
  const sessions = deps.sessions.all()
  const isFolder = folderCheck()
  const lists = await Promise.all(
    agents.map(async (agent) => {
      const source = sourceOf(agent)
      const read = async (): Promise<AgentConversation[]> => {
        if (!cwd) return source.list(null)
        // What the agent finds for the folder, and what it recorded below it (a subfolder).
        const [own, everywhere] = await Promise.all([source.list(cwd), source.list(null)])
        const below = everywhere.filter((c) => c.cwd && folderBelow(c.cwd, cwd) !== null)
        return merged(own, below).slice(0, FOLDER_LIMIT)
      }
      const listed = await read().catch((error: unknown) => {
        // One agent that cannot be read does not hide the others; asked for alone, it says why.
        if (agents.length === 1) throw error
        log(`listing ${agent}'s conversations failed: ${String(error)}`)
        return []
      })
      return Promise.all(
        listed.map(async (c): Promise<PastConversation> => {
          // Each conversation names the workspace of its own folder, whichever folder it was found from.
          const present = c.cwd ? await isFolder(c.cwd) : false
          const owner = c.cwd && present ? owningWorkspace(c.cwd, workspaces) : null
          return {
            agent,
            conversationId: c.conversationId,
            claudeSessionId: c.conversationId,
            title: c.title,
            lastModified: c.lastModified,
            gitBranch: c.gitBranch,
            cwd: c.cwd,
            workspaceId: owner?.id ?? null,
            ...(c.cwd && !present ? { folderMissing: true } : {}),
            openSessionId: shownBy(sessions, agent, c.conversationId)?.id ?? null
          }
        })
      )
    })
  )
  return lists.flat().sort((a, b) => b.lastModified - a.lastModified)
}

/** One import at a time: two asks for the same conversation make one thread. */
let importing: Promise<unknown> = Promise.resolve()

/** `_harness/sessions/resume`. */
export function importConversation(deps: Deps, p: Params<'_harness/sessions/resume'>): Promise<SessionRecord> {
  const done = importing.then(() => importNow(deps, p))
  importing = done.catch(() => undefined)
  return done
}

async function importNow(deps: Deps, p: Params<'_harness/sessions/resume'>): Promise<SessionRecord> {
  const { sessions, workspaces, workspaceRoot } = deps
  const agent = p.agent ?? 'claude'
  if (!isChatAgentId(agent)) throw new Error(`Unknown agent ${String(p.agent)}`)
  const conversationId = p.conversationId ?? p.claudeSessionId
  if (!conversationId) throw new Error('Name the conversation to import')
  const existing = shownBy(sessions.all(), agent, conversationId)
  if (existing) return existing
  const label = chatAgentLabel(agent)
  const source = sourceOf(agent)
  const named = p.workspaceId ? { id: p.workspaceId, path: workspaceRoot(p.workspaceId) } : null
  const conversation = await source.find(conversationId, named?.path ?? null)
  if (!conversation) throw new Error(`${label} has no conversation ${conversationId} on this host`)
  const updates = await source.updates(conversation)
  const recorded = conversation.cwd
  const present = recorded ? await folderCheck()(recorded) : false
  const known = (await workspaces.snapshot()).workspaces.filter((w) => w.id !== FLOATING_WORKSPACE_ID)
  let target: { id: string; path: string }
  /** Where the thread runs: the recorded folder whenever it lies in the thread's workspace. */
  let cwd: string
  if (named) {
    // Asked for: the thread goes there, and keeps its folder only when that is the workspace's own.
    target = named
    const below = recorded && present ? folderBelow(recorded, named.path) : null
    const owner = recorded && below !== null ? owningWorkspace(recorded, known) : null
    cwd = below !== null && (!owner || owner.id === named.id) ? folderUnder(named.path, below) : named.path
  } else {
    if (!recorded) throw new Error(`${label} did not record this conversation's folder: choose the workspace to import it into`)
    const gone = (): Error => new Error(`This conversation's folder is gone (${recorded}): choose the workspace to import it into`)
    if (!present) throw gone()
    target =
      owningWorkspace(recorded, known) ??
      (await workspaces.workspaceForFolder(recorded).catch((error: unknown) => {
        // No folder to work in any more (a removed worktree); anything else is the project's own trouble.
        if (!/^No folder at /.test(error instanceof Error ? error.message : '')) throw error
        throw gone()
      }))
    cwd = folderUnder(target.path, folderBelow(recorded, target.path) ?? '')
  }
  const resumes = await source.resumesIn(conversation, cwd)
  const elsewhere = recorded && !sameFolder(recorded, cwd) ? recorded : null
  const record = sessions.create({
    workspaceId: target.id,
    cwd,
    title: conversation.title.slice(0, TITLE_CHARS),
    lastActivityAt: conversation.lastModified || Date.now(),
    importedFrom: { agent, conversationId },
    ...(agent === 'claude'
      ? { claudeSessionId: resumes ? conversationId : null }
      : {
          agent,
          // Its server starts with the first message, as after a daemon restart: an import of many starts none.
          agentState: { phase: 'ready', error: null, options: [], commands: [] },
          ...(resumes ? { agentSessionIds: { [agent]: conversationId } } : {})
        }),
    ...(resumes ? {} : { handoffContext: importHandoff(updates, { agent, cwd, origin: elsewhere }) })
  })
  await sessions.replaceTranscript(record.id, [
    ...updates,
    {
      sessionUpdate: 'notice',
      severity: 'info',
      title: resumes
        ? `Imported from ${label}. The next message continues ${label}'s own conversation.`
        : `Imported from ${label}${elsewhere ? ` (${elsewhere})` : ''}. ${label} starts a new conversation here and gets a selection of this thread, not its full context.`
    }
  ])
  return record
}

export { sameFolder }
