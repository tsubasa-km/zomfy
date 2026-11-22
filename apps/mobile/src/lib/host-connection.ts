// One connection owner per paired host, after T3 Code's connection supervisor (MIT): it picks a
// route, opens the device socket, speaks ACP on it, keeps the host's projects, workspaces and chats
// current, and reconnects with a jittered backoff. Screens only read its state and call through it.

import type * as acp from '@agentclientprotocol/sdk'
import {
  HARNESS_METHODS,
  HARNESS_NOTIFICATIONS,
  PERMISSION_ASK_NOTIFICATIONS,
  type DeviceScope,
  type HarnessState,
  type PermissionAskResolved,
  type RemoteRoute,
  type SessionInfo
} from '@zomfy/protocol'
import type { AskStore } from './asks'
import { connectDevice, GatewayError, probeRoute, type FetchLike, type GatewaySocket, type SocketFactory } from './gateway-client'
import { JsonRpcPeer } from './json-rpc'
import { Observable } from './observable'
import type { DeviceKeys } from './pairing'
import { backoffDelay, realTimers, RouteChooser, type Timers } from './routes'

/** ACP's protocol version; the SDK's PROTOCOL_VERSION, kept here so the app needs no SDK runtime. */
export const ACP_PROTOCOL_VERSION = 1

/** A host this phone paired with, as it is kept in secure storage. */
export interface PairedHost {
  hostId: string
  hostName: string
  deviceId: string
  /** What the phone called itself when it paired. */
  deviceName: string
  scopes: DeviceScope[]
  /** In the offer's order: the first is preferred. */
  routes: RemoteRoute[]
  keys: DeviceKeys
  pairedAt: number
}

export type ConnectionStatus = 'connecting' | 'connected' | 'offline' | 'unpaired' | 'stopped'

export interface HostConnectionState {
  status: ConnectionStatus
  /** The route in use while connected. */
  route: RemoteRoute | null
  /** What the host granted on this connection (its `ready` frame). */
  scopes: DeviceScope[]
  error: string | null
  /** When the next reconnect attempt runs, while offline. */
  nextRetryAt: number | null
  harness: HarnessState | null
  sessions: SessionInfo[]
  /** Counts successful connects, so open chats know to replay after a reconnect. */
  generation: number
}

export interface HostConnectionDeps {
  fetch: FetchLike
  createSocket: SocketFactory
  asks: AskStore
  clientVersion: string
  timers?: Timers
  random?: () => number
  probeTimeoutMs?: number
}

export type SessionUpdateListener = (notification: acp.SessionNotification) => void

const NOT_CONNECTED = 'Not connected to this host'

export class HostConnection {
  readonly state: Observable<HostConnectionState>
  private readonly timers: Timers
  private readonly chooser: RouteChooser
  private readonly updateListeners = new Set<SessionUpdateListener>()
  private socket: GatewaySocket | null = null
  private peer: JsonRpcPeer | null = null
  private retryTimer: unknown = null
  private attempt = 0
  /** Bumped by every connect attempt and by stop, so stale callbacks do nothing. */
  private run = 0
  private connecting = false
  private switchTo: number | null = null
  private stopped = true

  constructor(
    readonly host: PairedHost,
    private readonly deps: HostConnectionDeps
  ) {
    this.timers = deps.timers ?? realTimers
    this.state = new Observable<HostConnectionState>({
      status: 'stopped',
      route: null,
      scopes: host.scopes,
      error: null,
      nextRetryAt: null,
      harness: null,
      sessions: [],
      generation: 0
    })
    this.chooser = new RouteChooser({
      routes: host.routes,
      probe: async (route) =>
        (await probeRoute(deps.fetch, route.url, deps.probeTimeoutMs ?? 3000)).hostId === host.hostId,
      timers: this.timers,
      ...(deps.random ? { random: deps.random } : {}),
      onPreferredRecovered: (index) => {
        // A better route answers again: drop this socket and connect there.
        this.switchTo = index
        this.socket?.close()
      }
    })
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    this.run++
    this.connecting = false
    this.clearRetry()
    this.chooser.stop()
    this.teardown()
    this.patch({ status: 'stopped', route: null, nextRetryAt: null })
  }

