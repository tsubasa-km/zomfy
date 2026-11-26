import type { ConnectorStatus } from '@zomfy/protocol'
import { t } from '@/i18n/i18n'

// The features of Zomfy Relay and what each needs (docs/specs/relay-settings.md). The relay serves
// them; Settings → Zomfy Relay shows which it has and the Set up with an agent prompt names them.

export const RELAY_FEATURES = ['phone', 'discord', 'slack', 'github', 'linear', 'webhooks'] as const
export type RelayFeature = (typeof RELAY_FEATURES)[number]

export const ZOMFY_REPO = 'https://github.com/tsubasa-km/zomfy'
export const RELAY_README_URL = `${ZOMFY_REPO}/blob/main/apps/relay/README.md`
export const RELAY_DEPLOY_URL = `https://deploy.workers.cloudflare.com/?url=${ZOMFY_REPO}/tree/main/apps/relay`

export interface RelaySecret {
  name: string
  where: string
}

export interface RelayFeatureInfo {
  id: RelayFeature
  label: string
  /** Every secret it needs; Linear's alternatives are told in `steps`. */
  secrets: RelaySecret[]
  steps: string
  /** The README section with the full steps. */
  guide: string
  /** URLs to paste into the source, once the Worker URL is known. */
  urls: (base: string) => { label: string; url: string }[]
}

export function relayFeatureInfo(): RelayFeatureInfo[] {
  return [
    {
      id: 'phone',
      label: t('Phone app'),
      secrets: [],
      steps: t('Nothing to set in Cloudflare. Pair this computer with the relay here, then pair a phone in Settings → Devices.'),
      guide: `${RELAY_README_URL}#phones`,
      urls: () => []
    },
    {
      id: 'discord',
      label: 'Discord',
      secrets: [
        { name: 'DISCORD_APPLICATION_ID', where: t('General Information → Application ID') },
        { name: 'DISCORD_PUBLIC_KEY', where: t('General Information → Public Key') },
        { name: 'DISCORD_BOT_TOKEN', where: t('Bot → Reset Token; turn on Message Content Intent there too') }
      ],
      steps: t('Make an application at discord.com/developers, set its Interactions Endpoint URL, and add it to your server.'),
      guide: `${RELAY_README_URL}#discord`,
      urls: (base) => [{ label: t('Interactions endpoint URL'), url: `${base}/discord/interactions` }]
    },
    {
      id: 'slack',
      label: 'Slack',
      secrets: [
        { name: 'SLACK_BOT_TOKEN', where: t('OAuth & Permissions → Bot User OAuth Token (xoxb-…)') },
        { name: 'SLACK_SIGNING_SECRET', where: t('Basic Information → App Credentials → Signing Secret') }
      ],
      steps: t('Make a Slack app from apps/relay/slack-manifest.yaml with your Worker URL in it, and install it to your workspace.'),
      guide: `${RELAY_README_URL}#slack`,
      urls: (base) => [
        { label: t('Event Subscriptions request URL'), url: `${base}/slack/events` },
        { label: t('Interactivity request URL'), url: `${base}/slack/interactivity` }
      ]
    },
    {
      id: 'github',
      label: 'GitHub',
      secrets: [
        { name: 'GITHUB_APP_ID', where: t('The GitHub App’s App ID') },
        { name: 'GITHUB_APP_PRIVATE_KEY', where: t('The app’s private key, the whole .pem') },
        { name: 'GITHUB_WEBHOOK_SECRET', where: t('The app’s webhook secret') },
        { name: 'GITHUB_APP_SLUG', where: t('The app’s slug, as in github.com/apps/<slug>') }
      ],
      steps: t('bun run deploy --github in apps/relay makes the GitHub App and sets all four; then install the app on your repositories.'),
      guide: `${RELAY_README_URL}#github`,
      urls: (base) => [{ label: t('GitHub App webhook URL'), url: `${base}/github/webhook` }]
    },
    {
      id: 'linear',
      label: 'Linear',
      secrets: [
        { name: 'LINEAR_WEBHOOK_SECRET', where: t('The signing secret of the webhook to the URL below') },
        { name: 'LINEAR_ACCESS_TOKEN', where: t('A personal API key (lin_api_…), or instead LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET of an OAuth app') }
      ],
      steps: t('Make a webhook in Linear for Issues, Comments and Issue labels, and a personal API key or an OAuth app with Client credentials.'),
      guide: `${RELAY_README_URL}#linear`,
      urls: (base) => [{ label: t('Linear webhook URL'), url: `${base}/linear/webhook` }]
    },
    {
      id: 'webhooks',
      label: t('Webhooks'),
      secrets: [],
      steps: t('Nothing to set in Cloudflare: each webhook trigger on a bot gets a URL of its own.'),
      guide: `${RELAY_README_URL}#webhooks`,
      urls: () => []
    }
  ]
}

/** What a relay's `/health` says of its features, read by the daemon (paired) or by Check (not yet). */
export type RelayHealth = Pick<ConnectorStatus, 'sources' | 'features' | 'missing' | 'featuresFrom' | 'relayVersion'>

export type RelayFeatureState = { kind: 'on' } | { kind: 'needs'; secrets: string[] } | { kind: 'off' } | { kind: 'unknown' }

/** Whether the relay serves a feature; an older relay without `features` always served the phone and webhooks. */
export function relayFeatureState(feature: RelayFeature, health: RelayHealth | null): RelayFeatureState {
  if (!health) return { kind: 'unknown' }
  const missing = health.missing?.[feature]
  if (missing && missing.length > 0) return { kind: 'needs', secrets: missing }
  if (health.features) return health.features.includes(feature) ? { kind: 'on' } : { kind: 'off' }
  if (feature === 'phone' || feature === 'webhooks') return { kind: 'on' }
  return health.sources.includes(feature) ? { kind: 'on' } : { kind: 'off' }
}

/** The known features among `list`, in the relay's order. */
export function relayFeatureList(list: readonly string[]): RelayFeature[] {
  return RELAY_FEATURES.filter((feature) => list.includes(feature))
}

/** The value of the Worker's `FEATURES` for these features: `phone,discord`. */
export function featuresValue(list: readonly string[]): string {
  return relayFeatureList(list).join(',')
}

/** The Worker URL without a trailing slash, or null when it is not an http(s) URL. */
export function relayBase(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** Reads `<url>/health` straight from the relay (it allows any origin), before or after pairing. */
export async function checkRelayHealth(url: string, fetcher: typeof fetch = fetch): Promise<RelayHealth> {
  const base = relayBase(url)
  if (!base) throw new Error(t('Enter the Worker URL, https://…'))
  const res = await fetcher(`${base}/health`)
  if (!res.ok) throw new Error(t('The relay answered {status}.', { status: res.status }))
  const body = (await res.json()) as Record<string, unknown>
  if (body.ok !== true || !Array.isArray(body.sources)) throw new Error(t('That URL is not a Zomfy Relay.'))
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : undefined)
  const missing: Record<string, string[]> = {}
  if (body.missing && typeof body.missing === 'object') {
    for (const [source, names] of Object.entries(body.missing)) {
      const list = strings(names)
      if (list) missing[source] = list
    }
  }
  const features = strings(body.features)
  return {
    sources: strings(body.sources) ?? [],
    ...(features ? { features } : {}),
    missing,
    ...(body.featuresFrom === 'FEATURES' || body.featuresFrom === 'secrets' ? { featuresFrom: body.featuresFrom } : {}),
    ...(typeof body.version === 'string' ? { relayVersion: body.version } : {})
  }
}
