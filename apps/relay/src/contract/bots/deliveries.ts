// Deliveries: one request each for a host, with an id that stays the same across re-sends. The
// daemon writes a receipt before `ack received` and acks `done` with an outcome when finished.

import { z } from 'zod'
import { maxAnswerTextChars, maxContextFiles, maxDeliveriesPerMessage, maxWorkLinks } from '../limits'
import { conversationSchema, sourceSchema } from './refs'
import { askerSchema } from './askers'
import { failureSchema } from './failures'
import { prEventFieldsSchema } from './pr-events'

const id = z.string().min(1).max(128)
const time = z.number().int().nonnegative()

export const CONTEXT_LABELS = ['earlier', 'no_access', 'issue', 'bot', 'more', 'unreadable'] as const

/** Text around the request, labelled so the agent can tell its own posts and others' apart. */
export const contextItemSchema = z.object({
  label: z.enum(CONTEXT_LABELS),
  author: z.object({ id: z.string().max(128), name: z.string().max(256) }).optional(),
  text: z.string().max(32 * 1024),
  at: time.optional()
})
export type ContextItem = z.infer<typeof contextItemSchema>

export const linkSchema = z.object({ url: z.url().max(2048), title: z.string().max(512).optional() })
export const attachmentSchema = z.object({
  name: z.string().max(512),
  url: z.url().max(2048),
  mimeType: z.string().max(256).optional(),
  size: z.number().int().nonnegative().optional()
})

const base = {
  id,
  botId: id,
  conversation: conversationSchema,
  askedAt: time,
  expiresAt: time,
  asker: askerSchema.optional()
}

export const startDeliverySchema = z.object({
  ...base,
  kind: z.literal('start'),
  asker: askerSchema,
  placeId: z.string().min(1).max(512),
  text: z.string().max(maxAnswerTextChars * 8),
  context: z.array(contextItemSchema).max(64).default([]),
  links: z.array(linkSchema).max(maxWorkLinks * 4).default([]),
  attachments: z.array(attachmentSchema).max(maxContextFiles).default([])
})

export const sendDeliverySchema = z.object({
  ...base,
  kind: z.literal('send'),
  asker: askerSchema,
  text: z.string().max(maxAnswerTextChars * 8),
  context: z.array(contextItemSchema).max(64).default([])
})

export const answerDeliverySchema = z.object({
  ...base,
  kind: z.literal('answer'),
  asker: askerSchema,
  promptId: id,
  optionId: z.string().max(128).optional(),
  text: z.string().max(maxAnswerTextChars).optional()
})

export const cancelDeliverySchema = z.object({ ...base, kind: z.literal('cancel'), asker: askerSchema, turnId: id })

export const triggerDeliverySchema = z.object({
  ...base,
  kind: z.literal('trigger'),
  ruleId: id,
  event: z.record(z.string(), z.unknown()),
  graceMs: z.number().int().nonnegative()
})

export const webhookNoticeDeliverySchema = z.object({ ...base, kind: z.literal('webhook_notice'), hookId: id, callId: id })

export const prEventDeliverySchema = z.object({ ...base, kind: z.literal('pr_event'), ...prEventFieldsSchema.shape })

export const accessRequestDeliverySchema = z.object({
  ...base,
  kind: z.literal('access_request'),
  requester: z.object({ source: sourceSchema, id: z.string().min(1).max(128), name: z.string().max(256) }),
  message: z.string().max(maxAnswerTextChars).optional()
})

export const deliverySchema = z.discriminatedUnion('kind', [
  startDeliverySchema,
  sendDeliverySchema,
  answerDeliverySchema,
  cancelDeliverySchema,
  triggerDeliverySchema,
  webhookNoticeDeliverySchema,
  prEventDeliverySchema,
  accessRequestDeliverySchema
])
export type Delivery = z.infer<typeof deliverySchema>
export type DeliveryKind = Delivery['kind']
export const DELIVERY_KINDS = deliverySchema.options.map((o) => o.shape.kind.value) as DeliveryKind[]

/** Kinds that wait a day for the host; the rest live `deliveryTtlMs`. */
export const LONG_WAIT_KINDS: readonly DeliveryKind[] = ['start', 'send', 'trigger', 'webhook_notice', 'pr_event', 'access_request']

/** Hub → daemon: up to `maxDeliveriesPerMessage` deliveries. */
export const deliveryMessageSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('delivery'),
  helloRev: z.number().int().positive(),
  /**
   * Each item is parsed on its own by the daemon, so one delivery of a kind it does not know does
   * not hide the others; it is acked `done unsupported`.
   */
  deliveries: z.array(z.unknown()).min(1).max(maxDeliveriesPerMessage)
})
export type DeliveryMessage = z.infer<typeof deliveryMessageSchema>

export const ACK_OUTCOMES = ['accepted', 'refused', 'unknown', 'expired', 'unsupported'] as const
export const ackOutcomeSchema = z.enum(ACK_OUTCOMES)
export type AckOutcome = z.infer<typeof ackOutcomeSchema>

/** Daemon → Hub: `received` after a durable receipt; `done` with the outcome. */
export const ackSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('ack'),
  helloRev: z.number().int().positive(),
  deliveryId: id,
  step: z.enum(['received', 'done']),
  outcome: ackOutcomeSchema.optional(),
  failure: failureSchema.optional()
})
export type Ack = z.infer<typeof ackSchema>
