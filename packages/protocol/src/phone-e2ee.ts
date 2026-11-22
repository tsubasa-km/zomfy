// The end-to-end encrypted channel between a phone and its host over Zomfy Relay
// (docs/specs/mobile/relay.md#end-to-end-encryption). Copied from Orca's paired E2EE v2 (MIT,
// THIRD_PARTY_NOTICES.md): the hello/ready handshake and its length-prefixed transcript
// (`mobile-e2ee-v2-contract.ts`), the HKDF-SHA256 key schedule into two directional keys and a
// session id (`paired-e2ee-v2-key-schedule.ts`), the counter nonce layout and the device proof over
// the transcript hash (`mobile-e2ee-v2-framing.ts`, `device-key-proof.ts`). Zomfy's changes:
//
// - Both sides send an ephemeral X25519 key, and the input key material is
//   X25519(phone ephemeral, host ephemeral) ‖ X25519(phone ephemeral, host's pinned key): forward
//   secret, and only the holder of the key pinned at pairing can derive it.
// - Frames are XChaCha20-Poly1305 (libsodium's `crypto_aead_xchacha20poly1305_ietf`, here from
//   @noble/ciphers, which runs on Hermes) with the frame header as associated data.
// - A frame must carry exactly the next counter; anything else (a replay, a reorder, a forgery)
//   breaks the channel for good, and the caller closes it.
//
// Pure functions over bytes, with randomness passed in, so the daemon (Bun) and the app (Hermes)
// run the same code.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { DeviceScope, PairRequest, PairResponse } from './remote-devices'

export const PHONE_E2EE_PROTOCOL = 'zomfy-phone-e2ee'
export const PHONE_E2EE_VERSION = 1
const TRANSCRIPT_DOMAIN = 'zomfy-phone-e2ee/v1/transcript'
const SALT_LABEL = utf8('zomfy-phone-e2ee/v1/salt\0')
const INFO_LABEL = utf8('zomfy-phone-e2ee/v1/session\0')
const PROOF_DOMAIN = 'zomfy-device-proof/v1'

export type RandomBytes = (length: number) => Uint8Array
export type PhoneE2EETransport = 'relay' | 'direct'

export interface PhoneE2EEContext {
  protocol: typeof PHONE_E2EE_PROTOCOL
  initiator: 'phone'
  responder: 'host'
  transport: PhoneE2EETransport
  /** The relay's id for the host (`h_…`); empty on a direct route. */
  relayHostId: string
}

/** Phone → host, the channel's first frame (plaintext JSON). Keys and nonces are standard base64. */
export interface PhoneE2EEHello {
  type: 'e2ee_hello'
  v: typeof PHONE_E2EE_VERSION
  clientPublicKey: string
  clientNonce: string
  context: PhoneE2EEContext
}

/** Host → phone, the answer (plaintext JSON). `hostPublicKey` must be the key pinned at pairing. */
export interface PhoneE2EEReady {
  type: 'e2ee_ready'
  v: typeof PHONE_E2EE_VERSION
  hostPublicKey: string
  hostEphemeralKey: string
  clientNonce: string
  hostNonce: string
  context: PhoneE2EEContext
}

/** The first message inside the channel: who the phone is, proven over this channel's transcript. */
export type PhoneChannelOpen =
  | { type: 'auth'; deviceId: string; proof: string }
  | { type: 'pair'; request: PairRequest; proof: string }

/** The host's answer inside the channel; after `ready` every frame is one ACP JSON-RPC message. */
export type PhoneChannelAnswer =
  | { type: 'ready'; scopes: DeviceScope[] }
  | { type: 'paired'; response: PairResponse }
  | { type: 'refused'; code: number; message: string }

export type PhoneE2EEDirection = 'phone-to-host' | 'host-to-phone'

export interface PhoneE2EEKeys {
  phoneToHostKey: Uint8Array
  hostToPhoneKey: Uint8Array
  sessionId: Uint8Array
  transcriptHash: Uint8Array
}

