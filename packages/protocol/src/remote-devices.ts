// Phones paired with a host (docs/specs/mobile/pairing.md). A phone is an ACP client like a window,
// but it reaches the daemon over the remote gateway (a LAN/tailnet listener, later the relay), proves
// a device key instead of the per-start window token, and may call only the methods its scopes allow.
// The pairing offer follows Orca's mobile pairing offer; scopes and one-time links follow T3 Code.

import { PERMISSION_ASK_NOTIFICATIONS } from './permission-asks'

export const DEVICE_SCOPES = [
  'chats:read',
  'chats:operate',
  'terminals:operate',
  'workspaces:operate',
  'bots:read'
] as const
export type DeviceScope = (typeof DEVICE_SCOPES)[number]

export const isDeviceScope = (value: unknown): value is DeviceScope =>
  typeof value === 'string' && (DEVICE_SCOPES as readonly string[]).includes(value)

/** A paired phone, as Settings → Devices shows it. Keys stay in the daemon's own record. */
export interface RemoteDevice {
  id: string
  name: string
  /** The phone's model, as it reported it; null when it did not. */
  model: string | null
  scopes: DeviceScope[]
  createdAt: number
  /** The last time it connected or sent anything; null until its first connect. */
  lastSeenAt: number | null
  /** It has an open connection now. */
  connected: boolean
  /** The route its open connection came in on (the relay, or a direct LAN or tailnet address); null while offline. */
  route?: RemoteRoute['kind'] | null
}

/** One way to reach the host's gateway, tried in the offer's order. */
export interface RemoteRoute {
  kind: 'lan' | 'tailnet' | 'relay'
  /** http(s) base URL of the gateway, e.g. `http://192.168.1.20:7802`; for the relay, the Worker's URL. */
  url: string
  /** The relay route only: the relay's id for this host (`h_…`), for `/v1/device/<id>/ws`. */
  relayHostId?: string
}

/** What a pairing QR code or `zomfy://pair#<offer>` link carries. */
export interface PairingOffer {
  v: 1
  hostId: string
  hostName: string
  /** Direct routes (LAN, tailnet) while the listener is on; empty otherwise. */
  routes: RemoteRoute[]
  /** The relay to fall back to, once the host is linked to one (phase M2). */
  relayUrl?: string
  /** The host's pinned X25519 public key (base64url), for the end-to-end encrypted relay route. */
  hostBoxPublicKey: string
  /** One-time pairing grant (base64url, 256 bits); burnt by the first pairing that presents it. */
  grant: string
  /** Epoch ms after which the grant is refused (10 minutes after it was made). */
  expiresAt: number
  scopes: DeviceScope[]
}

export const PAIRING_LINK_PREFIX = 'zomfy://pair#'
export const PAIRING_GRANT_TTL_MS = 10 * 60_000

/** Whether the opt-in LAN/tailnet listener runs, and where a phone can reach it. */
export interface RemoteListenerStatus {
  enabled: boolean
  port: number
  /** Listening now; false while off or when the port could not be opened. */
  running: boolean
  error: string | null
  /** The private and tailnet addresses it can be reached on. */
  routes: RemoteRoute[]
}

export interface RemoteDevicesSnapshot {
  hostId: string
  hostName: string
  devices: RemoteDevice[]
  listener: RemoteListenerStatus
  /** The relay route pairing offers list, while this host is linked to Zomfy Relay (M2); null otherwise. */
  relay?: (RemoteRoute & { online: boolean }) | null
}

export const DEFAULT_REMOTE_PORT = 7802

// ── Gateway wire (phone ↔ daemon over a direct route) ───────────────────────

export const GATEWAY_PATHS = {
  /** GET: who this host is ({hostId, hostName}), to probe a route. */
  hello: '/v1/hello',
  /** POST PairRequest → PairResponse. */
  pair: '/v1/pair',
  /** WebSocket: challenge → auth → ready, then ACP JSON-RPC text frames. */
  device: '/v1/device'
} as const

