// Drafts and queued prompts, after T3 Code's composer (MIT; docs/specs/mobile/app.md#offline): a
// prompt written while the host is unreachable waits here, survives an app restart, shows as a
// chip that can be removed, and is sent in order, once, when the host is back. Storage is passed
// in: a file on the phone, memory in tests.

import { Observable } from './observable'

export interface QueuedPrompt {
  id: string
  hostId: string
  sessionId: string
  text: string
  queuedAt: number
}

/** Where the queue lives between runs. */
export interface QueueStorage {
  read(): Promise<string | null>
  write(text: string): Promise<void>
}

interface Saved {
  v: 1
  queue: QueuedPrompt[]
  drafts: Record<string, string>
}

export interface PromptQueueState {
  queue: readonly QueuedPrompt[]
  drafts: Readonly<Record<string, string>>
}

/**
 * Sends one prompt and waits for its turn. 'retry' only when it surely did not reach the host (the
 * connection was already down); anything else, even a connection lost mid-turn, counts as sent.
 */
export type SendPrompt = (prompt: QueuedPrompt) => Promise<'sent' | 'retry'>

const draftKey = (hostId: string, sessionId: string): string => `${hostId}\u0000${sessionId}`

export class PromptQueue {
  readonly state = new Observable<PromptQueueState>({ queue: [], drafts: {} })
  private saving: Promise<void> = Promise.resolve()
  private readonly flushing = new Set<string>()
  private nextId = 0

  constructor(
    private readonly storage: QueueStorage,
    private readonly now: () => number = Date.now
  ) {}

  /** Reads what the last run left; a damaged file starts empty. */
  async load(): Promise<void> {
    try {
      const raw = await this.storage.read()
      const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null
      const queue = Array.isArray(saved?.queue) ? saved.queue.filter(isPrompt) : []
      const drafts = saved?.drafts && typeof saved.drafts === 'object' ? (saved.drafts as Record<string, string>) : {}
      this.state.set({ queue, drafts })
    } catch {
      this.state.set({ queue: [], drafts: {} })
    }
  }

  list(hostId: string, sessionId?: string): QueuedPrompt[] {
    return this.state.get().queue.filter((p) => p.hostId === hostId && (sessionId === undefined || p.sessionId === sessionId))
  }

  async add(hostId: string, sessionId: string, text: string): Promise<QueuedPrompt> {
    const prompt: QueuedPrompt = { id: `q${this.now().toString(36)}-${(this.nextId++).toString(36)}`, hostId, sessionId, text, queuedAt: this.now() }
    this.state.update((s) => ({ ...s, queue: [...s.queue, prompt] }))
    await this.save()
    return prompt
  }

  /** Takes a queued prompt back before it goes. */
  async remove(id: string): Promise<void> {
    this.state.update((s) => ({ ...s, queue: s.queue.filter((p) => p.id !== id) }))
    await this.save()
  }

  /** Forgets everything queued for a host (it was unpaired). */
  async dropHost(hostId: string): Promise<void> {
    this.state.update((s) => ({
      queue: s.queue.filter((p) => p.hostId !== hostId),
      drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => !k.startsWith(`${hostId}\u0000`)))
    }))
    await this.save()
  }

  draft(hostId: string, sessionId: string): string {
    return this.state.get().drafts[draftKey(hostId, sessionId)] ?? ''
  }

  async setDraft(hostId: string, sessionId: string, text: string): Promise<void> {
    const key = draftKey(hostId, sessionId)
    this.state.update((s) => {
      const drafts = { ...s.drafts }
      if (text) drafts[key] = text
      else delete drafts[key]
      return { ...s, drafts }
    })
    await this.save()
  }

  /**
   * Sends the host's queued prompts in the order they were written, one turn at a time. Each leaves
   * the queue as it goes, so a connection lost mid-turn never sends it twice (at most once: an
   * agent run twice is worse than a prompt to write again). A prompt that surely did not go is put
   * back first in line and the run stops until the next reconnect. One run per host at a time.
   */
  async flush(hostId: string, send: SendPrompt): Promise<number> {
    if (this.flushing.has(hostId)) return 0
    this.flushing.add(hostId)
    let sent = 0
    try {
      for (;;) {
        const next = this.list(hostId)[0]
        if (!next) return sent
        await this.remove(next.id)
        let outcome: 'sent' | 'retry'
        try {
          outcome = await send(next)
        } catch {
          outcome = 'sent'
        }
        if (outcome === 'retry') {
          this.state.update((s) => ({ ...s, queue: [next, ...s.queue] }))
          await this.save()
          return sent
        }
        sent++
      }
    } finally {
      this.flushing.delete(hostId)
    }
  }

  private save(): Promise<void> {
    const { queue, drafts } = this.state.get()
    const text = JSON.stringify({ v: 1, queue: [...queue], drafts: { ...drafts } } satisfies Saved)
    // Writes run in order, so the file always ends with the latest state.
    this.saving = this.saving.then(() => this.storage.write(text)).catch(() => undefined)
    return this.saving
  }
}

function isPrompt(value: unknown): value is QueuedPrompt {
  const p = value as Partial<QueuedPrompt>
  return !!p && typeof p.id === 'string' && typeof p.hostId === 'string' && typeof p.sessionId === 'string' && typeof p.text === 'string' && typeof p.queuedAt === 'number'
}
