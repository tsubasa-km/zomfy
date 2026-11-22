// The daemon's one outbound WebSocket to Zomfy Relay, `/v1/host` (docs/specs/bots/daemon.md#connector-client).
// It proves the host key, reconnects with jittered backoff (1–30 s), pings every 30 s and drops a
// link that stays silent for two intervals. Bots and the phone relay each listen on their channel.

import { limits, linkSigningText, parseToHost, PING_FRAME, type ToHost } from '@zomfy/relay-contract'
import type { HostKey } from './relay-pairing'

export type RelayLinkState = 'connecting' | 'online' | 'offline' | 'unauthorized' | 'stopped'

export interface RelayLinkStatus {
  state: RelayLinkState
  lastConnectedAt: number | null
  retryAt: number | null
  error: string | null
}

export interface RelayLinkOptions {
  relayUrl: string
  hostId: string
  key: HostKey
  /** After `auth-ok`: the link may carry channel messages. */
  onOnline?: () => void
  /** Every parsed message except the link channel's own. */
  onMessage: (message: Exclude<ToHost, { ch: 'link' }>) => void
  onStatus?: (status: RelayLinkStatus) => void
  log?: (message: string) => void
  /** Injectable for tests. */
  WebSocket?: typeof WebSocket
  random?: () => number
  now?: () => number
  pingIntervalMs?: number
  backoff?: { minMs: number; maxMs: number }
}

/** Delay before reconnect attempt `attempt` (0-based): doubling from min to max, the upper half jittered. */
export function backoffDelay(attempt: number, random: () => number, minMs = limits.reconnectMinMs, maxMs = limits.reconnectMaxMs): number {
  const ceiling = Math.min(maxMs, minMs * 2 ** Math.min(attempt, 30))
  return Math.max(minMs, Math.round(ceiling / 2 + (random() * ceiling) / 2))
}

export class RelayLink {
  private ws: WebSocket | null = null
  private authed = false
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  /** A socket that has not authenticated within two ping intervals is dropped and dialled again. */
  private authTimer: ReturnType<typeof setTimeout> | null = null
  private heardSincePing = true
  private stopped = true
  private current: RelayLinkStatus = { state: 'stopped', lastConnectedAt: null, retryAt: null, error: null }

  constructor(private readonly options: RelayLinkOptions) {}

  get status(): RelayLinkStatus {
    return this.current
  }

  get online(): boolean {
    return this.authed && this.ws?.readyState === WebSocket.OPEN
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempt = 0
    this.open()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    const ws = this.ws
    this.ws = null
    this.authed = false
    try {
      ws?.close(1000, 'stopped')
    } catch {
      // already closed
    }
    this.setStatus({ state: 'stopped', retryAt: null, error: null })
  }

  /** Drops the link and dials again at once (the Hub's `control reconnect`). */
  reconnect(): void {
    if (this.stopped) return
    this.attempt = 0
    this.drop('reconnect requested', 0)
  }

  /** Sends a channel message; false when the link is not up (the caller keeps it for later). */
  send(message: object): boolean {
    if (!this.online) return false
    const text = JSON.stringify(message)
    if (text.length > limits.maxMessageBytes) throw new Error('message over the 1 MiB link limit')
    this.ws!.send(text)
    return true
  }

  private now() {
    return (this.options.now ?? Date.now)()
  }

  private setStatus(patch: Partial<RelayLinkStatus>) {
    this.current = { ...this.current, ...patch }
    this.options.onStatus?.(this.current)
  }

  private open() {
    const Impl = this.options.WebSocket ?? WebSocket
    const url = `${this.options.relayUrl.replace(/^http/, 'ws')}/v1/host?hostId=${encodeURIComponent(this.options.hostId)}`
    this.setStatus({ state: 'connecting', retryAt: null })
    let ws: WebSocket
    try {
      ws = new Impl(url)
    } catch (error) {
      this.scheduleRetry(String(error))
      return
    }
    this.ws = ws
    this.authed = false
    this.authTimer = setTimeout(() => {
      this.authTimer = null
      if (ws === this.ws && !this.authed) this.drop('no challenge from the relay')
    }, 2 * (this.options.pingIntervalMs ?? limits.pingIntervalMs))
    ws.onmessage = (event) => {
      if (ws !== this.ws) return
      this.heardSincePing = true
      this.onFrame(ws, String(event.data))
    }
    ws.onclose = (event) => {
      if (ws !== this.ws) return
      this.ws = null
      this.authed = false
      this.clearTimers()
      if (this.stopped) return
      if (event.code === limits.closeUnauthorized) {
        // A bad or revoked key will not get better by retrying: pair again.
        this.setStatus({ state: 'unauthorized', retryAt: null, error: 'The relay refused this host key. Pair again.' })
        this.options.log?.('relay link refused the host key (4401)')
        return
      }
      if (event.code === limits.closeReplaced) {
        this.setStatus({ state: 'offline', retryAt: null, error: 'Another link of this host replaced this one.' })
        this.options.log?.('relay link replaced by another link of this host (4409)')
        return
      }
      this.scheduleRetry(event.reason || `closed (${event.code})`)
    }
    ws.onerror = () => {
      // onclose follows and schedules the retry.
    }
  }

  private onFrame(ws: WebSocket, text: string) {
    const parsed = parseToHost(text)
    if (parsed.kind !== 'message') {
      if (parsed.kind === 'invalid') this.options.log?.(`relay sent an invalid ${parsed.ch ?? '?'}/${parsed.type ?? '?'}: ${parsed.error.slice(0, 200)}`)
      return
    }
    const message = parsed.message
    if (message.ch === 'link') {
      if (message.type === 'challenge') {
        ws.send(JSON.stringify({ ch: 'link', type: 'auth', signature: this.options.key.sign(linkSigningText(this.options.hostId, message.nonce)) }))
      } else if (message.type === 'auth-ok') {
        this.authed = true
        this.attempt = 0
        if (this.authTimer) clearTimeout(this.authTimer)
        this.authTimer = null
        this.setStatus({ state: 'online', lastConnectedAt: this.now(), retryAt: null, error: null })
        this.startPings(ws)
        this.options.onOnline?.()
      }
      return
    }
    if (!this.authed) return
    this.options.onMessage(message)
  }

  private startPings(ws: WebSocket) {
    this.heardSincePing = true
    const interval = this.options.pingIntervalMs ?? limits.pingIntervalMs
    this.pingTimer = setInterval(() => {
      if (ws !== this.ws) return
      if (!this.heardSincePing) {
        this.drop('no answer to ping')
        return
      }
      this.heardSincePing = false
      try {
        ws.send(PING_FRAME)
      } catch {
        this.drop('ping failed')
      }
    }, interval)
  }

  private drop(reason: string, delayMs?: number) {
    const ws = this.ws
    this.ws = null
    this.authed = false
    this.clearTimers()
    try {
      ws?.close(1000, reason)
    } catch {
      // already closed
    }
    if (delayMs === 0) this.open()
    else this.scheduleRetry(reason)
  }

  private scheduleRetry(error: string) {
    if (this.stopped) return
    const { minMs, maxMs } = this.options.backoff ?? { minMs: limits.reconnectMinMs, maxMs: limits.reconnectMaxMs }
    const delay = backoffDelay(this.attempt++, this.options.random ?? Math.random, minMs, maxMs)
    this.setStatus({ state: 'offline', retryAt: this.now() + delay, error })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.stopped) this.open()
    }, delay)
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.authTimer) clearTimeout(this.authTimer)
    this.authTimer = null
    this.retryTimer = null
    this.pingTimer = null
  }
}
