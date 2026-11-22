// The bots side of the relay link (docs/specs/bots/daemon.md#connector-client): `hello` after each
// connect and whenever bots or rules change, then deliveries. Each delivery gets a durable receipt
// before `ack received`; one that already has a receipt is acked again but not run again; `done`
// follows with the handler's outcome.

import {
  CONTRACT_VERSION,
  deliverySchema,
  limits,
  type AckOutcome,
  type BotEvent,
  type BotsToHost,
  type Delivery,
  type Failure,
  type HelloBot,
  type Rule,
  type Source
} from '@zomfy/relay-contract'
import type { ConnectorStatus } from '@zomfy/protocol'
import type { ReceiptStore } from './connector-receipts'
import type { Outbox } from './connector-outbox'
import { backoffDelay, RelayLink, type RelayLinkOptions, type RelayLinkStatus } from './relay-link'
import type { HostKey, RelayConfig } from './relay-pairing'

export interface DeliveryResult {
  outcome: AckOutcome
  failure?: Failure
}

export interface ConnectorHost {
  id: string
  name: string
  kind: 'desktop' | 'serve'
}

export interface ConnectorClientOptions {
  config: RelayConfig
  key: HostKey
  host: ConnectorHost
  receipts: ReceiptStore
  /** The bots and trigger rules this host announces. */
  bots: () => HelloBot[]
  rules?: () => Rule[]
  sources?: () => Source[]
  /** Runs one delivery; without a handler every delivery answers `unknown`. */
  handle?: (delivery: Delivery) => Promise<DeliveryResult>
  /** Where events wait for the link; without one, `queueEvent` drops them. */
  outbox?: Outbox
  /** Active conversations, sent as the first event after each `hello-ok`. */
  snapshot?: () => BotEvent
  onStatus?: (status: ConnectorStatus) => void
  log?: (message: string) => void
  now?: () => number
  fetch?: typeof fetch
  /** Passed to the link; for tests. */
  link?: Partial<Pick<RelayLinkOptions, 'WebSocket' | 'random' | 'pingIntervalMs' | 'backoff'>>
}

const FEATURES = ['hello-bots-pages', 'events-seq']

export class ConnectorClient {
  private readonly link: RelayLink
  private helloRev = 0
  private sources: string[] = []
  /** The next events batch's `seq`; 0 after each `hello-ok`. */
  private seq = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushAttempt = 0

  constructor(private readonly options: ConnectorClientOptions) {
    this.link = new RelayLink({
      relayUrl: options.config.relayUrl,
      hostId: options.config.hostId,
      key: options.key,
      log: options.log,
      ...options.link,
      onOnline: () => {
        this.helloRev = 0
        this.sendHello()
        void this.refreshSources()
      },
      onMessage: (message) => {
        if (message.ch === 'bots') void this.onBots(message)
      },
      onStatus: (status) => options.onStatus?.(this.toStatus(status))
    })
  }

  start(): void {
    this.link.start()
  }

  stop(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.link.stop()
  }

  /** Durably queues an event and sends it now if the link is up. */
  queueEvent(event: BotEvent): void {
    if (!this.options.outbox) return
    this.options.outbox.add(event, this.now())
    this.flush()
  }

  /** Sends what the outbox holds, in order, while the link is up and has said hello. */
  flush(): void {
    const outbox = this.options.outbox
    if (!outbox || this.flushTimer) return
    for (;;) {
      if (!this.helloRev || !this.link.online) return
      const batch = outbox.nextBatch()
      if (!batch.length) {
        this.flushAttempt = 0
        return
      }
      if (!this.sendEvents(batch.map((item) => item.event))) {
        this.retryFlush()
        return
      }
      outbox.done(batch)
    }
  }

  private sendEvents(events: BotEvent[]): boolean {
    try {
      if (!this.link.send({ ch: 'bots', type: 'events', helloRev: this.helloRev, seq: this.seq, events })) return false
    } catch (error) {
      // Over the link's message limit: smaller batches from now on.
      this.options.log?.(`connector: events batch not sent: ${String(error)}`)
      this.options.outbox?.shrink()
      return false
    }
    this.seq++
    return true
  }