  /** Try again now (the app came to the foreground, or the person asked). */
  retryNow(): void {
    if (this.stopped || this.connecting) return
    const { status } = this.state.get()
    if (status !== 'offline') return
    this.clearRetry()
    this.attempt = 0
    void this.connect()
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.peer || this.state.get().status !== 'connected') return Promise.reject(new Error(NOT_CONNECTED))
    return this.peer.request<T>(method, params)
  }

  notify(method: string, params?: unknown): void {
    if (!this.peer || this.state.get().status !== 'connected') throw new Error(NOT_CONNECTED)
    this.peer.notify(method, params)
  }

  onSessionUpdate(listener: SessionUpdateListener): () => void {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  private patch(change: Partial<HostConnectionState>): void {
    this.state.update((s) => ({ ...s, ...change }))
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private teardown(): void {
    if (this.socket) {
      // Closed on purpose: its close event must not schedule another reconnect.
      this.socket.onClose = () => {}
      this.socket.onMessage = () => {}
      this.socket.close()
    }
    this.socket = null
    this.peer?.close()
    this.peer = null
    this.deps.asks.dropHost(this.host.hostId)
  }

  private scheduleRetry(error: string): void {
    if (this.stopped) return
    const delay = backoffDelay(this.attempt++, this.deps.random)
    this.patch({ status: 'offline', route: null, error, nextRetryAt: this.timers.now() + delay })
    this.clearRetry()
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, delay)
  }

  private unpaired(error: GatewayError): void {
    this.stopped = true
    this.clearRetry()
    this.chooser.stop()
    this.teardown()
    this.patch({ status: 'unpaired', route: null, error: error.message, nextRetryAt: null })
  }

  private async connect(preferred: number | null = null): Promise<void> {
    if (this.stopped || this.connecting) return
    this.connecting = true
    const run = ++this.run
    this.patch({ status: 'connecting', nextRetryAt: null })
    try {
      const index = preferred ?? (await this.chooser.pick())
      if (run !== this.run) return
      if (index === null) {
        this.scheduleRetry('No route to the host answers')
        return
      }
      const route = this.host.routes[index]!
      let socket: GatewaySocket
      try {
        socket = await connectDevice(this.deps.createSocket, route.url, {
          hostId: this.host.hostId,
          deviceId: this.host.deviceId,
          secretKey: this.host.keys.secretKey
        })
      } catch (error) {
        if (run !== this.run) return
        if (error instanceof GatewayError && error.unpaired) this.unpaired(error)
        else this.scheduleRetry(error instanceof Error ? error.message : String(error))
        return
      }
      if (run !== this.run) {
        socket.close()
        return
      }
      const peer = this.attach(socket, run)
      try {
        await peer.request('initialize', {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: 'zomfy-android', version: this.deps.clientVersion }
        })
        const [harness, sessions] = await Promise.all([
          peer.request<HarnessState>(HARNESS_METHODS.stateGet, {}),
          peer.request<SessionInfo[]>(HARNESS_METHODS.sessionsList, {})
        ])
        if (run !== this.run) return
        this.attempt = 0
        this.chooser.use(index)
        this.patch({
          status: 'connected',
          route,
          scopes: socket.scopes,
          error: null,
          harness,
          sessions,
          generation: this.state.get().generation + 1
        })
      } catch (error) {
        if (run !== this.run) return
        this.teardown()
        this.scheduleRetry(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (run === this.run) this.connecting = false
    }
  }

  private attach(socket: GatewaySocket, run: number): JsonRpcPeer {
    const peer = new JsonRpcPeer((text) => socket.send(text))
    this.socket = socket
    this.peer = peer
    socket.onMessage = (text) => peer.receive(text)
    socket.onClose = (error) => {
      if (run !== this.run) return
      peer.close()
      this.socket = null
      this.peer = null
      this.deps.asks.dropHost(this.host.hostId)
      this.chooser.release()
      this.connecting = false
      if (error.unpaired) {
        this.unpaired(error)
        return
      }
      const switchTo = this.switchTo
      this.switchTo = null
      if (switchTo !== null) {
        void this.connect(switchTo)
        return
      }
      this.scheduleRetry(error.message)
    }
    peer.onNotification((method, params) => this.onNotification(method, params))
    peer.onRequest('session/request_permission', (params) => {
      const request = params as acp.RequestPermissionRequest
      return new Promise<acp.RequestPermissionResponse>((resolve) => {
        this.deps.asks.add(this.host.hostId, request, resolve)
      })
    })
    return peer
  }

  private onNotification(method: string, params: unknown): void {
    switch (method) {
      case 'session/update': {
        const notification = params as acp.SessionNotification
        for (const listener of [...this.updateListeners]) listener(notification)
        break
      }
      case HARNESS_NOTIFICATIONS.sessionsChanged:
        if (Array.isArray(params)) this.patch({ sessions: params as SessionInfo[] })
        break
      case HARNESS_NOTIFICATIONS.stateChanged:
        if (params && typeof params === 'object') this.patch({ harness: params as HarnessState })
        break
      case PERMISSION_ASK_NOTIFICATIONS.resolved:
        this.deps.asks.resolved(this.host.hostId, params as PermissionAskResolved)
        break
    }
  }
}
