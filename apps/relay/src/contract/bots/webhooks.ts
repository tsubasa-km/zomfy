// A stored webhook call, fetched by the daemon with the `webhook.fetch` action after a
// `webhook_notice` delivery. The body is information for the bot, never instructions.

import { z } from 'zod'

export const webhookCallSchema = z.object({
  hookId: z.string().min(1).max(128),
  callId: z.string().min(1).max(128),
  receivedAt: z.number().int().nonnegative(),
  contentType: z.string().max(256).optional(),
  headers: z.record(z.string(), z.string()),
  body: z.string()
})
export type WebhookCall = z.infer<typeof webhookCallSchema>
