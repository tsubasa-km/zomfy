// `hello` announces a host's bots and trigger rules after every (re)connect and whenever they
// change; the Hub answers `hello-ok` with a new, monotonic `helloRev` that every later message
// carries. More than `maxBotsPerHello` bots follow in `hello-bots` pages before `hello-ok`.

import { z } from 'zod'
import { maxBotsPerHello, maxHandleChars, maxHelloBotPages, maxRulesPerHello } from '../limits'
import { refSchema, sourceSchema } from './refs'
import { askersMapSchema, ownerMapSchema } from './askers'
import { ruleSchema } from './triggers'

const id = z.string().min(1).max(128)

export const hostKindSchema = z.enum(['desktop', 'serve'])

export const helloBotSchema = z.object({
  id,
  name: z.string().min(1).max(256),
  handle: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(maxHandleChars),
  avatar: z.string().max(2048).optional(),
  agent: z.string().min(1).max(64),
  paused: z.boolean(),
  owner: ownerMapSchema,
  askers: askersMapSchema,
  places: z.array(refSchema).max(100)
})
export type HelloBot = z.infer<typeof helloBotSchema>

export const helloSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('hello'),
  contract: z.number().int().positive(),
  host: z.object({ id, name: z.string().max(256), kind: hostKindSchema }),
  features: z.array(z.string().max(64)).max(64),
  sources: z.array(sourceSchema),
  promptKinds: z.array(z.string().max(64)).max(16),
  bots: z.array(helloBotSchema).max(maxBotsPerHello),
  rules: z.array(ruleSchema).max(maxRulesPerHello),
  /** Pages of bots in all, counting this one; pages 2.. follow as `hello-bots`. */
  pages: z.number().int().min(1).max(maxHelloBotPages).default(1)
})
export type Hello = z.infer<typeof helloSchema>

export const helloBotsSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('hello-bots'),
  page: z.number().int().min(2).max(maxHelloBotPages),
  bots: z.array(helloBotSchema).max(maxBotsPerHello)
})
export type HelloBots = z.infer<typeof helloBotsSchema>

export const helloOkSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('hello-ok'),
  helloRev: z.number().int().positive(),
  features: z.array(z.string().max(64)).max(64),
  /** Ids of this host's deliveries not yet `done`; each is re-sent after this message. */
  unsettled: z.array(id)
})
export type HelloOk = z.infer<typeof helloOkSchema>