export interface GatewayHello {
  hostId: string
  hostName: string
}

export interface PairRequest {
  grant: string
  name: string
  model?: string | null
  /** The phone's Ed25519 public key (base64url, 32 bytes): it signs each connect's challenge. */
  publicKey: string
  /** The phone's X25519 public key (base64url, 32 bytes), for the relay's end-to-end encryption. */
  boxPublicKey: string
}

export interface PairResponse {
  deviceId: string
  hostId: string
  hostName: string
  scopes: DeviceScope[]
}

/** The first frames on `/v1/device`, before ACP starts. */
export type GatewayFrame =
  | { type: 'challenge'; hostId: string; nonce: string }
  | { type: 'auth'; deviceId: string; signature: string }
  | { type: 'ready'; scopes: DeviceScope[] }

/** What the device signs (UTF-8) to answer a challenge. */
export const deviceAuthPayload = (hostId: string, deviceId: string, nonce: string): string =>
  `zomfy-device-v1|${hostId}|${deviceId}|${nonce}`

export const GATEWAY_CLOSE = {
  /** Bad signature, unknown device, or no auth in time. */
  unauthorized: 4401,
  /** The device was revoked while connected. */
  revoked: 4403
} as const

/** JSON-RPC error code for a method the device's scopes do not allow (or one not listed). */
export const SCOPE_REFUSED_CODE = -32001

// ── Method allowlist ────────────────────────────────────────────────────────

/** 'paired' means any paired device, whatever its scopes. */
export type MethodScope = DeviceScope | 'paired'

/**
 * The scope each method a phone may call needs. A method not listed here is refused for phones,
 * so a new daemon method stays desktop-only until it is added on purpose.
 */
export const REMOTE_METHOD_SCOPES: Readonly<Record<string, MethodScope>> = {
  initialize: 'paired',
  authenticate: 'paired',
  'session/load': 'chats:read',
  '_harness/state/get': 'chats:read',
  '_harness/sessions/list': 'chats:read',
  '_harness/sessions/catalog': 'chats:read',
  '_harness/chatAgents/list': 'chats:read',
  'session/prompt': 'chats:operate',
  'session/cancel': 'chats:operate',
  '_harness/sessions/create': 'chats:operate',
  '_harness/sessions/setOptions': 'chats:operate',
  '_harness/sessions/rename': 'chats:operate',
  '_harness/sessions/setArchived': 'chats:operate',
  '_harness/terminals/list': 'terminals:operate',
  '_harness/terminals/create': 'terminals:operate',
  '_harness/terminals/attach': 'terminals:operate',
  '_harness/terminals/input': 'terminals:operate',
  '_harness/terminals/resize': 'terminals:operate',
  '_harness/terminals/close': 'terminals:operate',
  '_harness/workspaces/create': 'workspaces:operate',
  '_harness/workspaces/summaries': 'workspaces:operate',
  '_harness/git/branches': 'workspaces:operate',
  '_harness/bots/list': 'bots:read',
  '_harness/bots/connectorStatus': 'bots:read',
  // Starting a bot chat is creating a chat and sending its first prompt (docs/specs/mobile/bots.md).
  '_harness/bots/chatCreate': 'chats:operate'
}

/** The scope a notification from the daemon needs to reach a phone; unlisted ones are not sent. */
export const REMOTE_NOTIFICATION_SCOPES: Readonly<Record<string, MethodScope>> = {
  'session/update': 'chats:read',
  '_harness/state/changed': 'chats:read',
  '_harness/sessions/changed': 'chats:read',
  '_harness/terminals/changed': 'terminals:operate',
  '_harness/terminals/output': 'terminals:operate',
  [PERMISSION_ASK_NOTIFICATIONS.resolved]: 'chats:read',
  '_harness/chatAgents/changed': 'chats:read',
  '_harness/bots/changed': 'bots:read'
}

/** The scope a request from the daemon to a phone needs; others are answered with an error. */
export const REMOTE_CLIENT_REQUEST_SCOPES: Readonly<Record<string, MethodScope>> = {
  'session/request_permission': 'chats:operate'
}

