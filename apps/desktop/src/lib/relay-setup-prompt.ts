import { RELAY_PROMPT_JA } from '@/i18n/ja/relay-setup-prompt'
import { featuresValue, relayFeatureList, ZOMFY_REPO, type RelayFeature } from './relay-features'

// The prompt "Set up with an agent" starts a chat with (docs/specs/relay-settings.md#the-prompt).
// It is in the language the person picks, not the window's, so both texts are built here; the
// Japanese one lives with the other Japanese text.

export type RelayPromptLanguage = 'en' | 'ja'

export interface RelaySetupPromptInput {
  features: readonly string[]
  language: RelayPromptLanguage
  /** A checkout of Zomfy already there, or a clone made for this chat. */
  place: 'checkout' | 'clone'
  cloudflareMcp: boolean
  /** The relay this computer is paired with, if any: the agent updates it rather than making another. */
  relayUrl: string | null
}

/** The pieces of the prompt in one language. */
export interface RelayPromptText {
  intro: (features: string) => string
  checkout: string
  clone: (repo: string) => string
  existing: (url: string) => string
  readFirst: string
  announce: string
  deploy: string
  mcp: string
  secrets: string
  setupCode: string
  featuresVar: (value: string) => string
  perFeature: string
  feature: Record<RelayFeature, string>
  featureName: Record<RelayFeature, string>
  health: string
  pair: string
  pairPhone: string
  limits: string
}

export const RELAY_PROMPT_EN: RelayPromptText = {
  intro: (features) =>
    `Set up Zomfy Relay, the Cloudflare Worker in \`apps/relay\` of the Zomfy repository, on my own Cloudflare account, for these features: ${features}.`,
  checkout: 'This folder is a checkout of Zomfy.',
  clone: (repo) => `This folder is a fresh clone of Zomfy (${repo}).`,
  existing: (url) => `Zomfy is already paired with a relay at ${url}: update that Worker rather than making a second one.`,
  readFirst: 'Read `apps/relay/README.md` and `docs/specs/relay-settings.md` first. Then go step by step:',
  announce:
    'Before each step, tell me what you are about to do, and wait for me wherever I have to act (signing in, making an app in Discord, Slack, GitHub or Linear, running a command).',
  deploy:
    'If `npx wrangler whoami` in `apps/relay` says I am not signed in, give me `npx wrangler login` to run. Then deploy with `npx wrangler deploy` in `apps/relay`, and note the Worker URL it prints.',
  mcp: 'You also have Cloudflare’s MCP server (`cloudflare`) in this chat: use it to look up my account and check the Worker, and if it needs signing in, ask me to sign in to it from the chat’s Connectors. Use it for this Worker only.',
  secrets:
    'Secrets: never invent, guess or generate a secret value, and never print, echo, log or commit one, or write one to a file in the repository. For each secret, give me the command in its own ```bash block (for example `npx wrangler secret put DISCORD_BOT_TOKEN`, run in `apps/relay`) so I run it and type the value into wrangler’s prompt myself. If I paste a secret into this chat anyway, pass it only on standard input and never repeat it back.',
  setupCode:
    '`SETUP_CODE` pairs Zomfy with the relay: have me make one with `openssl rand -hex 16`, set it with `npx wrangler secret put SETUP_CODE`, and keep it for pairing.',
  featuresVar: (value) =>
    `Set \`FEATURES\` to \`${value}\` with \`npx wrangler secret put FEATURES\`, so later deploys keep it. It is not a secret: you may run this one yourself, with the value on standard input.`,
  perFeature: 'For each feature:',
  feature: {
    phone: 'Phone app: nothing more in Cloudflare.',
    discord:
      'Discord: `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_BOT_TOKEN`, from an application I make at discord.com/developers. Follow the README’s "Discord" section: the Interactions Endpoint URL `<Worker URL>/discord/interactions`, Message Content Intent, and adding the app to my server.',
    slack:
      'Slack: `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`, from the app I make from `apps/relay/slack-manifest.yaml` with the Worker URL in it. Follow the README’s "Slack" section.',
    github:
      'GitHub: `bun run deploy --github` in `apps/relay` makes the GitHub App and sets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` and `GITHUB_APP_SLUG`; I run it myself, since it opens the browser. Follow the README’s "GitHub" section.',
    linear:
      'Linear: `LINEAR_WEBHOOK_SECRET` from a webhook to `<Worker URL>/linear/webhook` (Issues, Comments, Issue labels), and either `LINEAR_ACCESS_TOKEN` (a personal API key) or `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` (an OAuth app with Client credentials). Follow the README’s "Linear" section.',
    webhooks: 'Webhooks: nothing in Cloudflare; each webhook trigger on a bot gets its own URL in Zomfy.'
  },
  featureName: { phone: 'Phone app', discord: 'Discord', slack: 'Slack', github: 'GitHub', linear: 'Linear', webhooks: 'Webhooks' },
  health:
    'Check `<Worker URL>/health`: `features` should list exactly the chosen features and `missing` should be empty. Tell me what is still missing, by secret name.',
  pair: 'Finally, tell me to pair Zomfy in Settings → Zomfy Relay with the Worker URL and the setup code, and what each source still needs from me (the URLs to paste).',
  pairPhone: 'Then, for the phone, Settings → Devices → Pair a phone.',
  limits:
    'Do not change anything else in my Cloudflare account, do not delete or rename other Workers, and stop and ask me when something is unclear.'
}

/** The ready-made prompt for the chosen features, place and language. */
export function buildRelaySetupPrompt(input: RelaySetupPromptInput): string {
  const text = input.language === 'ja' ? RELAY_PROMPT_JA : RELAY_PROMPT_EN
  const features = relayFeatureList(input.features)
  const names = features.map((f) => text.featureName[f]).join(input.language === 'ja' ? '、' : ', ')
  const head = [text.intro(names), input.place === 'checkout' ? text.checkout : text.clone(ZOMFY_REPO)]
  if (input.relayUrl) head.push(text.existing(input.relayUrl))
  const steps = [
    text.announce,
    text.deploy,
    ...(input.cloudflareMcp ? [text.mcp] : []),
    text.secrets,
    text.setupCode,
    text.featuresVar(featuresValue(features)),
    [text.perFeature, ...features.map((f) => `   - ${text.feature[f]}`)].join('\n'),
    text.health,
    features.includes('phone') ? `${text.pair} ${text.pairPhone}` : text.pair
  ]
  return [head.join(' '), text.readFirst, steps.map((step, i) => `${i + 1}. ${step}`).join('\n'), text.limits].join('\n\n')
}
