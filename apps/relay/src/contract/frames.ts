// Parsing a WebSocket text frame `{ch, type, ...}` on the host link. Unknown channels and types
// are ignored, not rejected, so either side can be newer; unknown fields are stripped by the schemas.

import type { z } from 'zod'
import { botsToHostSchema, botsToHubSchema } from './bots'
import { maxMessageBytes } from './limits'
import { linkToHostSchema, linkToHubSchema } from './link'
import { phoneToHostSchema, phoneToHubSchema } from './phone'

export type ToHub =
  | z.infer<typeof linkToHubSchema>
  | z.infer<typeof botsToHubSchema>
  | z.infer<typeof phoneToHubSchema>
export type ToHost =
  | z.infer<typeof linkToHostSchema>
  | z.infer<typeof botsToHostSchema>
  | z.infer<typeof phoneToHostSchema>

export type Parsed<T> =
  | { kind: 'message'; message: T }
  /** An unknown channel or type: skip it. */
  | { kind: 'ignored'; ch?: string; type?: string }
  /** A known type whose fields are wrong, or text that is not a JSON object. */
  | { kind: 'invalid'; ch?: string; type?: string; error: string }

type Unions = Record<string, z.ZodDiscriminatedUnion<any, 'type'>>

const toHub: Unions = { link: linkToHubSchema, bots: botsToHubSchema, phone: phoneToHubSchema }
const toHost: Unions = { link: linkToHostSchema, bots: botsToHostSchema, phone: phoneToHostSchema }

function knownTypes(union: z.ZodDiscriminatedUnion<any, 'type'>): Set<string> {
  return new Set((union.options as Array<z.ZodObject<any>>).map((o) => (o.shape.type as z.ZodLiteral<string>).value))
}

const typesCache = new Map<z.ZodDiscriminatedUnion<any, 'type'>, Set<string>>()

function parseWith<T>(unions: Unions, text: string): Parsed<T> {
  if (text.length > maxMessageBytes) return { kind: 'invalid', error: 'too_large' }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { kind: 'invalid', error: 'not JSON' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid', error: 'not an object' }
  const { ch, type } = value as { ch?: unknown; type?: unknown }
  if (typeof ch !== 'string' || typeof type !== 'string') return { kind: 'invalid', error: 'missing ch or type' }
  const union = Object.hasOwn(unions, ch) ? unions[ch] : undefined
  if (!union) return { kind: 'ignored', ch, type }
  let types = typesCache.get(union)
  if (!types) typesCache.set(union, (types = knownTypes(union)))
  if (!types.has(type)) return { kind: 'ignored', ch, type }
  const result = union.safeParse(value)
  if (!result.success) return { kind: 'invalid', ch, type, error: result.error.message }
  return { kind: 'message', message: result.data as T }
}

/** A frame the Hub received from a daemon. */
export function parseToHub(text: string): Parsed<ToHub> {
  return parseWith<ToHub>(toHub, text)
}

/** A frame a daemon received from the Hub. */
export function parseToHost(text: string): Parsed<ToHost> {
  return parseWith<ToHost>(toHost, text)
}
