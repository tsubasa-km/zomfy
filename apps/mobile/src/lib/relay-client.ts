// The phone's side of the relay route (docs/specs/mobile/relay.md): one socket to Zomfy Relay per
// host, `GET /v1/device/<relayHostId>/ws`. The phone proves its device key to the Hub, then runs the
// end-to-end handshake with the host through it (packages/protocol/src/phone-e2ee.ts), proves its
// device key again inside the channel, and from then on every frame is one sealed JSON-RPC message.
// When the host goes offline the socket stays; the channel ends, and a new one starts when the Hub
// says host-online.

import { ed25519 } from '@noble/curves/ed25519.js'
import {
  createPhoneHandshake,
  decodeBase64,
  encodeBase64,
  fromBase64Url,
  GATEWAY_CLOSE,
  phoneDeviceProofMessage,
  toBase64Url,
  type DeviceScope,
  type PairRequest,
  type PairResponse,
  type PhoneChannelAnswer,
  type PhoneE2EEChannel
} from '@zomfy/protocol'
import { GatewayError, type FetchLike, type GatewaySocket, type SocketFactory, type SocketLike } from './gateway-client'
import type { RandomBytes } from './pairing'

/** Same as the relay contract's `deviceSigningText` (packages/relay-contract/src/phone). */
export const deviceSigningText = (deviceId: string, nonce: string): string => `zomfy-relay-v1|${deviceId}|${nonce}`
/** The relay's name for a device the host keeps as `id` (relay contract's `relayDeviceId`). */
export const relayDeviceId = (id: string): string => `d_${id}`

/** Close codes of the relay contract the phone acts on. */
export const RELAY_CLOSE = { channelBroken: 4400, unauthorized: 4401, revoked: 4403, replaced: 4409 } as const

export interface RelayIdentity {
  relayUrl: string
  relayHostId: string
  /** The host's X25519 key pinned at pairing. */
  hostBoxPublicKey: string
  /** The relay's id for this phone, `d_…`. */
  relayDeviceId: string
  /** Ed25519 secret key (seed), base64url. */
  secretKey: string
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '')

export function relaySocketUrl(relayUrl: string, relayHostId: string): string {
  return `${trimSlash(relayUrl).replace(/^http(s?):\/\//i, (_, s: string) => `ws${s}://`)}/v1/device/${encodeURIComponent(relayHostId)}/ws`
}

