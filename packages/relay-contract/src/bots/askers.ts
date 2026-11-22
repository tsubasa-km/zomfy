// Who can ask a bot: its owner on that source, or one of its members there. Orca's single rule
// (`canAskBot`); the Hub checks it before a delivery exists.

import { z } from 'zod'
import { maxMembersPerBot } from '../limits'
import { sourceSchema, type Source } from './refs'

export const askerRoleSchema = z.enum(['owner', 'member', 'other'])
export type AskerRole = z.infer<typeof askerRoleSchema>

export const memberSchema = z.object({ id: z.string().min(1).max(128), role: z.enum(['owner', 'member']) })
export type Member = z.infer<typeof memberSchema>

/** The person who asked, as the delivery tells the daemon. */
export const askerSchema = z.object({
  source: sourceSchema,
  id: z.string().min(1).max(128),
  name: z.string().max(256),
  role: askerRoleSchema
})
export type Asker = z.infer<typeof askerSchema>

export const ownerMapSchema = z.partialRecord(sourceSchema, z.string().min(1).max(128))
export const askersMapSchema = z.partialRecord(sourceSchema, z.array(memberSchema).max(maxMembersPerBot))

export interface AskableBot {
  owner: Partial<Record<Source, string>>
  askers: Partial<Record<Source, Member[]>>
}

/** The asker's role for this bot on this source; `other` may not start or steer it. */
export function askerRole(bot: AskableBot, source: Source, userId: string): AskerRole {
  if (bot.owner[source] === userId) return 'owner'
  const member = bot.askers[source]?.find((m) => m.id === userId)
  return member ? member.role : 'other'
}

export function canAskBot(bot: AskableBot, source: Source, userId: string): boolean {
  return askerRole(bot, source, userId) !== 'other'
}