// ── Key schedule (Orca's v2, Zomfy's labels) ──────────────────────────────────

export function derivePhoneE2EEKeys(args: {
  inputKeyMaterial: Uint8Array
  transcript: Uint8Array
  clientNonce: Uint8Array
  hostNonce: Uint8Array
}): PhoneE2EEKeys {
  requireLength(args.inputKeyMaterial, 64, 'input key material')
  requireLength(args.clientNonce, 32, 'client nonce')
  requireLength(args.hostNonce, 32, 'host nonce')
  const transcriptHash = sha256(args.transcript)
  const salt = sha256(concatBytes([SALT_LABEL, args.clientNonce, args.hostNonce]))
  const info = concatBytes([INFO_LABEL, transcriptHash])
  const expanded = hkdf(sha256, args.inputKeyMaterial, salt, info, 96)
  return {
    phoneToHostKey: expanded.slice(0, 32),
    hostToPhoneKey: expanded.slice(32, 64),
    sessionId: expanded.slice(64, 96),
    transcriptHash
  }
}

/** Orca's transcript: every field as `len(name) name len(value) value`, big-endian u32 lengths. */
export function encodePhoneE2EETranscript(hello: PhoneE2EEHello, ready: PhoneE2EEReady): Uint8Array {
  const fields: [string, Uint8Array][] = [
    ['domain', utf8(TRANSCRIPT_DOMAIN)],
    ['phone-to-host.type', utf8(hello.type)],
    ['phone-to-host.version', uint32(hello.v)],
    ['phone-to-host.client-public-key', decodeBase64(hello.clientPublicKey)],
    ['phone-to-host.client-nonce', decodeBase64(hello.clientNonce)],
    ['phone-to-host.context.protocol', utf8(hello.context.protocol)],
    ['phone-to-host.context.initiator', utf8(hello.context.initiator)],
    ['phone-to-host.context.responder', utf8(hello.context.responder)],
    ['phone-to-host.context.transport', utf8(hello.context.transport)],
    ['phone-to-host.context.relay-host-id', utf8(hello.context.relayHostId)],
    ['host-to-phone.type', utf8(ready.type)],
    ['host-to-phone.version', uint32(ready.v)],
    ['host-to-phone.host-public-key', decodeBase64(ready.hostPublicKey)],
    ['host-to-phone.host-ephemeral-key', decodeBase64(ready.hostEphemeralKey)],
    ['host-to-phone.client-nonce-echo', decodeBase64(ready.clientNonce)],
    ['host-to-phone.host-nonce', decodeBase64(ready.hostNonce)],
    ['host-to-phone.context.protocol', utf8(ready.context.protocol)],
    ['host-to-phone.context.initiator', utf8(ready.context.initiator)],
    ['host-to-phone.context.responder', utf8(ready.context.responder)],
    ['host-to-phone.context.transport', utf8(ready.context.transport)],
    ['host-to-phone.context.relay-host-id', utf8(ready.context.relayHostId)]
  ]
  return concatBytes(fields.map(([name, value]) => concatBytes([uint32(utf8(name).length), utf8(name), uint32(value.length), value])))
}

/** What a phone signs with its Ed25519 device key: `zomfy-device-proof/v1 \0 purpose \0 transcriptHash`. */
export function phoneDeviceProofMessage(purpose: 'auth' | 'pair', transcriptHash: Uint8Array): Uint8Array {
  requireLength(transcriptHash, 32, 'transcript hash')
  return concatBytes([utf8(`${PROOF_DOMAIN}\0${purpose}\0`), transcriptHash])
}

// ── Frames ─────────────────────────────────────────────────────────────────────

const NONCE_LENGTH = 24
const TAG_LENGTH = 16
const SESSION_ID_LENGTH = 32
const HEADER_LENGTH = SESSION_ID_LENGTH + 1 + 1 + 8
const FRAME_VERSION = 1
const MAX_COUNTER = (1n << 64n) - 1n

