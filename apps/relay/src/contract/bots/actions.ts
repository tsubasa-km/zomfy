// Actions: a bot acting in a source (Orca's `/v1/connector/actions`), and the Hub's results. A
// `post` carries an idempotency key, so a retry never posts twice.

import { z } from 'zod'
import { refSchema } from './refs'

export const ACTION_VERBS = [
  'reply',
  'react',
  'read',
  'post',
  'find',
  'check',
  'edit',
  'delete',
  'attach',
  'set',
  'webhook.fetch',
  'capabilities'
] as const
export const actionVerbSchema = z.enum(ACTION_VERBS)
export type ActionVerb = z.infer<typeof actionVerbSchema>

export const actionSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('action'),
  helloRev: z.number().int().positive(),
  reqId: z.string().min(1).max(128),
  verb: actionVerbSchema,
  /** `webhook.fetch` and `capabilities` name no place; the rest do. */
  ref: refSchema.optional(),
  args: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(1).max(256).optional()
})
export type Action = z.infer<typeof actionSchema>

export const actionResultSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('action-result'),
  reqId: z.string().min(1).max(128),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string().max(64), message: z.string().max(1000) }).optional()
})
export type ActionResult = z.infer<typeof actionResultSchema>
