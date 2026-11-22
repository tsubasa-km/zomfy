// An open chat: loads its transcript with `session/load` (the replay inside the response), folds
// live `session/update`s in, and loads again after every reconnect, replacing what it had. Live
// updates that race the load are kept and spliced by their `seq` (SESSION_REPLAY_META).

import type * as acp from '@agentclientprotocol/sdk'
import { promptNotSent, SESSION_REPLAY_META } from '@zomfy/protocol'
import type { HostConnection } from './host-connection'
import { Observable } from './observable'
import { applyUpdate, transcriptFrom, type SessionUpdate, type TranscriptItem } from './transcript'

export interface ChatState {
  items: TranscriptItem[]
  /** A load is running (the first one, or the replay after a reconnect). */
  loading: boolean
  error: string | null
  /** A prompt this phone sent is still running. */
  sending: boolean
}

type Buffered = { seq: number | null; update: SessionUpdate }

export type PromptOutcome = { sent: true } | { sent: false; error: string }

export class ChatSession {
  readonly state = new Observable<ChatState>({ items: [], loading: true, error: null, sending: false })
  private buffer: Buffered[] | null = null
  private loadRun = 0
  private generation = -1
  private unsubscribers: (() => void)[] = []

  constructor(
    private readonly connection: HostConnection,
    readonly sessionId: string
  ) {}

  open(): void {
    this.unsubscribers.push(
      this.connection.onSessionUpdate((n) => this.onUpdate(n)),
      this.connection.state.subscribe(() => this.onConnection())
    )
    this.onConnection()
  }

  close(): void {
    for (const off of this.unsubscribers) off()
    this.unsubscribers = []
    this.loadRun++
  }

  async send(text: string): Promise<PromptOutcome> {
    const trimmed = text.trim()
    if (!trimmed) return { sent: false, error: 'Nothing to send' }
    this.patch({ sending: true })
    try {
      const result = await this.connection.request<acp.PromptResponse>('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: trimmed }]
      })
      if (promptNotSent(result?._meta ?? null)) return { sent: false, error: 'The host did not send this message' }
      return { sent: true }
    } catch (error) {
      return { sent: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.patch({ sending: false })
    }
  }

  /** Stops the running turn; ACP's cancel is a notification. */
  stop(): void {
    this.connection.notify('session/cancel', { sessionId: this.sessionId })
  }

  private patch(change: Partial<ChatState>): void {
    this.state.update((s) => ({ ...s, ...change }))
  }

  private onConnection(): void {
    const { status, generation } = this.connection.state.get()
    if (status !== 'connected' || generation === this.generation) return
    this.generation = generation
    void this.load()
  }

  private onUpdate(notification: acp.SessionNotification): void {
    if (notification.sessionId !== this.sessionId) return
    const rawSeq = notification._meta?.[SESSION_REPLAY_META.seq]
    const seq = typeof rawSeq === 'number' ? rawSeq : null
    if (this.buffer) {
      this.buffer.push({ seq, update: notification.update })
      return
    }
    this.state.update((s) => {
      const items = applyUpdate(s.items, notification.update)
      return items === s.items ? s : { ...s, items }
    })
  }

  private async load(): Promise<void> {
    const run = ++this.loadRun
    this.buffer = []
    this.patch({ loading: true, error: null })
    try {
      const response = await this.connection.request<acp.LoadSessionResponse>('session/load', {
        sessionId: this.sessionId,
        cwd: '/',
        mcpServers: [],
        _meta: { [SESSION_REPLAY_META.inResponse]: true }
      })
      if (run !== this.loadRun) return
      const meta = response?._meta ?? {}
      const replay = meta[SESSION_REPLAY_META.updates]
      const through = meta[SESSION_REPLAY_META.replayedThrough]
      const buffered = this.buffer ?? []
      this.buffer = null
      let items: TranscriptItem[]
      if (Array.isArray(replay)) {
        items = transcriptFrom(replay as SessionUpdate[])
        const after = typeof through === 'number' ? buffered.filter((b) => b.seq === null || b.seq > through) : buffered
        items = after.reduce((acc, b) => applyUpdate(acc, b.update), items)
      } else {
        // An older daemon replays as notifications, which arrived (in order) during the load.
        items = transcriptFrom(buffered.map((b) => b.update))
      }
      this.patch({ items, loading: false, error: null })
    } catch (error) {
      if (run !== this.loadRun) return
      this.buffer = null
      this.patch({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
