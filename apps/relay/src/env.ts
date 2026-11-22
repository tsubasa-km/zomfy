import type { DiscordGateway } from './discord-gateway'
import type { Hub } from './hub'

/** Bindings and secrets of Zomfy Relay; every secret is optional except SETUP_CODE. */
export interface Env {
  HUB: DurableObjectNamespace<Hub>
  DISCORD_GATEWAY: DurableObjectNamespace<DiscordGateway>
  SETUP_CODE?: string
  DISCORD_APPLICATION_ID?: string
  DISCORD_PUBLIC_KEY?: string
  DISCORD_BOT_TOKEN?: string
  SLACK_BOT_TOKEN?: string
  SLACK_SIGNING_SECRET?: string
  GITHUB_APP_ID?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_WEBHOOK_SECRET?: string
  GITHUB_APP_SLUG?: string
  LINEAR_ACCESS_TOKEN?: string
  LINEAR_WEBHOOK_SECRET?: string
  /** Linear OAuth app with client credentials on: the Hub gets its app-actor token itself. */
  LINEAR_CLIENT_ID?: string
  LINEAR_CLIENT_SECRET?: string
  EXPO_ACCESS_TOKEN?: string
  /** Tests only: a fake Discord (REST and Gateway) behind a service binding. Never set in a deployment. */
  DISCORD_TRANSPORT?: Fetcher
  /** Tests only: fake Slack, GitHub and Linear APIs behind a service binding. Never set in a deployment. */
  SOURCES_TRANSPORT?: Fetcher
}

export const RELAY_VERSION = '0.1.0'

/** Sources whose secrets are all set; the rest are off and their routes answer 404. */
export function configuredSources(env: Env): string[] {
  const has = (...names: (keyof Env)[]) => names.every((name) => typeof env[name] === 'string' && env[name] !== '')
  const sources: string[] = []
  if (has('DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN')) sources.push('discord')
  if (has('SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET')) sources.push('slack')
  if (has('GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET')) sources.push('github')
  if (has('LINEAR_WEBHOOK_SECRET') && (has('LINEAR_ACCESS_TOKEN') || has('LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'))) sources.push('linear')
  return sources
}
