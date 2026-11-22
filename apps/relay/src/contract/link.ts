// The host link shared by bots and the phone relay: registration over HTTPS, then one WebSocket
// per daemon on `/v1/host?hostId=<id>`. The Hub sends a nonce; the daemon answers with an Ed25519
// signature over `zomfy-relay-v1|<hostId>|<nonce>`; a bad or revoked key closes with 4401.
// `{"ch":"link","type":"ping"}` is answered with `{"ch":"link","type":"pong"}` by the runtime,
// without waking the Hub.

import { z } from 'zod'
import { SIGNATURE_DOMAIN } from './version'

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)
const hostId = z.string().regex(/^h_[A-Za-z0-9_-]{8,64}$/)

/** Raw 32-byte Ed25519 public key, base64. */
export const publicKeySchema = base64.refine((s) => s.length === 44, { message: 'not a 32-byte key' })
/** Raw 64-byte Ed25519 signature, base64. */
export const signatureSchema = base64.refine((s) => s.length === 88, { message: 'not a 64-byte signature' })
export const hostIdSchema = hostId

// --- Registration (HTTPS) ---

/** `POST /v1/hosts/register`: with the deployment's setup code, or a host invite. */
export const registerRequestSchema = z
  .object({
    setupCode: z.string().min(1).max(256).optional(),
    invite: z.string().min(1).max(256).optional(),
    publicKey: publicKeySchema,
    name: z.string().min(1).max(256)
  })
  .refine((r) => Boolean(r.setupCode) !== Boolean(r.invite), { message: 'give a setup code or an invite' })
export type RegisterRequest = z.infer<typeof registerRequestSchema>

export const registerResponseSchema = z.object({ hostId })
export type RegisterResponse = z.infer<typeof registerResponseSchema>

/** `POST /v1/hosts/invite`, signed by a registered host over `invite|<hostId>|<at>`. */
export const inviteRequestSchema = z.object({ hostId, at: z.number().int().nonnegative(), signature: signatureSchema })
export type InviteRequest = z.infer<typeof inviteRequestSchema>

export const inviteResponseSchema = z.object({ invite: z.string().min(1).max(256), expiresAt: z.number().int() })
export type InviteResponse = z.infer<typeof inviteResponseSchema>

export const HTTP_ERROR_CODES = [
  'bad_request',
  'bad_setup_code',
  'setup_code_used',
  'setup_not_configured',
  'bad_invite',
  'bad_signature',
  'unknown_host',
  'too_large',
  'not_found'
] as const
export const httpErrorSchema = z.object({ error: z.union([z.enum(HTTP_ERROR_CODES), z.string().max(64)]) })
export type HttpError = z.infer<typeof httpErrorSchema>

// --- The link channel on the WebSocket ---

export const challengeSchema = z.object({ ch: z.literal('link'), type: z.literal('challenge'), nonce: base64 })
export const authSchema = z.object({ ch: z.literal('link'), type: z.literal('auth'), signature: signatureSchema })
export const authOkSchema = z.object({ ch: z.literal('link'), type: z.literal('auth-ok'), hostId })
export const pingSchema = z.object({ ch: z.literal('link'), type: z.literal('ping') })
export const pongSchema = z.object({ ch: z.literal('link'), type: z.literal('pong') })

/** Exact frames for the runtime's auto-response; keep them byte-for-byte. */
export const PING_FRAME = '{"ch":"link","type":"ping"}'
export const PONG_FRAME = '{"ch":"link","type":"pong"}'

export const linkToHubSchema = z.discriminatedUnion('type', [authSchema, pingSchema])
export const linkToHostSchema = z.discriminatedUnion('type', [challengeSchema, authOkSchema, pongSchema])

// --- What is signed ---

export function linkSigningText(hostId: string, nonce: string): string {
  return `${SIGNATURE_DOMAIN}|${hostId}|${nonce}`
}

export function inviteSigningText(hostId: string, at: number): string {
  return `${SIGNATURE_DOMAIN}|invite|${hostId}|${at}`
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}
