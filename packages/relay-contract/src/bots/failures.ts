// Typed failure categories, so each source can phrase them. An unknown or malformed category reads
// as `agent_error`, so a newer daemon never breaks an older Worker.

import { z } from 'zod'

export const FAILURE_CATEGORIES = [
  'signed_out',
  'usage_limit',
  'not_set_up',
  'folder_missing',
  'agent_error',
  'unconfirmed'
] as const

const knownFailureSchema = z.discriminatedUnion('category', [
  z.object({ category: z.literal('signed_out') }),
  z.object({
    category: z.literal('usage_limit'),
    window: z.string().max(64).optional(),
    resetsAt: z.number().int().nonnegative().optional()
  }),
  z.object({ category: z.literal('not_set_up') }),
  z.object({ category: z.literal('folder_missing') }),
  z.object({ category: z.literal('agent_error'), message: z.string().max(1000).optional() }),
  z.object({ category: z.literal('unconfirmed') })
])

export type Failure = z.infer<typeof knownFailureSchema>
export const failureSchema = knownFailureSchema.catch((): Failure => ({ category: 'agent_error' }))
