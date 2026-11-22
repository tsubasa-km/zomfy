// The `bots` channel of the host link: every message, by direction.

import { z } from 'zod'
import { actionResultSchema, actionSchema } from './actions'
import { ackSchema, deliveryMessageSchema } from './deliveries'
import { eventsSchema } from './events'
import { helloBotsSchema, helloOkSchema, helloSchema } from './hello'

export * from './actions'
export * from './askers'
export * from './deliveries'
export * from './events'
export * from './failures'
export * from './hello'
export * from './pr-events'
export * from './refs'
export * from './triggers'
export * from './webhooks'

export const controlSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('control'),
  action: z.enum(['stop', 'pause', 'reconnect']),
  /** For `pause`: how long the host should take no new deliveries. */
  forMs: z.number().int().nonnegative().optional()
})
export type Control = z.infer<typeof controlSchema>

export const BOTS_ERROR_CODES = ['hello_required', 'unknown_bot', 'grant_expired', 'too_large', 'rate_limited', 'bad_message'] as const

export const botsErrorSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('error'),
  code: z.union([z.enum(BOTS_ERROR_CODES), z.string().max(64)]),
  message: z.string().max(1000),
  /** The message the error is about, when it had one (`reqId`, `deliveryId` or `seq`). */
  about: z.union([z.string().max(128), z.number().int()]).optional()
})
export type BotsError = z.infer<typeof botsErrorSchema>

export const botsToHubSchema = z.discriminatedUnion('type', [helloSchema, helloBotsSchema, ackSchema, eventsSchema, actionSchema])
export type BotsToHub = z.infer<typeof botsToHubSchema>

export const botsToHostSchema = z.discriminatedUnion('type', [
  helloOkSchema,
  deliveryMessageSchema,
  actionResultSchema,
  controlSchema,
  botsErrorSchema
])
export type BotsToHost = z.infer<typeof botsToHostSchema>
