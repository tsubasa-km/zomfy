import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'

/**
 * Holds the Discord Gateway connection, which cannot hibernate, and forwards message events to the
 * Hub (docs/specs/bots/sources/discord.md). Declared from the first migration so adding Discord
 * needs no new one; until then it does nothing.
 */
export class DiscordGateway extends DurableObject<Env> {
  override async fetch(): Promise<Response> {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
