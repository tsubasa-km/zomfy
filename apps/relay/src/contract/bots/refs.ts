// A `ref` names a place in a source, as text: `discord:<guild>:<channel>:<thread?>:<message?>`,
// `slack:<team>:<channel>:<thread_ts?>`, `github:<installation>:<owner/repo>:<number?>` (no number:
// the whole repository, as a trigger rule's place),
// `linear:<org>:<issue>`, `zomfy:<sessionId>`. Trailing optional parts are left out
// (`discord:1:2` is a channel); a missing middle part is empty (`discord:1:2::9`).

import { z } from 'zod'

export const SOURCES = ['discord', 'slack', 'github', 'linear', 'webhook'] as const
export const sourceSchema = z.enum(SOURCES)
export type Source = z.infer<typeof sourceSchema>

export type Ref =
  | { source: 'discord'; guild: string; channel: string; thread?: string; message?: string }
  | { source: 'slack'; team: string; channel: string; threadTs?: string }
  | { source: 'github'; installation: string; repo: string; number?: number }
  | { source: 'linear'; org: string; issue: string }
  | { source: 'zomfy'; sessionId: string }

const opt = (part: string | undefined) => (part ? part : undefined)

export function parseRef(text: string): Ref | null {
  const [source, ...parts] = text.split(':')
  switch (source) {
    case 'discord': {
      const [guild, channel, thread, message] = parts
      if (!guild || !channel || parts.length > 4) return null
      return { source, guild, channel, thread: opt(thread), message: opt(message) }
    }
    case 'slack': {
      const [team, channel, threadTs] = parts
      if (!team || !channel || parts.length > 3) return null
      return { source, team, channel, threadTs: opt(threadTs) }
    }
    case 'github': {
      const [installation, repo, number] = parts
      if (parts.length < 2 || parts.length > 3 || !installation || !repo) return null
      if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return null
      if (number === undefined) return { source, installation, repo }
      if (!/^\d+$/.test(number)) return null
      return { source, installation, repo, number: Number(number) }
    }
    case 'linear': {
      const [org, issue] = parts
      if (parts.length !== 2 || !org || !issue) return null
      return { source, org, issue }
    }
    case 'zomfy': {
      const [sessionId] = parts
      if (parts.length !== 1 || !sessionId) return null
      return { source, sessionId }
    }
    default:
      return null
  }
}

export function formatRef(ref: Ref): string {
  switch (ref.source) {
    case 'discord':
      return ['discord', ref.guild, ref.channel, ref.thread ?? '', ref.message ?? ''].join(':').replace(/:+$/, '')
    case 'slack':
      return ['slack', ref.team, ref.channel, ref.threadTs ?? ''].join(':').replace(/:+$/, '')
    case 'github':
      return ref.number === undefined ? `github:${ref.installation}:${ref.repo}` : `github:${ref.installation}:${ref.repo}:${ref.number}`
    case 'linear':
      return `linear:${ref.org}:${ref.issue}`
    case 'zomfy':
      return `zomfy:${ref.sessionId}`
  }
}

/** A ref as it travels: a string that `parseRef` accepts. */
export const refSchema = z
  .string()
  .max(512)
  .refine((text) => parseRef(text) !== null, { message: 'invalid ref' })

/** A conversation in a source: the source and its own id for the thread, DM or issue. */
export const conversationSchema = z.object({ source: sourceSchema, externalId: z.string().min(1).max(512) })
export type Conversation = z.infer<typeof conversationSchema>

export function conversationKey(conversation: Conversation): string {
  return `${conversation.source}:${conversation.externalId}`
}
