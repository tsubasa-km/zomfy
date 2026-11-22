// The phone's side of the host's remote gateway (remote-devices.ts): probe a route, pair with a
// grant, and open the device socket with a signed challenge. fetch and WebSocket are passed in, so
// tests drive it with fakes and the app with React Native's own.

import {
  GATEWAY_CLOSE,
  GATEWAY_PATHS,
  type DeviceScope,
  type GatewayFrame,
  type GatewayHello,
  type PairRequest,
  type PairResponse
} from '@zomfy/protocol'
import { signChallenge } from './pairing'

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** The part of the WebSocket API that browsers and React Native share. */
export interface SocketLike {
  readonly readyState: number
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type SocketFactory = (url: string) => SocketLike

export class GatewayError extends Error {
  constructor(
    message: string,
    /** HTTP status, or the socket's close code; null for network failures. */
    readonly code: number | null = null
  ) {
    super(message)
    this.name = 'GatewayError'
  }

  /** The host does not know this phone (unpaired or revoked): pairing again is the only way back. */
  get unpaired(): boolean {
    return this.code === GATEWAY_CLOSE.unauthorized || this.code === GATEWAY_CLOSE.revoked
  }
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '')

/** The device socket's URL for a route's http(s) base URL. */
export function deviceSocketUrl(routeUrl: string): string {
  return trimSlash(routeUrl).replace(/^http(s?):\/\//i, (_, s: string) => `ws${s}://`) + GATEWAY_PATHS.device
}

async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** GET /v1/hello: who answers on this route; throws when nothing does in time. */
export async function probeRoute(fetchImpl: FetchLike, routeUrl: string, timeoutMs = 3000): Promise<GatewayHello> {
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const response = await fetchImpl(trimSlash(routeUrl) + GATEWAY_PATHS.hello, { signal })
      if (!response.ok) throw new GatewayError(`The host answered ${response.status}`, response.status)
      const body = (await response.json()) as Partial<GatewayHello>
      if (typeof body?.hostId !== 'string') throw new GatewayError('Not a Zomfy host')
      return { hostId: body.hostId, hostName: typeof body.hostName === 'string' ? body.hostName : body.hostId }
    })
  } catch (error) {
    if (error instanceof GatewayError) throw error
    throw new GatewayError(`Could not reach ${routeUrl}`)
  }
}

/** POST /v1/pair: presents the grant and the phone's public keys. */
export async function pairWithHost(
  fetchImpl: FetchLike,
  routeUrl: string,
  request: PairRequest,
  timeoutMs = 10_000
): Promise<PairResponse> {
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await withTimeout(timeoutMs, (signal) =>
      fetchImpl(trimSlash(routeUrl) + GATEWAY_PATHS.pair, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal
      })
    )
  } catch {
    throw new GatewayError(`Could not reach ${routeUrl}`)
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `Pairing failed (${response.status})`
    throw new GatewayError(message, response.status)
  }
  const result = body as Partial<PairResponse> | null
  if (typeof result?.deviceId !== 'string' || typeof result.hostId !== 'string') {
    throw new GatewayError('The host sent an unexpected pairing answer')
  }
  return {
    deviceId: result.deviceId,
    hostId: result.hostId,
    hostName: typeof result.hostName === 'string' ? result.hostName : result.hostId,
    scopes: Array.isArray(result.scopes) ? result.scopes : []
  }
}

export interface DeviceCredentials {
  hostId: string
  deviceId: string
  /** Ed25519 secret key, base64url. */
  secretKey: string
}

/** An authenticated device socket: from here on each text frame is one JSON-RPC message. */
export interface GatewaySocket {
  scopes: DeviceScope[]
  send(text: string): void
  close(): void
  /** Replaces the handlers; set them right after connect resolves. */
  onMessage: (text: string) => void
  onClose: (error: GatewayError) => void
}

const describeClose = (code: number, reason: string): string => {
  if (code === GATEWAY_CLOSE.unauthorized) return 'This phone was unpaired; pair again'
  if (code === GATEWAY_CLOSE.revoked) return 'This phone was unpaired on the host; pair again'
  return reason || `Connection closed (${code})`
}

/** Opens `/v1/device`, answers the challenge, and resolves once the host says ready. */
export function connectDevice(
  createSocket: SocketFactory,
  routeUrl: string,
  credentials: DeviceCredentials,
  timeoutMs = 10_000
): Promise<GatewaySocket> {
  return new Promise((resolve, reject) => {
    let socket: SocketLike
    try {
      socket = createSocket(deviceSocketUrl(routeUrl))
    } catch (error) {
      reject(new GatewayError(error instanceof Error ? error.message : String(error)))
      return
    }
    let phase: 'challenge' | 'ready' | 'open' | 'done' = 'challenge'
    const fail = (error: GatewayError): void => {
      if (phase === 'done' || phase === 'open') return
      phase = 'done'
      clearTimeout(timer)
      try {
        socket.close()
      } catch {}
      reject(error)
    }
    const timer = setTimeout(() => fail(new GatewayError('The host did not answer in time')), timeoutMs)

    const gateway: GatewaySocket = {
      scopes: [],
      send: (text) => socket.send(text),
      close: () => {
        try {
          socket.close(1000)
        } catch {}
      },
      onMessage: () => {},
      onClose: () => {}
    }

    socket.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : null
      if (text === null) return
      if (phase === 'open') {
        gateway.onMessage(text)
        return
      }
      let frame: GatewayFrame
      try {
        frame = JSON.parse(text) as GatewayFrame
      } catch {
        fail(new GatewayError('The host sent an unexpected frame'))
        return
      }
      if (phase === 'challenge' && frame.type === 'challenge') {
        if (frame.hostId !== credentials.hostId) {
          fail(new GatewayError('A different host answered on this route'))
          return
        }
        const signature = signChallenge(credentials.secretKey, credentials.hostId, credentials.deviceId, frame.nonce)
        phase = 'ready'
        socket.send(JSON.stringify({ type: 'auth', deviceId: credentials.deviceId, signature } satisfies GatewayFrame))
        return
      }
      if (phase === 'ready' && frame.type === 'ready') {
        phase = 'open'
        clearTimeout(timer)
        gateway.scopes = Array.isArray(frame.scopes) ? frame.scopes : []
        resolve(gateway)
        return
      }
      fail(new GatewayError('The host sent an unexpected frame'))
    }
    socket.onclose = (event) => {
      const error = new GatewayError(describeClose(event.code, event.reason), event.code)
      if (phase === 'open') {
        phase = 'done'
        gateway.onClose(error)
      } else fail(error)
    }
    socket.onerror = () => {
      // React Native reports the reason on close, which always follows.
    }
  })
}