function frameHeader(sessionId: Uint8Array, direction: PhoneE2EEDirection, counter: bigint): Uint8Array {
  const header = new Uint8Array(HEADER_LENGTH)
  header.set(sessionId, 0)
  header[SESSION_ID_LENGTH] = direction === 'phone-to-host' ? 0 : 1
  header[SESSION_ID_LENGTH + 1] = 0 // text; binary frames are not used yet
  writeUint64(header, SESSION_ID_LENGTH + 2, counter)
  return header
}

function frameNonce(sessionId: Uint8Array, direction: PhoneE2EEDirection, counter: bigint): Uint8Array {
  const nonce = new Uint8Array(NONCE_LENGTH)
  // Fresh keys and session id per channel make this layout unique without drawing random nonces.
  nonce.set(sessionId.subarray(0, 12), 0)
  nonce[12] = FRAME_VERSION
  nonce[13] = direction === 'phone-to-host' ? 0 : 1
  nonce[14] = 0
  nonce[15] = 0
  writeUint64(nonce, 16, counter)
  return nonce
}

export function sealPhoneFrame(args: { plaintext: Uint8Array; key: Uint8Array; sessionId: Uint8Array; direction: PhoneE2EEDirection; counter: bigint }): Uint8Array {
  if (args.counter < 0n || args.counter > MAX_COUNTER) throw new Error('E2EE counter out of range')
  const nonce = frameNonce(args.sessionId, args.direction, args.counter)
  const sealed = xchacha20poly1305(args.key, nonce, frameHeader(args.sessionId, args.direction, args.counter)).encrypt(args.plaintext)
  return concatBytes([nonce, sealed])
}

/** The plaintext, or null for a frame that is not exactly the expected next one. */
export function openPhoneFrame(args: { frame: Uint8Array; key: Uint8Array; sessionId: Uint8Array; direction: PhoneE2EEDirection; expectedCounter: bigint }): Uint8Array | null {
  if (args.frame.length < NONCE_LENGTH + TAG_LENGTH) return null
  const nonce = frameNonce(args.sessionId, args.direction, args.expectedCounter)
  if (!equalBytes(args.frame.subarray(0, NONCE_LENGTH), nonce)) return null
  try {
    return xchacha20poly1305(args.key, nonce, frameHeader(args.sessionId, args.direction, args.expectedCounter)).decrypt(args.frame.subarray(NONCE_LENGTH))
  } catch {
    return null
  }
}

/** One side of an open channel: seals what it sends, opens what it receives, in order. */
export class PhoneE2EEChannel {
  private sendCounter = 0n
  private receiveCounter = 0n
  private brokenFlag = false

  constructor(
    private readonly keys: PhoneE2EEKeys,
    readonly side: 'phone' | 'host'
  ) {}

  get transcriptHash(): Uint8Array {
    return this.keys.transcriptHash
  }

  /** A frame failed to open: nothing more opens on this channel. */
  get broken(): boolean {
    return this.brokenFlag
  }

  /** Standard base64 of the sealed frame, as the relay's `data` carries it. */
  seal(text: string): string {
    const phone = this.side === 'phone'
    const frame = sealPhoneFrame({
      plaintext: utf8(text),
      key: phone ? this.keys.phoneToHostKey : this.keys.hostToPhoneKey,
      sessionId: this.keys.sessionId,
      direction: phone ? 'phone-to-host' : 'host-to-phone',
      counter: this.sendCounter++
    })
    return encodeBase64(frame)
  }

  /** The text, or null (and the channel is broken) for a bad, replayed or reordered frame. */
  open(data: string): string | null {
    if (this.brokenFlag) return null
    const phone = this.side === 'phone'
    let frame: Uint8Array
    try {
      frame = decodeBase64(data)
    } catch {
      this.brokenFlag = true
      return null
    }
    const plaintext = openPhoneFrame({
      frame,
      key: phone ? this.keys.hostToPhoneKey : this.keys.phoneToHostKey,
      sessionId: this.keys.sessionId,
      direction: phone ? 'host-to-phone' : 'phone-to-host',
      expectedCounter: this.receiveCounter
    })
    if (!plaintext) {
      this.brokenFlag = true
      return null
    }
    this.receiveCounter++
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
    } catch {
      this.brokenFlag = true
      return null
    }
  }
}

