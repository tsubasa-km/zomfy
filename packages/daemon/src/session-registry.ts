import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import {
  TURN_RECOVERY_META,
  NEW_CHAT_TITLE,
  type ChatAgentId,
  type SessionInfo,
  type SessionOptions,
  type TurnEndMeta
} from '@zomfy/protocol'
import { log } from './log.ts'
import { HARNESS_HOME } from './harness-home.ts'
import { CHAT_ATTACHMENT_DIR } from './chat-attachment-files.ts'

const SESSIONS_DIR = join(HARNESS_HOME, 'sessions')
const INDEX_PATH = join(SESSIONS_DIR, 'index.json')

export interface SessionRecord extends SessionInfo {
  /** Claude's own session id, so a later turn (or a restarted daemon) resumes the conversation. */
  claudeSessionId: string | null
  /**
   * External agents' own ids for the conversation (their ACP session ids), by agent: a chat whose
   * agent was changed keeps each one's, so changing back reopens that agent's conversation.
   */
  agentSessionIds?: Partial<Record<ChatAgentId, string>>
  options: SessionOptions
  /** Context the next turn's prompt starts with, unseen in the transcript (a side chat's seed). */
  seedContext?: string | null
  /**
   * The conversation so far for an agent that just took over the chat (agent-handoff.ts); the next
   * turn's prompt starts with it, ahead of `seedContext`. Kept apart from it: activity notes rewrite that.
   */
  handoffContext?: string | null
  /** The conversation of an agent's own CLI this thread was imported from, so it is not offered again. */
  importedFrom?: { agent: ChatAgentId; conversationId: string }
}

