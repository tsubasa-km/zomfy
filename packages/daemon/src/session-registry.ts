import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import {
  TURN_RECOVERY_META,
  chatAgentLabel,
  type SessionInfo,
  type SessionOptions,
  type TurnEndMeta
} from '@acp-harness/protocol'
import { log } from './log.ts'
import { HARNESS_HOME } from './harness-home.ts'
import { CHAT_ATTACHMENT_DIR } from './chat-attachment-files.ts'

const SESSIONS_DIR = join(HARNESS_HOME, 'sessions')
const INDEX_PATH = join(SESSIONS_DIR, 'index.json')

export interface SessionRecord extends SessionInfo {
  /** Claude's own session id, so a later turn (or a restarted daemon) resumes the conversation. */
  claudeSessionId: string | null
  /** An external agent's own id for the conversation (its ACP session id). */
  agentSessionId?: string | null
  options: SessionOptions
  /** Context the next turn's prompt starts with, unseen in the transcript (a side chat's seed). */
  seedContext?: string | null
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

  async load(): Promise<void> {
    try {
      const saved: SessionRecord[] = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
      // A turn cannot outlive the daemon that ran it.
      for (const r of saved) {
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
      Partial<Pick<SessionRecord, 'title' | 'claudeSessionId' | 'options' | 'agent' | 'role' | 'sideOf' | 'seedContext' | 'localOnly'>>
  ): SessionRecord {
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: chatAgentLabel(fields.agent ?? 'claude'),
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
    Object.assign(record, patch)
    this.changed()
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id)
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
  private write(id: string, job: () => Promise<void>): Promise<void> {
    const done = (this.transcriptWrites.get(id) ?? Promise.resolve()).then(job)
    const tail = done.catch(() => undefined)
    this.transcriptWrites.set(id, tail)
    void tail.then(() => {
      if (this.transcriptWrites.get(id) === tail) this.transcriptWrites.delete(id)
    })
    return done
  }

  record(id: string, update: acp.SessionUpdate): Promise<void> {
    const line = `${JSON.stringify(update)}\n`
    return this.write(id, async () => {
      await mkdir(SESSIONS_DIR, { recursive: true })
      await appendFile(transcriptPath(id), line)
    })
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
  const { claudeSessionId: _hidden, agentSessionId: _agentHidden, seedContext: _seedHidden, ...info } = record
  return info
}
