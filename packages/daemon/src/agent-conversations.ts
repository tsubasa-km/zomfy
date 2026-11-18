import { resolve } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import { chatAgentLabel, isChatAgentId, type ChatAgentId, type HarnessMethod, type HarnessRequests, type PastConversation } from '@acp-harness/protocol'
import { acpConversationUpdates, listAcpConversations } from './acp-agent-history.ts'
import { importHandoff } from './agent-handoff.ts'
import { conversationUpdates, findConversation, listConversations } from './claude-history.ts'
import { codexConversationUpdates, findCodexConversation, listCodexConversations } from './codex-history.ts'
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

/** `_harness/sessions/history`. */
export async function pastConversations(deps: Deps, p: Params<'_harness/sessions/history'>): Promise<PastConversation[]> {
  const agents = (p.agents ?? ['claude']).filter(isChatAgentId)
  const cwd = p.workspaceId ? deps.workspaceRoot(p.workspaceId) : null
  const workspaces = (await deps.workspaces.snapshot()).workspaces.filter((w) => w.id !== FLOATING_WORKSPACE_ID)
  const sessions = deps.sessions.all()
  const lists = await Promise.all(
    agents.map(async (agent) => {
      const listed = await sourceOf(agent)
        .list(cwd)
        .catch((error: unknown) => {
          // One agent that cannot be read does not hide the others; asked for alone, it says why.
          if (agents.length === 1) throw error
          log(`listing ${agent}'s conversations failed: ${String(error)}`)
          return []
        })
      return listed.map(
        (c): PastConversation => ({
          agent,
          conversationId: c.conversationId,
          claudeSessionId: c.conversationId,
          title: c.title,
          lastModified: c.lastModified,
          gitBranch: c.gitBranch,
          cwd: c.cwd,
          workspaceId: p.workspaceId ?? (c.cwd ? (workspaces.find((w) => sameFolder(w.path, c.cwd ?? '')) ?? null)?.id : null) ?? null,
          openSessionId: shownBy(sessions, agent, c.conversationId)?.id ?? null
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
  const asked = p.workspaceId ? { id: p.workspaceId, path: workspaceRoot(p.workspaceId) } : null
  const conversation = await source.find(conversationId, asked?.path ?? null)
  if (!conversation) throw new Error(`${label} has no conversation ${conversationId} on this host`)
  const updates = await source.updates(conversation)
  let target = asked
  if (!target) {
    if (!conversation.cwd) throw new Error(`${label} did not record this conversation's folder: choose the workspace to import it into`)
    target = await workspaces.workspaceForFolder(conversation.cwd).catch((error: unknown) => {
      // No folder to work in any more (a removed worktree); anything else is the project's own trouble.
      if (!/^No folder at /.test(error instanceof Error ? error.message : '')) throw error
      throw new Error(`This conversation's folder is gone (${conversation.cwd}): choose the workspace to import it into`)
    })
  }
  const resumes = await source.resumesIn(conversation, target.path)
  const elsewhere = conversation.cwd && !sameFolder(conversation.cwd, target.path) ? conversation.cwd : null
  const record = sessions.create({
    workspaceId: target.id,
    cwd: target.path,
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
    ...(resumes ? {} : { handoffContext: importHandoff(updates, { agent, cwd: target.path, origin: elsewhere }) })
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

/** Whether two paths name one folder, however each agent wrote it down. */
export function sameFolder(a: string, b: string): boolean {
  const plain = (path: string): string => {
    const resolved = resolve(path.replace(/^\\\\\?\\/, ''))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return plain(a) === plain(b)
}
