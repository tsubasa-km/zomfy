// Events: what happens in a bot's chats, sent daemon → Hub in ordered batches. `seq` starts at 0
// after each `hello-ok`; the Hub ignores a batch whose `seq` it has already seen.

import { z } from 'zod'
import {
  maxActivityChars,
  maxActivitySteps,
  maxLongAnswerBytes,
  maxPromptTextBytes,
  maxReviewNoteChars,
  maxReviewNotePathChars,
  maxReviewNotes,
  maxSnapshotConversations,
  maxWorkLinks
} from '../limits'
import { conversationSchema } from './refs'
import { failureSchema } from './failures'

const id = z.string().min(1).max(128)
const time = z.number().int().nonnegative()
const utf8Bytes = (max: number) =>
  z.string().refine((text) => new TextEncoder().encode(text).length <= max, { message: `over ${max} bytes` })

export const REPLY_OUTCOMES = [
  'answered',
  'quiet',
  'no_answer',
  'interrupted',
  'failed',
  'cancelled',
  'withdrawn',
  'cleared',
  'not_found',
  'unattributed'
] as const
export const replyOutcomeSchema = z.enum(REPLY_OUTCOMES)
export type ReplyOutcome = z.infer<typeof replyOutcomeSchema>

const promptOptionSchema = z.object({ id, label: z.string().max(256), kind: z.string().max(32).optional() })

export const promptSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('approval'),
    tool: z.string().max(256),
    summary: utf8Bytes(maxPromptTextBytes),
    options: z.array(promptOptionSchema).min(1).max(8)
  }),
  z.object({
    kind: z.literal('question'),
    text: utf8Bytes(maxPromptTextBytes),
    header: z.string().max(256).optional(),
    options: z.array(promptOptionSchema).max(8),
    byReply: z.boolean()
  }),
  z.object({ kind: z.literal('unsupported'), text: utf8Bytes(maxPromptTextBytes) })
])
export type Prompt = z.infer<typeof promptSchema>

const where = { conversation: conversationSchema }

export const botEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('snapshot'),
    conversations: z
      .array(z.object({ ...where, sessionId: id, botId: id, lastActiveAt: time }))
      .max(maxSnapshotConversations)
  }),
  z.object({ kind: z.literal('linked'), ...where, sessionId: id, botId: id }),
  z.object({ kind: z.literal('unlinked'), ...where, sessionId: id }),
  z.object({ kind: z.literal('chat-gone'), ...where, sessionId: id }),
  z.object({ kind: z.literal('prompt'), ...where, sessionId: id, turnId: id, promptId: id, prompt: promptSchema }),
  z.object({
    kind: z.literal('prompt-cleared'),
    ...where,
    promptId: id,
    by: z.enum(['zomfy', 'source', 'expired']).optional()
  }),
  z.object({ kind: z.literal('turn-started'), ...where, sessionId: id, turnId: id }),
  z.object({
    kind: z.literal('activity'),
    ...where,
    turnId: id,
    text: z.string().max(maxActivityChars),
    steps: z
      .array(z.object({ text: z.string().max(maxActivityChars), status: z.enum(['pending', 'running', 'done', 'failed']) }))
      .max(maxActivitySteps)
  }),
  z.object({
    kind: z.literal('workers'),
    ...where,
    workers: z.array(z.object({ sessionId: id, title: z.string().max(256), status: z.string().max(32) })).max(50)
  }),
  z.object({ kind: z.literal('turn-ended'), ...where, turnId: id, outcome: replyOutcomeSchema }),
  z.object({
    kind: z.literal('reply'),
    ...where,
    sessionId: id,
    turnId: id,
    text: utf8Bytes(maxLongAnswerBytes),
    outcome: replyOutcomeSchema,
    failure: failureSchema.optional(),
    prLinks: z.array(z.url().max(2048)).max(maxWorkLinks).default([]),
    reviewNotes: z
      .array(
        z.object({
          path: z.string().max(maxReviewNotePathChars),
          line: z.number().int().positive().optional(),
          body: z.string().max(maxReviewNoteChars)
        })
      )
      .max(maxReviewNotes)
      .default([]),
    /** `<sessionId>:<turnId>`: a retried reply never posts twice. */
    idempotencyKey: z.string().min(1).max(256)
  })
])
export type BotEvent = z.infer<typeof botEventSchema>
export type BotEventKind = BotEvent['kind']
export const BOT_EVENT_KINDS = botEventSchema.options.map((o) => o.shape.kind.value) as BotEventKind[]

export const eventsSchema = z.object({
  ch: z.literal('bots'),
  type: z.literal('events'),
  helloRev: z.number().int().positive(),
  seq: z.number().int().nonnegative(),
  /** Parsed one by one by the Hub; an unknown kind is skipped, not the batch. */
  events: z.array(z.unknown()).max(1000)
})
export type Events = z.infer<typeof eventsSchema>
