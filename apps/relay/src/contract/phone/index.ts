// The `phone` channel of the host link: device keys the daemon registers with the Hub, and the
// end-to-end encrypted frames the Hub only splices between a phone and its host
// (docs/specs/mobile/relay.md). The Hub never reads `data`.

import { z } from 'zod'
import { maxDevicesPerHost, maxMessageBytes } from '../limits'
import { publicKeySchema, signatureSchema } from '../link'
import { SIGNATURE_DOMAIN } from '../version'

const deviceId = z.string().regex(/^d_[A-Za-z0-9_-]{8,64}$/)
/** Opaque base64 ciphertext; a frame over the message limit is refused. */
const data = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .max(maxMessageBytes)

export const deviceAddSchema = z.object({ ch: z.literal('phone'), type: z.literal('device-add'), deviceId, publicKey: publicKeySchema })
export const deviceRemoveSchema = z.object({ ch: z.literal('phone'), type: z.literal('device-remove'), deviceId })
export const phoneFrameSchema = z.object({ ch: z.literal('phone'), type: z.literal('frame'), deviceId, data })

// --- Phase M2: the rest of the phone channel ---

export const deviceIdSchema = deviceId

/** One registered device, as `device-sync` lists them. */
export const deviceKeySchema = z.object({ deviceId, publicKey: publicKeySchema })

/**
 * The host's whole device list, sent after each `auth-ok`: the Hub adds what is missing and drops
 * (and closes) what is not listed, so a revoke made while the link was down still reaches it.
 */
export const deviceSyncSchema = z.object({
  ch: z.literal('phone'),
  type: z.literal('device-sync'),
  devices: z.array(deviceKeySchema).max(maxDevicesPerHost)
})

/** The daemon ends a phone's socket (a broken channel, a revoke): the Hub closes it with `code`. */
export const phoneCloseSchema = z.object({
  ch: z.literal('phone'),
  type: z.literal('close'),
  deviceId,
  code: z.number().int().min(4000).max(4999),
  reason: z.string().max(120).optional()
})

/**
 * A phone's socket passed its key check, or the host's link came back while it was open: a new
 * end-to-end channel starts with the phone's next frame. `pairing` marks a phone that is not a
 * device yet and may only present a pairing grant inside the channel.
 */
export const deviceOpenSchema = z.object({
  ch: z.literal('phone'),
  type: z.literal('device-open'),
  deviceId,
  pairing: z.boolean().optional()
})
/** That phone's socket closed. */
export const deviceClosedSchema = z.object({ ch: z.literal('phone'), type: z.literal('device-closed'), deviceId })

export const phoneToHubSchema = z.discriminatedUnion('type', [
  deviceAddSchema,
  deviceRemoveSchema,
  phoneFrameSchema,
  deviceSyncSchema,
  phoneCloseSchema
])
export const phoneToHostSchema = z.discriminatedUnion('type', [phoneFrameSchema, deviceOpenSchema, deviceClosedSchema])

/** What the Hub sends on a phone's own socket about its host. */
export const hostPresenceSchema = z.object({ type: z.enum(['host-offline', 'host-online']) })

export type PhoneToHub = z.infer<typeof phoneToHubSchema>
export type PhoneToHost = z.infer<typeof phoneToHostSchema>

// --- The phone's own socket: `GET /v1/device/<hostId>/ws` ---

/** What a phone signs to prove its device key: `zomfy-relay-v1|<deviceId>|<nonce>`. */
export function deviceSigningText(deviceId: string, nonce: string): string {
  return `${SIGNATURE_DOMAIN}|${deviceId}|${nonce}`
}

const nonce = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(64)

/** Hub → phone, first: sign this. */
export const phoneChallengeSchema = z.object({ type: z.literal('challenge'), nonce })
/** Phone → Hub: a registered device proves its key. */
export const phoneAuthSchema = z.object({ type: z.literal('auth'), deviceId, signature: signatureSchema })
/**
 * Phone → Hub: a phone that is pairing over the relay proves the key it will register; the Hub lets
 * it reach the host, which accepts it only with a valid pairing grant inside the channel.
 */
export const phonePairSchema = z.object({ type: z.literal('pair'), deviceId, publicKey: publicKeySchema, signature: signatureSchema })
/** Hub → phone: the key check passed. */
export const phoneAuthOkSchema = z.object({ type: z.literal('auth-ok'), deviceId })
/** Either way: one opaque ciphertext frame. */
export const phoneSocketFrameSchema = z.object({ type: z.literal('frame'), data })
/** Hub → phone: a frame was refused (too large, or sent before auth-ok). */
export const phoneErrorSchema = z.object({ type: z.literal('error'), code: z.string().max(64) })

export const phoneSocketToHubSchema = z.discriminatedUnion('type', [phoneAuthSchema, phonePairSchema, phoneSocketFrameSchema])
export const hubToPhoneSocketSchema = z.discriminatedUnion('type', [
  phoneChallengeSchema,
  phoneAuthOkSchema,
  phoneSocketFrameSchema,
  phoneErrorSchema,
  z.object({ type: z.literal('host-offline') }),
  z.object({ type: z.literal('host-online') })
])
export type PhoneSocketToHub = z.infer<typeof phoneSocketToHubSchema>
export type HubToPhoneSocket = z.infer<typeof hubToPhoneSocketSchema>

/** `d_<id>`: the relay's name for a device the daemon keeps as `<id>`. */
export function relayDeviceId(id: string): string {
  return `d_${id}`
}
