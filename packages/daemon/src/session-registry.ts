import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk'
import type { SessionInfo } from '@acp-harness/protocol'
import { log } from './log.ts'
import { HARNESS_HOME } from './harness-home.ts'

const SESSIONS_DIR = join(HARNESS_HOME, 'sessions')
const INDEX_PATH = join(SESSIONS_DIR, 'index.json')

export interface SessionRecord extends SessionInfo {
  /** Claude's own session id, so a later turn (or a restarted daemon) resumes the conversation. */
  claudeSessionId: string | null
}

/**
 * The daemon's single store of sessions: who they belong to, their live status, and a replayable
 * transcript of every update sent for them. Every client reads status from here.
 */
export class SessionRegistry {
  private readonly records = new Map<string, SessionRecord>()
  private readonly listeners = new Set<(sessions: SessionInfo[]) => void>()
  private saveQueue: Promise<void> = Promise.resolve()

  async load(): Promise<void> {
    try {
      const saved: SessionRecord[] = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
      // A turn cannot outlive the daemon that ran it.
      for (const r of saved) this.records.set(r.id, { ...r, status: r.status === 'error' ? 'error' : 'idle', turnStartedAt: null })
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

  create(fields: Pick<SessionInfo, 'workspaceId' | 'cwd'>): SessionRecord {
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: 'Claude',
      status: 'idle',
      createdAt: Date.now(),
      turnStartedAt: null,
      claudeSessionId: null,
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
  }

  /** Removes every session of a workspace that no longer exists. */
  async removeWorkspace(workspaceId: string): Promise<void> {
    for (const record of [...this.records.values()]) {
      if (record.workspaceId === workspaceId) await this.remove(record.id)
    }
  }

  async record(id: string, update: acp.SessionUpdate): Promise<void> {
    await mkdir(SESSIONS_DIR, { recursive: true })
    await appendFile(transcriptPath(id), `${JSON.stringify(update)}\n`)
  }

  async transcript(id: string): Promise<acp.SessionUpdate[]> {
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

function publicInfo(record: SessionRecord): SessionInfo {
  const { claudeSessionId: _hidden, ...info } = record
  return info
}