// ── Handshake ──────────────────────────────────────────────────────────────────

const RELAY_HOST_ID = /^h_[A-Za-z0-9_-]{8,64}$/

function contextFor(transport: PhoneE2EETransport, relayHostId: string): PhoneE2EEContext {
  return { protocol: PHONE_E2EE_PROTOCOL, initiator: 'phone', responder: 'host', transport, relayHostId: transport === 'relay' ? relayHostId : '' }
}

/** The phone's side: send `hello`, then hand the host's ready to `accept`. */
export function createPhoneHandshake(args: {
  /** The host's X25519 key pinned at pairing (base64url or base64). */
  hostPublicKey: string
  transport: PhoneE2EETransport
  relayHostId: string
  random: RandomBytes
}): { hello: PhoneE2EEHello; accept(ready: unknown): PhoneE2EEChannel | null } {
  const secret = args.random(32)
  const clientNonce = args.random(32)
  requireLength(secret, 32, 'random')
  const pinned = decodeAnyBase64(args.hostPublicKey)
  const hello: PhoneE2EEHello = {
    type: 'e2ee_hello',
    v: PHONE_E2EE_VERSION,
    clientPublicKey: encodeBase64(x25519.getPublicKey(secret)),
    clientNonce: encodeBase64(clientNonce),
    context: contextFor(args.transport, args.relayHostId)
  }
  return {
    hello,
    accept: (value) => {
      const ready = parseReady(value)
      if (!ready || !contextsEqual(ready.context, hello.context) || ready.clientNonce !== hello.clientNonce) return null
      const hostStatic = decodeBase64(ready.hostPublicKey)
      if (!equalBytes(hostStatic, pinned)) return null
      try {
        const ikm = concatBytes([x25519.getSharedSecret(secret, decodeBase64(ready.hostEphemeralKey)), x25519.getSharedSecret(secret, hostStatic)])
        const keys = derivePhoneE2EEKeys({
          inputKeyMaterial: ikm,
          transcript: encodePhoneE2EETranscript(hello, ready),
          clientNonce,
          hostNonce: decodeBase64(ready.hostNonce)
        })
        return new PhoneE2EEChannel(keys, 'phone')
      } catch {
        // A low-order point or another key X25519 refuses.
        return null
      }
    }
  }
}

/** The host's side: answer a phone's hello, or null when it is not one this host accepts. */
export function answerPhoneHello(
  value: unknown,
  args: {
    /** The host's X25519 secret key (base64url or base64), whose public part phones pinned. */
    hostSecretKey: string
    transport: PhoneE2EETransport
    relayHostId: string
    random: RandomBytes
  }
): { ready: PhoneE2EEReady; channel: PhoneE2EEChannel } | null {
  const hello = parseHello(value)
  if (!hello || !contextsEqual(hello.context, contextFor(args.transport, args.relayHostId))) return null
  const hostSecret = decodeAnyBase64(args.hostSecretKey)
  const ephemeral = args.random(32)
  const hostNonce = args.random(32)
  const ready: PhoneE2EEReady = {
    type: 'e2ee_ready',
    v: PHONE_E2EE_VERSION,
    hostPublicKey: encodeBase64(x25519.getPublicKey(hostSecret)),
    hostEphemeralKey: encodeBase64(x25519.getPublicKey(ephemeral)),
    clientNonce: hello.clientNonce,
    hostNonce: encodeBase64(hostNonce),
    context: hello.context
  }
  try {
    const clientPublic = decodeBase64(hello.clientPublicKey)
    const ikm = concatBytes([x25519.getSharedSecret(ephemeral, clientPublic), x25519.getSharedSecret(hostSecret, clientPublic)])
    const keys = derivePhoneE2EEKeys({
      inputKeyMaterial: ikm,
      transcript: encodePhoneE2EETranscript(hello, ready),
      clientNonce: decodeBase64(hello.clientNonce),
      hostNonce
    })
    return { ready, channel: new PhoneE2EEChannel(keys, 'host') }
  } catch {
    return null
  }
}

