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
  /**
   * Which features to serve, comma- or space-separated (`phone,discord`); unset serves every source
   * with its secrets, the phone and webhooks (docs/specs/relay-settings.md#features). Not a secret.
   */
  FEATURES?: string
  /**
   * The relay's public origin when it runs behind a tunnel on the person's own machine
   * (docs/specs/bots/self-host.md); the URLs the Hub hands out use it. Unset in Cloudflare.
   */
  PUBLIC_URL?: string
  /** Tests only: a fake Discord (REST and Gateway) behind a service binding. Never set in a deployment. */
  DISCORD_TRANSPORT?: Fetcher
  /** Tests only: fake Slack, GitHub and Linear APIs behind a service binding. Never set in a deployment. */
  SOURCES_TRANSPORT?: Fetcher
}

export const RELAY_VERSION = '0.1.0'

/** The origin of `PUBLIC_URL` (`https://relay.example.com`), or null when it is unset or not an http(s) URL. */
export function publicOrigin(env: Pick<Env, 'PUBLIC_URL'>): string | null {
  const value = env.PUBLIC_URL?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/** Everything the relay can serve (docs/specs/relay-settings.md#features). */
export const RELAY_FEATURES = ['phone', 'discord', 'slack', 'github', 'linear', 'webhooks'] as const
export type RelayFeature = (typeof RELAY_FEATURES)[number]

const SOURCES = ['discord', 'slack', 'github', 'linear'] as const
type Source = (typeof SOURCES)[number]

/** The secrets each source needs; Linear needs its webhook secret and one of two ways to post. */
const SOURCE_SECRETS: Record<Exclude<Source, 'linear'>, (keyof Env)[]> = {
  discord: ['DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN'],
  slack: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
  github: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET']
}

function isSet(env: Env, name: keyof Env): boolean {
  const value = env[name]
  return typeof value === 'string' && value !== ''
}

/** The names of the secrets a source still lacks (never their values); empty when it has them all. */
export function missingSecrets(env: Env, source: Source): string[] {
  if (source !== 'linear') return SOURCE_SECRETS[source].filter((name) => !isSet(env, name))
  const missing: string[] = isSet(env, 'LINEAR_WEBHOOK_SECRET') ? [] : ['LINEAR_WEBHOOK_SECRET']
  if (isSet(env, 'LINEAR_ACCESS_TOKEN') || (isSet(env, 'LINEAR_CLIENT_ID') && isSet(env, 'LINEAR_CLIENT_SECRET'))) return missing
  // Half an OAuth app names its other half; otherwise the simpler way, a personal API key.
  if (isSet(env, 'LINEAR_CLIENT_ID')) return [...missing, 'LINEAR_CLIENT_SECRET']
  if (isSet(env, 'LINEAR_CLIENT_SECRET')) return [...missing, 'LINEAR_CLIENT_ID']
  return [...missing, 'LINEAR_ACCESS_TOKEN']
}

/** The features `FEATURES` lists, or null when it is unset or empty; unknown names are ignored. */
export function listedFeatures(env: Pick<Env, 'FEATURES'>): RelayFeature[] | null {
  const words = (env.FEATURES ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (words.length === 0) return null
  return RELAY_FEATURES.filter((feature) => words.includes(feature))
}

/**
 * Sources whose secrets are all set and, when `FEATURES` is set, that it lists; the rest are off
 * and their routes answer 404.
 */
export function configuredSources(env: Env): string[] {
  const listed = listedFeatures(env)
  return SOURCES.filter((source) => missingSecrets(env, source).length === 0 && (!listed || listed.includes(source)))
}

export interface RelayFeatureState {
  /** The features served now. */
  features: RelayFeature[]
  featuresFrom: 'FEATURES' | 'secrets'
  /** For a wanted source (listed, or with some of its secrets set), the names of the secrets it lacks. */
  missing: Partial<Record<Source, string[]>>
}

/** Whether a feature is served; `phone` and `webhooks` need no secrets of the deployment. */
export function featureOn(env: Env, feature: RelayFeature): boolean {
  if (feature !== 'phone' && feature !== 'webhooks') return configuredSources(env).includes(feature)
  const listed = listedFeatures(env)
  return !listed || listed.includes(feature)
}

/** What `/health` reports of the features: names only, never a secret's value. */
export function relayFeatures(env: Env): RelayFeatureState {
  const listed = listedFeatures(env)
  const features = RELAY_FEATURES.filter((feature) => featureOn(env, feature))
  const missing: RelayFeatureState['missing'] = {}
  for (const source of SOURCES) {
    const lacks = missingSecrets(env, source)
    if (lacks.length === 0) continue
    const names: (keyof Env)[] =
      source === 'linear' ? ['LINEAR_WEBHOOK_SECRET', 'LINEAR_ACCESS_TOKEN', 'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'] : SOURCE_SECRETS[source]
    const started = names.some((name) => isSet(env, name))
    if (listed ? listed.includes(source) : started) missing[source] = lacks
  }
  return { features, featuresFrom: listed ? 'FEATURES' : 'secrets', missing }
}