/** GET /health: whether the relay answers at all (the host may still be offline behind it). */
export async function probeRelay(fetchImpl: FetchLike, relayUrl: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${trimSlash(relayUrl)}/health`, { signal: controller.signal })
    if (!response.ok) return false
    const body = (await response.json()) as { ok?: unknown }
    return body?.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

const sign = (secretKey: string, message: Uint8Array): Uint8Array => ed25519.sign(message, fromBase64Url(secretKey))

const describeClose = (code: number, reason: string): string => {
  if (code === RELAY_CLOSE.unauthorized) return 'The relay does not know this phone; pair again'
  if (code === RELAY_CLOSE.revoked) return 'This phone was unpaired on the host; pair again'
  if (code === RELAY_CLOSE.channelBroken) return 'The encrypted channel broke; reconnecting'
  if (code === RELAY_CLOSE.replaced) return 'Another connection of this phone replaced this one'
  return reason || `Connection closed (${code})`
}

type Waiter = { resolve: (socket: GatewaySocket) => void; reject: (error: GatewayError) => void; timer: ReturnType<typeof setTimeout> }

export interface RelaySessionOptions {
  createSocket: SocketFactory
  identity: RelayIdentity
  /** The host's own id for this phone (what the channel's auth names). */
  deviceId: string
  random: RandomBytes
  /** The host came back while no channel was asked for: a good moment to connect. */
  onHostOnline?: () => void
  /** The host went away or came back, for the status line. */
  onPresence?: (online: boolean) => void
}

/**
 * The relay route of one host. `open()` resolves with an authenticated channel shaped like a direct
 * device socket; the underlying WebSocket outlives channels, so host-offline/host-online need no
 * new connect.
 */
export class RelaySession {
  private ws: SocketLike | null = null
  private authed = false
  private hostOnline = false
  private channel: PhoneE2EEChannel | null = null
  private phase: 'idle' | 'hello' | 'proof' | 'open' = 'idle'
  private handshake: ReturnType<typeof createPhoneHandshake> | null = null
  private current: GatewaySocket | null = null
  private waiter: Waiter | null = null

  constructor(private readonly options: RelaySessionOptions) {}

  /** Whether the Hub says the host is online right now. */
  get online(): boolean {
    return this.authed && this.hostOnline
  }

  /** A channel to the host; waits up to `timeoutMs` for the host if it is offline. */
  open(timeoutMs = 15_000): Promise<GatewaySocket> {
    if (this.current) return Promise.resolve(this.current)
    return new Promise((resolve, reject) => {
      this.waiter?.reject(new GatewayError('Superseded'))
      const timer = setTimeout(() => {
        if (this.waiter?.timer !== timer) return
        this.waiter = null
        this.phase = 'idle'
        reject(new GatewayError(this.authed && !this.hostOnline ? 'The host is offline' : 'The relay did not answer in time'))
      }, timeoutMs)
      this.waiter = { resolve, reject, timer }
      if (!this.ws) this.dial()
      else if (this.online && this.phase === 'idle') this.startHandshake()
    })
  }

  /** Closes the socket and any channel on it. */
  close(): void {
    const ws = this.ws
    this.ws = null
    try {
      ws?.close(1000)
    } catch {}
    this.reset(new GatewayError('Closed'))
  }

  private dial(): void {
    this.authed = false
    this.hostOnline = false
    let ws: SocketLike
    try {
      ws = this.options.createSocket(relaySocketUrl(this.options.identity.relayUrl, this.options.identity.relayHostId))
    } catch (error) {
      this.fail(new GatewayError(error instanceof Error ? error.message : String(error)))
      return
    }
    this.ws = ws
    ws.onmessage = (event) => {
      if (ws !== this.ws || typeof event.data !== 'string') return
      this.onSocketFrame(event.data)
    }
    ws.onclose = (event) => {
      if (ws !== this.ws) return
      this.ws = null
      this.authed = false
      this.hostOnline = false
      // The Hub's 4401 is only this route failing (a relay paired again, a Hub that lost its rows):
      // the host itself, on any route, decides whether this phone is still paired. A revoke is final.
      this.reset(new GatewayError(describeClose(event.code, event.reason), event.code === RELAY_CLOSE.unauthorized ? null : event.code))
    }
    ws.onerror = () => {
      // The close that follows says why.
    }
  }

  /** Drops the channel (not the socket) and tells whoever waits on it. */
  private reset(error: GatewayError): void {
    this.channel = null
    this.handshake = null
    this.phase = 'idle'
    const current = this.current
    this.current = null
    if (current) current.onClose(error)
    this.fail(error)
  }

  private fail(error: GatewayError): void {
    const waiter = this.waiter
    this.waiter = null
    if (!waiter) return
    clearTimeout(waiter.timer)
    waiter.reject(error)
  }

  private send(frame: object): void {
    try {
      this.ws?.send(JSON.stringify(frame))
    } catch {}
  }

  private onSocketFrame(text: string): void {
    let frame: { type?: string; nonce?: string; data?: string }
    try {
      frame = JSON.parse(text)
    } catch {
      return
    }
    const { identity } = this.options
    switch (frame.type) {
      case 'challenge': {
        const signature = encodeBase64(sign(identity.secretKey, new TextEncoder().encode(deviceSigningText(identity.relayDeviceId, frame.nonce ?? ''))))
        this.send({ type: 'auth', deviceId: identity.relayDeviceId, signature })
        return
      }
      case 'auth-ok':
        this.authed = true
        return
      case 'host-online':
        this.hostOnline = true
        this.options.onPresence?.(true)
      {
        // A channel from before is gone at the host: start over, keeping whoever waits to open.
        const waiter = this.waiter
        this.waiter = null
        if (this.phase !== 'idle' || this.current) this.reset(new GatewayError('The host reconnected'))
        this.waiter = waiter
        if (waiter) this.startHandshake()
        else this.options.onHostOnline?.()
        return
      }
      case 'host-offline':
        this.hostOnline = false
        this.options.onPresence?.(false)
        if (this.current || this.phase !== 'idle') {
          const waiter = this.waiter
          this.waiter = null
          this.reset(new GatewayError('The host is offline'))
          // Whoever was opening keeps waiting for host-online, within its own timeout.
          if (waiter) this.waiter = waiter
        }
        return
      case 'frame':
        if (typeof frame.data === 'string') this.onChannelFrame(frame.data)
        return
    }
  }

  private startHandshake(): void {
    const { identity } = this.options
    this.handshake = createPhoneHandshake({
      hostPublicKey: identity.hostBoxPublicKey,
      transport: 'relay',
      relayHostId: identity.relayHostId,
      random: this.options.random
    })
    this.phase = 'hello'
    this.send({ type: 'frame', data: encodeBase64(new TextEncoder().encode(JSON.stringify(this.handshake.hello))) })
  }

  /** The channel broke on this side: the socket goes too, so the Hub and the host start clean. */
  private broken(reason: string): void {
    const ws = this.ws
    this.ws = null
    try {
      ws?.close(1000, reason)
    } catch {}
    this.authed = false
    this.hostOnline = false
    this.reset(new GatewayError(reason))
  }

  private onChannelFrame(data: string): void {
    if (this.phase === 'hello') {
      let ready: unknown
      try {
        ready = JSON.parse(new TextDecoder().decode(decodeBase64(data)))
      } catch {
        return this.broken('The host sent an unexpected frame')
      }
      const channel = this.handshake!.accept(ready)
      // Not the key pinned at pairing: someone else answers for this host.
      if (!channel) return this.broken('The host did not prove the key it paired with')
      this.channel = channel
      this.phase = 'proof'
      const proof = toBase64Url(sign(this.options.identity.secretKey, phoneDeviceProofMessage('auth', channel.transcriptHash)))
      this.send({ type: 'frame', data: channel.seal(JSON.stringify({ type: 'auth', deviceId: this.options.deviceId, proof })) })
      return
    }
    if (!this.channel) return
    const text = this.channel.open(data)
    if (text === null) return this.broken('The encrypted channel broke; reconnecting')
    if (this.phase === 'proof') {
      let answer: PhoneChannelAnswer
      try {
        answer = JSON.parse(text) as PhoneChannelAnswer
      } catch {
        return this.broken('The host sent an unexpected answer')
      }
      if (answer.type !== 'ready') {
        const code = answer.type === 'refused' ? answer.code : null
        const error = new GatewayError(answer.type === 'refused' ? answer.message : 'Unexpected answer', unpairedCode(code ?? 0))
        const waiter = this.waiter
        this.waiter = null
        this.phase = 'idle'
        if (waiter) {
          clearTimeout(waiter.timer)
          waiter.reject(error)
        }
        return
      }
      this.phase = 'open'
      const channel = this.channel
      const socket: GatewaySocket = {
        scopes: Array.isArray(answer.scopes) ? (answer.scopes as DeviceScope[]) : [],
        send: (message) => {
          if (this.current === socket && channel === this.channel) this.send({ type: 'frame', data: channel.seal(message) })
        },
        close: () => {
          if (this.current === socket) this.close()
        },
        onMessage: () => {},
        onClose: () => {}
      }
      this.current = socket
      const waiter = this.waiter
      this.waiter = null
      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.resolve(socket)
      }
      return
    }
    this.current?.onMessage(text)
  }
}

/** GatewayError codes that mean "pair again": the relay's 4401/4403 are the gateway's own. */
function unpairedCode(code: number): number | null {
  if (code === RELAY_CLOSE.unauthorized) return GATEWAY_CLOSE.unauthorized
  if (code === RELAY_CLOSE.revoked) return GATEWAY_CLOSE.revoked
  return code || null
}

/** Pairs through the relay: the grant goes inside the end-to-end channel, never to the relay. */
export async function pairThroughRelay(options: {
  createSocket: SocketFactory
  relayUrl: string
  relayHostId: string
  hostBoxPublicKey: string
  request: PairRequest
  secretKey: string
  random: RandomBytes
  timeoutMs?: number
}): Promise<PairResponse> {
  const relayId = relayDeviceId(toBase64Url(options.random(16)))
  const publicKey = encodeBase64(fromBase64Url(options.request.publicKey))
  const ws = options.createSocket(relaySocketUrl(options.relayUrl, options.relayHostId))
  return new Promise<PairResponse>((resolve, reject) => {
    let done = false
    let handshake: ReturnType<typeof createPhoneHandshake> | null = null
    let channel: PhoneE2EEChannel | null = null
    const finish = (error: GatewayError | null, response?: PairResponse) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        ws.close(1000)
      } catch {}
      if (error) reject(error)
      else resolve(response!)
    }
    const timer = setTimeout(() => finish(new GatewayError('The host did not answer through the relay in time')), options.timeoutMs ?? 20_000)
    const send = (frame: object) => ws.send(JSON.stringify(frame))
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      let frame: { type?: string; nonce?: string; data?: string }
      try {
        frame = JSON.parse(event.data)
      } catch {
        return
      }
      if (frame.type === 'challenge') {
        const signature = encodeBase64(sign(options.secretKey, new TextEncoder().encode(deviceSigningText(relayId, frame.nonce ?? ''))))
        send({ type: 'pair', deviceId: relayId, publicKey, signature })
      } else if (frame.type === 'host-online' && !handshake) {
        handshake = createPhoneHandshake({ hostPublicKey: options.hostBoxPublicKey, transport: 'relay', relayHostId: options.relayHostId, random: options.random })
        send({ type: 'frame', data: encodeBase64(new TextEncoder().encode(JSON.stringify(handshake.hello))) })
      } else if (frame.type === 'frame' && handshake && typeof frame.data === 'string') {
        if (!channel) {
          try {
            channel = handshake.accept(JSON.parse(new TextDecoder().decode(decodeBase64(frame.data))))
          } catch {
            channel = null
          }
          if (!channel) return finish(new GatewayError('The host did not prove the key in the pairing code'))
          const proof = toBase64Url(sign(options.secretKey, phoneDeviceProofMessage('pair', channel.transcriptHash)))
          send({ type: 'frame', data: channel.seal(JSON.stringify({ type: 'pair', request: options.request, proof })) })
          return
        }
        const text = channel.open(frame.data)
        if (text === null) return finish(new GatewayError('The encrypted channel broke'))
        const answer = JSON.parse(text) as PhoneChannelAnswer
        if (answer.type === 'paired') finish(null, answer.response)
        else finish(new GatewayError(answer.type === 'refused' ? answer.message : 'Pairing failed'))
      }
    }
    ws.onclose = (event) => finish(new GatewayError(event.code === RELAY_CLOSE.unauthorized ? 'The relay refused this pairing' : describeClose(event.code, event.reason)))
    ws.onerror = () => {}
  })
}