/** Records saved before a chat could change agents kept one `agentSessionId`, its only agent's. */
export function savedAgentSessionIds(
  saved: Pick<SessionRecord, 'agent' | 'agentSessionIds'> & { agentSessionId?: string | null }
): SessionRecord['agentSessionIds'] {
  if (saved.agentSessionIds) return saved.agentSessionIds
  return saved.agentSessionId && saved.agent && saved.agent !== 'claude' ? { [saved.agent]: saved.agentSessionId } : undefined
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = { model: null, permissionMode: 'default', effort: null }

/**
 * The daemon's single store of sessions: who they belong to, their live status, and a replayable
 * transcript of every update sent for them. Every client reads status from here.
 */
export class SessionRegistry {
  private readonly records = new Map<string, SessionRecord>()
  private readonly listeners = new Set<(sessions: SessionInfo[]) => void>()
  private saveQueue: Promise<void> = Promise.resolve()
  private readonly transcriptWrites = new Map<string, Promise<void>>()
  /** Updates recorded per session since this daemon started (SESSION_REPLAY_META.seq). */
  private readonly seqs = new Map<string, number>()

  async load(): Promise<void> {
    try {
      const saved: (SessionRecord & { agentSessionId?: string | null })[] = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
      // A turn cannot outlive the daemon that ran it.
      for (const { agentSessionId, ...r } of saved) {
        if (r.status === 'working' || r.status === 'needs-you') {
          // Recorded, so the chat shows where it stopped and can offer Continue.
          const end: TurnEndMeta = { reason: 'interrupted' }
          await this.record(r.id, {
            sessionUpdate: 'notice',
            severity: 'warning',
            title: 'Stopped: the daemon restarted during this turn',
            _meta: { [TURN_RECOVERY_META.turnEnd]: end }
          }).catch(() => undefined)
        }
        this.records.set(r.id, {
          ...r,
          options: { ...DEFAULT_SESSION_OPTIONS, ...r.options },
          agentSessionIds: savedAgentSessionIds({ ...r, agentSessionId }),
          status: r.status === 'error' ? 'error' : 'idle',
          turnStartedAt: null,
          // Its server is not running yet; the next turn starts it.
          ...(r.agentState?.phase === 'starting' ? { agentState: { ...r.agentState, phase: 'ready' as const } } : {})
        })
      }
    } catch {
      // First run.
    }
  }

  onChange(listener: (sessions: SessionInfo[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): SessionInfo[] {
    return [...this.records.values()].map(publicInfo)
  }

  get(id: string): SessionRecord | undefined {
    return this.records.get(id)
  }

  all(): SessionRecord[] {
    return [...this.records.values()]
  }

  create(
    fields: Pick<SessionInfo, 'workspaceId' | 'cwd'> &
      Partial<
        Pick<
          SessionRecord,
          | 'title'
          | 'claudeSessionId'
          | 'options'
          | 'agent'
          | 'role'
          | 'sideOf'
          | 'parentId'
          | 'seedContext'
          | 'handoffContext'
          | 'localOnly'
          | 'origin'
          | 'botId'
          | 'botFrom'
          | 'agentSessionIds'
          | 'agentState'
          | 'importedFrom'
          | 'lastActivityAt'
        >
      >
  ): SessionRecord {
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: NEW_CHAT_TITLE,
      status: 'idle',
      createdAt: Date.now(),
      turnStartedAt: null,
      claudeSessionId: null,
      options: { ...DEFAULT_SESSION_OPTIONS },
      ...fields
    }
    this.records.set(record.id, record)
    this.changed()
    return record
  }

  update(id: string, patch: Partial<SessionRecord>): void {
    const record = this.records.get(id)
    if (!record) return
    // A turn starting or ending is what "recently active" means to the chat list.
    const turnChanged = 'turnStartedAt' in patch && patch.turnStartedAt !== record.turnStartedAt
    Object.assign(record, patch, turnChanged ? { lastActivityAt: Date.now() } : {})
    this.changed()
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id)
    this.seqs.delete(id)
    this.changed()
    await rm(transcriptPath(id), { force: true })
    await rm(notePath(id), { force: true })
    await rm(join(CHAT_ATTACHMENT_DIR, id), { recursive: true, force: true })
  }

  /** The chat's memo; empty when it has none. */
  async readNote(id: string): Promise<string> {
    try {
      return await readFile(notePath(id), 'utf8')
    } catch {
      return ''
    }
  }

  /** Empty text removes the memo; otherwise written whole, via a temp file so a crash never truncates it. */
  async writeNote(id: string, text: string): Promise<void> {
    if (!text) {
      await rm(notePath(id), { force: true })
      return
    }
    await mkdir(SESSIONS_DIR, { recursive: true })
    const temp = `${notePath(id)}.${process.pid}.tmp`
    await writeFile(temp, text)
    await rename(temp, notePath(id))
  }

  /** The chat a new child of `id` hangs under: `id` itself, or its own parent, so nesting stays one level deep. */
  parentFor(id: string | undefined): string | undefined {
    const record = id ? this.records.get(id) : undefined
    if (!record) return undefined
    const above = record.parentId ?? record.sideOf
    return above && this.records.has(above) ? above : record.id
  }

  /** Removes every session of a workspace that no longer exists. */
  async removeWorkspace(workspaceId: string): Promise<void> {
    for (const record of [...this.records.values()]) {
      if (record.workspaceId === workspaceId) await this.remove(record.id)
    }
  }

  /**
   * Writes to one transcript in the order they were asked for. An external agent's updates arrive
   * without waiting for each other; unqueued, their appends could land out of order.
   */
  private write<T>(id: string, job: () => Promise<T>): Promise<T> {
    const done = (this.transcriptWrites.get(id) ?? Promise.resolve()).then(job)
    const tail = done.then(
      () => undefined,
      () => undefined
    )
    this.transcriptWrites.set(id, tail)
    void tail.then(() => {
      if (this.transcriptWrites.get(id) === tail) this.transcriptWrites.delete(id)
    })
    return done
  }

  /** Resolves to the update's seq (SESSION_REPLAY_META.seq): rising per session through this daemon run. */
  record(id: string, update: acp.SessionUpdate): Promise<number> {
    const line = `${JSON.stringify(update)}\n`
    return this.write(id, async () => {
      await mkdir(SESSIONS_DIR, { recursive: true })
      await appendFile(transcriptPath(id), line)
      const seq = (this.seqs.get(id) ?? 0) + 1
      this.seqs.set(id, seq)
      return seq
    })
  }

  /**
   * Hands `use` the transcript and the last seq it holds, with no update recorded meanwhile. `use` is
   * synchronous, so a replay it queues goes out before any update recorded after it.
   */
  snapshot<T>(id: string, use: (updates: acp.SessionUpdate[], through: number) => T): Promise<T> {
    return this.write(id, async () => use(await this.readTranscript(id), this.seqs.get(id) ?? 0))
  }

  /** Rewrites the whole transcript (rewind, fork, a conversation resumed from disk). */
  replaceTranscript(id: string, updates: acp.SessionUpdate[]): Promise<void> {
    const text = updates.map((u) => `${JSON.stringify(u)}\n`).join('')
    return this.write(id, async () => {
      await mkdir(SESSIONS_DIR, { recursive: true })
      await writeFile(transcriptPath(id), text)
    })
  }

  async transcript(id: string): Promise<acp.SessionUpdate[]> {
    await this.transcriptWrites.get(id)
    return this.readTranscript(id)
  }

  private async readTranscript(id: string): Promise<acp.SessionUpdate[]> {
    try {
      const text = await readFile(transcriptPath(id), 'utf8')
      return text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as acp.SessionUpdate)
    } catch {
      return []
    }
  }

  /** Resolves once every change so far is on disk. */
  flushed(): Promise<void> {
    return this.saveQueue.catch(() => undefined)
  }

  private changed(): void {
    const sessions = this.list()
    for (const listener of this.listeners) listener(sessions)
    // Serialized so an older snapshot never lands after a newer one.
    this.saveQueue = this.saveQueue
      .then(async () => {
        await mkdir(SESSIONS_DIR, { recursive: true })
        await writeFile(INDEX_PATH, JSON.stringify([...this.records.values()], null, 2))
      })
      .catch((error) => log(`saving sessions failed: ${String(error)}`))
  }
}

function transcriptPath(id: string): string {
  return join(SESSIONS_DIR, `${id}.jsonl`)
}

function notePath(id: string): string {
  return join(SESSIONS_DIR, `${id}.notes.md`)
}

export function publicInfo(record: SessionRecord): SessionInfo {
  const {
    claudeSessionId: _hidden,
    agentSessionIds: _agentHidden,
    seedContext: _seedHidden,
    handoffContext: _handoffHidden,
    importedFrom: _importHidden,
    ...info
  } = record
  return info
}