function parseContext(value: unknown): PhoneE2EEContext | null {
  if (!isExactRecord(value, ['protocol', 'initiator', 'responder', 'transport', 'relayHostId'])) return null
  if (value.protocol !== PHONE_E2EE_PROTOCOL || value.initiator !== 'phone' || value.responder !== 'host') return null
  if (value.transport === 'relay') {
    if (typeof value.relayHostId !== 'string' || !RELAY_HOST_ID.test(value.relayHostId)) return null
  } else if (value.transport !== 'direct' || value.relayHostId !== '') return null
  return value as unknown as PhoneE2EEContext
}

function parseHello(value: unknown): PhoneE2EEHello | null {
  if (!isExactRecord(value, ['type', 'v', 'clientPublicKey', 'clientNonce', 'context'])) return null
  if (value.type !== 'e2ee_hello' || value.v !== PHONE_E2EE_VERSION || !parseContext(value.context)) return null
  if (!canonicalBase64(value.clientPublicKey, 32) || !canonicalBase64(value.clientNonce, 32)) return null
  return value as unknown as PhoneE2EEHello
}

function parseReady(value: unknown): PhoneE2EEReady | null {
  if (!isExactRecord(value, ['type', 'v', 'hostPublicKey', 'hostEphemeralKey', 'clientNonce', 'hostNonce', 'context'])) return null
  if (value.type !== 'e2ee_ready' || value.v !== PHONE_E2EE_VERSION || !parseContext(value.context)) return null
  for (const key of ['hostPublicKey', 'hostEphemeralKey', 'clientNonce', 'hostNonce'] as const) {
    if (!canonicalBase64(value[key], 32)) return null
  }
  return value as unknown as PhoneE2EEReady
}

function contextsEqual(a: PhoneE2EEContext, b: PhoneE2EEContext): boolean {
  return a.protocol === b.protocol && a.initiator === b.initiator && a.responder === b.responder && a.transport === b.transport && a.relayHostId === b.relayHostId
}

// ── Bytes ──────────────────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]))

/** Standard padded base64; written out so it does not depend on btoa (absent from some runtimes). */
export function encodeBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!
    out += c === undefined ? '=' : B64[c & 63]!
  }
  return out
}

/** Standard padded base64 → bytes; throws on anything else. */
export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('not base64')
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const out = new Uint8Array((text.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => B64_INDEX.get(text[i + k]!) ?? 0)
    const v = (n[0]! << 18) | (n[1]! << 12) | (n[2]! << 6) | n[3]!
    if (o < out.length) out[o++] = (v >> 16) & 255
    if (o < out.length) out[o++] = (v >> 8) & 255
    if (o < out.length) out[o++] = v & 255
  }
  return out
}

/** base64url (unpadded, as pairing keys are) or standard base64. */
function decodeAnyBase64(text: string): Uint8Array {
  const std = text.replace(/-/g, '+').replace(/_/g, '/')
  return decodeBase64(std + '='.repeat((4 - (std.length % 4)) % 4))
}

function canonicalBase64(value: unknown, length: number): boolean {
  if (typeof value !== 'string') return false
  try {
    const bytes = decodeBase64(value)
    return bytes.length === length && encodeBase64(bytes) === value
  } catch {
    return false
  }
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function writeUint64(target: Uint8Array, offset: number, value: bigint): void {
  let remaining = value
  for (let index = 7; index >= 0; index--) {
    target[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!
  return difference === 0
}

function requireLength(bytes: Uint8Array, expected: number, label: string): void {
  if (bytes.length !== expected) throw new Error(`Invalid ${label}: expected ${expected} bytes, got ${bytes.length}`)
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
