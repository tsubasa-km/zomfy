// Fakes for the lib tests: timers that move only when told, and an in-memory gateway that plays
// the daemon's side of /v1/hello, /v1/pair and /v1/device.

import { ed25519 } from '@noble/curves/ed25519.js'
import {
  deviceAuthPayload,
  fromBase64Url,
  GATEWAY_CLOSE,
  type DeviceScope,
  type GatewayFrame,
  type PairRequest
} from '@zomfy/protocol'
import type { FetchLike, SocketLike } from './gateway-client'
import type { Timers } from './routes'

export class FakeTimers implements Timers {
  private time = 0
  private nextHandle = 1
  private readonly tasks = new Map<number, { at: number; run: () => void }>()

  now = (): number => this.time
  setTimeout = (run: () => void, ms: number): unknown => {
    const handle = this.nextHandle++
    this.tasks.set(handle, { at: this.time + ms, run })
    return handle
  }
  clearTimeout = (handle: unknown): void => {
    this.tasks.delete(handle as number)
  }
  get pending(): number {
    return this.tasks.size
  }
  /** Moves time on, running every task that comes due, in order. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms
    for (;;) {
      const due = [...this.tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.tasks.delete(due[0])
      this.time = due[1].at
      due[1].run()
      await flush()
    }
    this.time = end
    await flush()
  }
}

/** Lets pending promise callbacks run. */
export async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export const testRandomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length))

type RpcHandler = (params: unknown, server: FakeGateway) => unknown

interface Device {
  publicKey: Uint8Array
  scopes: DeviceScope[]
}

/** One fake host reachable on a set of route URLs. */
export class FakeGateway {
  readonly devices = new Map<string, Device>()
  readonly grants = new Set<string>()
  readonly handlers = new Map<string, RpcHandler>()
  readonly received: { method: string; params: unknown; id?: number | string }[] = []
  readonly sockets: FakeServerSocket[] = []
  /** Route URLs that answer; others fail like an unreachable address. */
  readonly live = new Set<string>()
  scopes: DeviceScope[] = ['chats:read', 'chats:operate']
  private devices_ = 0

  constructor(
    readonly hostId: string,
    readonly hostName = 'Test host'
  ) {}

  fetch: FetchLike = async (url, init) => {
    const match = [...this.live].find((base) => url.startsWith(base))
    if (!match) throw new Error('unreachable')
    const path = url.slice(match.length)
    const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body })
    if (path === '/v1/hello') return json(200, { hostId: this.hostId, hostName: this.hostName })
    if (path === '/v1/pair' && init?.method === 'POST') {
      const request = JSON.parse(init.body ?? '{}') as PairRequest
      if (!this.grants.delete(request.grant)) return json(403, { error: 'This pairing link was already used or expired' })
      const deviceId = `device-${++this.devices_}`
      this.devices.set(deviceId, { publicKey: fromBase64Url(request.publicKey), scopes: this.scopes })
      return json(200, { deviceId, hostId: this.hostId, hostName: this.hostName, scopes: this.scopes })
    }
    return json(404, { error: 'not found' })
  }

  createSocket = (url: string): SocketLike => {
    const live = [...this.live].some((base) => url.startsWith(base.replace(/^http/, 'ws')))
    const socket = new FakeServerSocket(this, url, live)
    this.sockets.push(socket)
    return socket
  }

  /** The socket that is authenticated and open now, if any. */
  get openSocket(): FakeServerSocket | undefined {
    return this.sockets.find((s) => s.authed && s.readyState === 1)
  }

  notify(method: string, params: unknown): void {
    this.openSocket?.deliver({ jsonrpc: '2.0', method, params })
  }

  /** Sends a request to the phone; resolves with its answer. */
  ask(method: string, params: unknown): Promise<unknown> {
    const socket = this.openSocket
    if (!socket) return Promise.reject(new Error('no phone connected'))
    return socket.ask(method, params)
  }
}

export class FakeServerSocket implements SocketLike {
  readyState = 0
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  authed = false
  private nonce = `nonce-${Math.random().toString(36).slice(2)}`
  private deviceId: string | null = null
  private nextAsk = 1000
  private readonly asks = new Map<number | string, (value: unknown) => void>()

  constructor(
    private readonly server: FakeGateway,
    readonly url: string,
    live: boolean
  ) {
    queueMicrotask(() => {
      if (!live) {
        this.readyState = 3
        this.onclose?.({ code: 1006, reason: '' })
        return
      }
      this.readyState = 1
      this.onopen?.({})
      this.deliver({ type: 'challenge', hostId: server.hostId, nonce: this.nonce } satisfies GatewayFrame)
    })
  }

  deliver(message: unknown): void {
    if (this.readyState !== 1) return
    const data = JSON.stringify(message)
    queueMicrotask(() => this.onmessage?.({ data }))
  }

  ask(method: string, params: unknown): Promise<unknown> {
    const id = this.nextAsk++
    return new Promise((resolve) => {
      this.asks.set(id, resolve)
      this.deliver({ jsonrpc: '2.0', id, method, params })
    })
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket not open')
    const message = JSON.parse(data) as Record<string, unknown>
    if (!this.authed) {
      const frame = message as GatewayFrame
      if (frame.type !== 'auth') return this.close(GATEWAY_CLOSE.unauthorized)
      const device = this.server.devices.get(frame.deviceId)
      const payload = new TextEncoder().encode(deviceAuthPayload(this.server.hostId, frame.deviceId, this.nonce))
      if (!device || !ed25519.verify(fromBase64Url(frame.signature), payload, device.publicKey)) {
        return this.close(GATEWAY_CLOSE.unauthorized)
      }
      this.authed = true
      this.deviceId = frame.deviceId
      this.deliver({ type: 'ready', scopes: device.scopes } satisfies GatewayFrame)
      return
    }
    if (typeof message.method === 'string') {
      this.server.received.push({ method: message.method, params: message.params, ...(message.id !== undefined ? { id: message.id as number } : {}) })
      if (message.id === undefined) return
      const handler = this.server.handlers.get(message.method)
      if (!handler) {
        this.deliver({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
        return
      }
      Promise.resolve()
        .then(() => handler(message.params, this.server))
        .then(
          (result) => this.deliver({ jsonrpc: '2.0', id: message.id, result: result ?? null }),
          (error: Error) => this.deliver({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } })
        )
      return
    }
    const resolve = this.asks.get(message.id as number)
    if (resolve) {
      this.asks.delete(message.id as number)
      resolve(message.result ?? message.error)
    }
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return
    this.readyState = 3
    queueMicrotask(() => this.onclose?.({ code, reason }))
  }

  get device(): string | null {
    return this.deviceId
  }
}
