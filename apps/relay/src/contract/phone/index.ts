// The `phone` channel of the host link: device keys the daemon registers with the Hub, and the
// end-to-end encrypted frames the Hub only splices between a phone and its host
// (docs/specs/mobile/relay.md). The Hub never reads `data`.

import { z } from 'zod'
import { maxMessageBytes } from '../limits'
import { publicKeySchema } from '../link'

const deviceId = z.string().regex(/^d_[A-Za-z0-9_-]{8,64}$/)
/** Opaque base64 ciphertext; a frame over the message limit is refused. */
const data = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .max(maxMessageBytes)

export const deviceAddSchema = z.object({ ch: z.literal('phone'), type: z.literal('device-add'), deviceId, publicKey: publicKeySchema })
export const deviceRemoveSchema = z.object({ ch: z.literal('phone'), type: z.literal('device-remove'), deviceId })
export const phoneFrameSchema = z.object({ ch: z.literal('phone'), type: z.literal('frame'), deviceId, data })

export const phoneToHubSchema = z.discriminatedUnion('type', [deviceAddSchema, deviceRemoveSchema, phoneFrameSchema])
export const phoneToHostSchema = z.discriminatedUnion('type', [phoneFrameSchema])

/** What the Hub sends on a phone's own socket about its host. */
export const hostPresenceSchema = z.object({ type: z.enum(['host-offline', 'host-online']) })
