// Event trigger rules a host announces in `hello`. The Hub matches source events against them and
// queues a `trigger` delivery.

import { z } from 'zod'
import { maxPlacesPerRule, maxRuleGraceMs, maxRuleTextChars } from '../limits'
import { refSchema, sourceSchema } from './refs'

const ruleText = z.string().max(maxRuleTextChars)

export const ruleSchema = z.object({
  id: z.string().min(1).max(128),
  botId: z.string().min(1).max(128),
  source: sourceSchema,
  kinds: z.array(z.string().min(1).max(64)).max(32),
  places: z.array(refSchema).max(maxPlacesPerRule),
  from: ruleText.optional(),
  fromOwner: z.boolean().optional(),
  label: ruleText.optional(),
  workflowRun: ruleText.optional(),
  inThread: z.boolean().optional(),
  graceMs: z.number().int().nonnegative().max(maxRuleGraceMs)
})
export type Rule = z.infer<typeof ruleSchema>