  private retryFlush() {
    const delay = backoffDelay(this.flushAttempt++, Math.random)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, delay)
  }

  /** The `helloRev` of the current link, 0 before `hello-ok`. */
  get rev(): number {
    return this.helloRev
  }

  status(): ConnectorStatus {
    return this.toStatus(this.link.status)
  }

  /** Bots or rules changed: announce them again. */
  botsChanged(): void {
    if (this.link.online) this.sendHello()
  }

  private now() {
    return (this.options.now ?? Date.now)()
  }

  private toStatus(link: RelayLinkStatus): ConnectorStatus {
    return {
      state: link.state === 'stopped' ? 'offline' : link.state,
      relayUrl: this.options.config.relayUrl,
      hostId: this.options.config.hostId,
      sources: this.sources,
      lastConnectedAt: link.lastConnectedAt,
      retryAt: link.retryAt,
      error: link.error
    }
  }

  private async refreshSources() {
    try {
      const res = await (this.options.fetch ?? fetch)(`${this.options.config.relayUrl}/health`)
      const body = (await res.json()) as { sources?: unknown }
      if (Array.isArray(body.sources)) {
        this.sources = body.sources.filter((s): s is string => typeof s === 'string')
        this.options.onStatus?.(this.status())
      }
    } catch {
      // Health is only for the status view.
    }
  }

  private sendHello() {
    const bots = this.options.bots()
    const pages: HelloBot[][] = []
    for (let i = 0; i < bots.length; i += limits.maxBotsPerHello) pages.push(bots.slice(i, i + limits.maxBotsPerHello))
    if (!pages.length) pages.push([])
    if (pages.length > limits.maxHelloBotPages) {
      this.options.log?.(`connector: ${bots.length} bots is over the relay's limit; announcing the first ${limits.maxHelloBotPages * limits.maxBotsPerHello}`)
      pages.length = limits.maxHelloBotPages
    }
    const rules = (this.options.rules?.() ?? []).slice(0, limits.maxRulesPerHello)
    this.link.send({
      ch: 'bots',
      type: 'hello',
      contract: CONTRACT_VERSION,
      host: this.options.host,
      features: FEATURES,
      sources: this.options.sources?.() ?? [],
      promptKinds: ['approval', 'question'],
      bots: pages[0],
      rules,
      pages: pages.length
    })
    for (let page = 1; page < pages.length; page++) {
      this.link.send({ ch: 'bots', type: 'hello-bots', page: page + 1, bots: pages[page] })
    }
  }

  private async onBots(message: BotsToHost) {
    switch (message.type) {
      case 'hello-ok':
        this.helloRev = message.helloRev
        this.seq = 0
        if (this.options.snapshot) this.sendEvents([this.options.snapshot()])
        this.flush()
        return
      case 'delivery':
        if (message.helloRev !== this.helloRev) return // from before the latest hello; it will come again
        for (const raw of message.deliveries) void this.onDelivery(raw)
        return
      case 'error':
        if (message.code === 'hello_required') this.sendHello()
        else if (message.code === 'too_large') this.options.outbox?.shrink()
        else this.options.log?.(`connector: relay error ${message.code}: ${message.message}`)
        return
      case 'control':
        if (message.action === 'reconnect') this.link.reconnect()
        else this.options.log?.(`connector: relay asked to ${message.action}`)
        return
      case 'action-result':
        return
    }
  }

  private ack(deliveryId: string, step: 'received' | 'done', outcome?: AckOutcome, failure?: Failure) {
    this.link.send({
      ch: 'bots',
      type: 'ack',
      helloRev: this.helloRev,
      deliveryId,
      step,
      ...(outcome ? { outcome } : {}),
      ...(failure ? { failure } : {})
    })
  }

  private async onDelivery(raw: unknown) {
    const id = typeof raw === 'object' && raw && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : null
    if (!id) return
    const { receipts } = this.options
    const parsed = deliverySchema.safeParse(raw)
    const kind = parsed.success ? parsed.data.kind : String((raw as { kind?: unknown }).kind ?? 'unknown')

    const existing = receipts.get(id)
    if (existing) {
      // Seen before: ack again, never run again.
      this.ack(id, 'received')
      if (existing.outcome) this.ack(id, 'done', existing.outcome, existing.failure ?? undefined)
      return
    }
    receipts.receive(id, kind, this.now())
    this.ack(id, 'received')

    let result: DeliveryResult
    if (!parsed.success) result = { outcome: 'unsupported' }
    else if (parsed.data.expiresAt <= this.now()) result = { outcome: 'expired' }
    else {
      try {
        result = await (this.options.handle ?? defaultHandle)(parsed.data)
      } catch (error) {
        this.options.log?.(`connector: delivery ${id} failed: ${String(error)}`)
        result = { outcome: 'refused', failure: { category: 'agent_error' } }
      }
    }
    receipts.finish(id, result.outcome, result.failure, this.now())
    this.ack(id, 'done', result.outcome, result.failure)
  }
}

async function defaultHandle(): Promise<DeliveryResult> {
  return { outcome: 'unknown' }
}