/** Whether a device with `scopes` may take part in `method` according to `table`. */
export function scopeAllows(
  table: Readonly<Record<string, MethodScope>>,
  method: string,
  scopes: readonly DeviceScope[]
): boolean {
  const needed = Object.hasOwn(table, method) ? table[method] : undefined
  if (needed === undefined) return false
  return needed === 'paired' || scopes.includes(needed)
}

// ── Desktop methods (Settings → Devices) ────────────────────────────────────

export const REMOTE_DEVICE_METHODS = {
  devicesList: '_harness/devices/list',
  /** A new one-time pairing offer; the listener should be on for the phone to reach it. */
  devicesOffer: '_harness/devices/offer',
  devicesRevoke: '_harness/devices/revoke',
  devicesSetListener: '_harness/devices/setListener'
} as const

export const REMOTE_DEVICE_NOTIFICATIONS = {
  devicesChanged: '_harness/devices/changed'
} as const

export interface RemoteDeviceRequests {
  [REMOTE_DEVICE_METHODS.devicesList]: { params: Record<string, never>; result: RemoteDevicesSnapshot }
  [REMOTE_DEVICE_METHODS.devicesOffer]: {
    params: { scopes?: DeviceScope[] }
    result: { offer: PairingOffer; link: string }
  }
  [REMOTE_DEVICE_METHODS.devicesRevoke]: { params: { deviceId: string }; result: RemoteDevicesSnapshot }
  [REMOTE_DEVICE_METHODS.devicesSetListener]: {
    params: { enabled: boolean; port?: number }
    result: RemoteDevicesSnapshot
  }
}

// ── Pairing links ───────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** base64url without padding; no Buffer or btoa, so it runs the same in Bun, browsers and Hermes. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]!
    if (i + 2 < bytes.length) out += B64[n & 63]!
  }
  return out
}

export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]!) : 0))
    if (c.some((v) => v < 0)) throw new Error('Not base64url')
    const n = (c[0]! << 18) | (c[1]! << 12) | (c[2]! << 6) | c[3]!
    out[o++] = (n >> 16) & 255
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255
    if (i + 3 < clean.length) out[o++] = n & 255
  }
  return out.slice(0, o)
}

export function encodePairingOffer(offer: PairingOffer): string {
  return PAIRING_LINK_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(offer)))
}

/** Reads a pairing link (or the bare offer after `#`); throws on anything else. */
export function decodePairingOffer(link: string): PairingOffer {
  const trimmed = link.trim()
  const hash = trimmed.indexOf('#')
  const encoded = trimmed.startsWith('zomfy:') ? trimmed.slice(hash + 1) : trimmed
  if (!encoded) throw new Error('Not a Zomfy pairing link')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)))
  } catch {
    throw new Error('Not a Zomfy pairing link')
  }
  const offer = raw as Partial<PairingOffer>
  if (
    offer?.v !== 1 ||
    typeof offer.hostId !== 'string' ||
    typeof offer.hostName !== 'string' ||
    typeof offer.grant !== 'string' ||
    typeof offer.expiresAt !== 'number' ||
    typeof offer.hostBoxPublicKey !== 'string' ||
    !Array.isArray(offer.routes) ||
    !Array.isArray(offer.scopes)
  ) {
    throw new Error('Not a Zomfy pairing link')
  }
  return {
    v: 1,
    hostId: offer.hostId,
    hostName: offer.hostName,
    routes: offer.routes.filter(
      (r): r is RemoteRoute =>
        !!r && (r.kind === 'lan' || r.kind === 'tailnet' || r.kind === 'relay') && typeof r.url === 'string'
    ),
    ...(typeof offer.relayUrl === 'string' ? { relayUrl: offer.relayUrl } : {}),
    hostBoxPublicKey: offer.hostBoxPublicKey,
    grant: offer.grant,
    expiresAt: offer.expiresAt,
    scopes: offer.scopes.filter(isDeviceScope)
  }
}
