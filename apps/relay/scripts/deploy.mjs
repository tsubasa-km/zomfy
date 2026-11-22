#!/usr/bin/env node
// `bun run deploy` (or `npm run deploy`) in apps/relay: deploys Zomfy Relay to your own Cloudflare
// account and prints what to paste where (docs/specs/bots/connector.md#deploy).
//
//   1. checks `wrangler whoami`
//   2. runs `wrangler deploy`
//   3. sets a new SETUP_CODE (on the first deploy, or when you ask)
//   4. asks for the secrets of each source you want (Discord, Slack, …), skipping the rest
//   5. prints the Worker URL, the setup code, and the URLs and steps for each source
//
// Under Workers Builds (the Deploy to Cloudflare button) it only runs `wrangler deploy`: the
// button asks for the secrets itself. `--dry-run` prints the commands instead of running them.
// Plain Node, so it runs wherever wrangler does.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const DRY = process.argv.includes('--dry-run')
const CI = Boolean(process.env.WORKERS_CI || process.env.CI) || process.argv.includes('--ci')

// The same bits as BOT_PERMISSIONS in src/discord/api.ts.
const PERMISSIONS =
  (1n << 10n) | (1n << 11n) | (1n << 38n) | (1n << 35n) | (1n << 16n) | (1n << 6n) | (1n << 14n) | (1n << 15n)

/** Runs wrangler, echoing its output, and returns what it printed. */
function wrangler(args, { input, quiet = false } = {}) {
  if (DRY) {
    console.log(`  [dry run] wrangler ${args.join(' ')}${input !== undefined ? ' < (value)' : ''}`)
    const fake = args[0] === 'deploy' ? 'https://zomfy-relay.example.workers.dev' : args[0] === 'secret' && args[1] === 'list' ? '[]' : ''
    return Promise.resolve({ code: 0, out: fake })
  }
  return new Promise((resolve) => {
    const child = spawn('npx', ['wrangler', ...args], { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
      if (!quiet) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      out += chunk
      if (!quiet) process.stderr.write(chunk)
    })
    if (input !== undefined) child.stdin.write(input)
    child.stdin.end()
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

if (CI) {
  const { code } = await wrangler(['deploy'])
  process.exit(code)
}

// Lines are queued as they come, so answers piped in ahead of the questions are not lost.
const rl = createInterface({ input: process.stdin })
const lines = []
const waiting = []
let ended = false
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)))
rl.on('close', () => {
  ended = true
  for (const resolve of waiting.splice(0)) resolve('')
})
const ask = async (question, fallback = '') => {
  process.stdout.write(question)
  const line = lines.length ? lines.shift() : ended ? '' : await new Promise((resolve) => waiting.push(resolve))
  if (!process.stdin.isTTY) process.stdout.write('\n')
  return line.trim() || fallback
}
const yes = async (question, fallback) => {
  const answer = (await ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).toLowerCase()
  return answer ? answer.startsWith('y') : fallback
}
const fail = (message) => {
  console.error(`\n${message}`)
  rl.close()
  process.exit(1)
}

console.log('Zomfy Relay: deploying to your Cloudflare account\n')

const who = await wrangler(['whoami'], { quiet: true })
if (who.code !== 0 || /not authenticated|You are not logged in/i.test(who.out)) {
  fail('Wrangler is not signed in. Run `npx wrangler login`, then `bun run deploy` again.')
}

console.log('Running wrangler deploy…')
const deployed = await wrangler(['deploy'])
if (deployed.code !== 0) fail('wrangler deploy failed; see above.')
const workerUrl = (/https:\/\/[^\s]+\.workers\.dev/.exec(deployed.out) ?? [])[0]?.replace(/\/$/, '') ?? (await ask('\nWorker URL (as wrangler printed it): '))
if (!workerUrl) fail('No Worker URL.')

const listed = await wrangler(['secret', 'list', '--format', 'json'], { quiet: true })
let existing = []
try {
  existing = JSON.parse(listed.out.slice(listed.out.indexOf('['))).map((s) => s.name)
} catch {
  existing = []
}
const putSecret = async (name, value) => {
  const { code } = await wrangler(['secret', 'put', name], { input: value, quiet: true })
  if (code !== 0) fail(`Setting ${name} failed. Run \`npx wrangler secret put ${name}\` yourself.`)
  console.log(`  ${name} set`)
}

let setupCode = null
if (!existing.includes('SETUP_CODE') || (await yes('\nMake a new setup code (for pairing another computer)?', false))) {
  setupCode = randomBytes(16).toString('hex')
  await putSecret('SETUP_CODE', setupCode)
}

let discordApp = null
const hasDiscord = ['DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN'].every((n) => existing.includes(n))
console.log('\nDiscord: you need an application from https://discord.com/developers/applications (see the README).')
if (await yes(hasDiscord ? 'Change the Discord secrets?' : 'Set up Discord now?', !hasDiscord)) {
  discordApp = await ask('  Application ID: ')
  if (!/^\d{5,25}$/.test(discordApp)) fail('That does not look like an Application ID (digits only).')
  const publicKey = await ask('  Public Key: ')
  if (!/^[0-9a-f]{64}$/i.test(publicKey)) fail('That does not look like a Public Key (64 hex characters).')
  const token = await ask('  Bot token (Bot → Reset Token; it is sent straight to Cloudflare): ')
  if (token.length < 50) fail('That does not look like a bot token.')
  await putSecret('DISCORD_APPLICATION_ID', discordApp)
  await putSecret('DISCORD_PUBLIC_KEY', publicKey.toLowerCase())
  await putSecret('DISCORD_BOT_TOKEN', token)
}

// Slack: one app per deployment, made from slack-manifest.yaml with this Worker's URL in it.
const slackManifest = readFileSync(new URL('../slack-manifest.yaml', import.meta.url), 'utf8').replaceAll('https://YOUR-WORKER.workers.dev', workerUrl)
const hasSlack = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'].every((n) => existing.includes(n))
let slackSet = false
console.log('\nSlack: an app made from apps/relay/slack-manifest.yaml (see the README).')
if (await yes(hasSlack ? 'Change the Slack secrets?' : 'Set up Slack now?', false)) {
  console.log('\n  1. https://api.slack.com/apps → Create New App → From a manifest → pick the workspace → paste:\n')
  console.log(slackManifest.replace(/^/gm, '     '))
  console.log('  2. Create, then Install to Workspace (an admin may have to approve).')
  const token = await ask('  Bot User OAuth Token (OAuth & Permissions, xoxb-…): ')
  if (!/^xoxb-/.test(token)) fail('That does not look like a bot token (it starts with xoxb-).')
  const signing = await ask('  Signing Secret (Basic Information → App Credentials): ')
  if (!/^[0-9a-f]{32}$/i.test(signing)) fail('That does not look like a signing secret (32 hex characters).')
  await putSecret('SLACK_BOT_TOKEN', token)
  await putSecret('SLACK_SIGNING_SECRET', signing)
  slackSet = true
}
rl.close()

// Secrets apply to new requests at once; /health also starts the Discord Gateway.
let health = null
if (!DRY) {
  for (let i = 0; i < 10 && !health; i++) {
    try {
      const res = await fetch(`${workerUrl}/health`)
      if (res.ok) health = await res.json()
    } catch {
      // not up yet
    }
    if (!health) await new Promise((r) => setTimeout(r, 1500))
  }
}

console.log('\n──────── Zomfy Relay is deployed ────────')
console.log(`Worker URL:   ${workerUrl}`)
console.log(setupCode ? `Setup code:   ${setupCode}   (single use; keep it until Zomfy has paired)` : 'Setup code:   unchanged (run again and answer "y" for a new one)')
if (health) console.log(`Sources:      ${health.sources.join(', ') || 'none yet'}${health.discordGateway ? `  (Discord Gateway: ${health.discordGateway.state})` : ''}`)
if (discordApp || hasDiscord) {
  console.log('\nDiscord, in the Developer Portal:')
  console.log(`  1. General Information → Interactions Endpoint URL: ${workerUrl}/discord/interactions  → Save`)
  console.log('  2. Bot → turn on "Message Content Intent" → Save')
  if (discordApp) {
    console.log(`  3. Add the app to your server: https://discord.com/oauth2/authorize?client_id=${discordApp}&scope=bot%20applications.commands&permissions=${PERMISSIONS}`)
  } else {
    console.log('  3. OAuth2 → URL Generator: scopes bot + applications.commands, and the permissions in the README; open the link')
  }
}
if (slackSet || hasSlack) {
  console.log('\nSlack, at api.slack.com/apps → your app:')
  console.log(`  Event Subscriptions → Request URL: ${workerUrl}/slack/events  (press Retry if it was checked before the secrets were set)`)
  console.log(`  Interactivity & Shortcuts → Request URL: ${workerUrl}/slack/interactivity`)
  console.log('  Invite the app to each channel it should hear (/invite @Zomfy).')
}
console.log('\nIn Zomfy: Settings → Bots → Relay: paste the Worker URL and the setup code, then Pair.')
console.log('Then per bot, Who can ask: your own id on each source as owner, and members the same way')
console.log('  (Discord: Developer Mode → Copy User ID; Slack: your profile → ⋯ → Copy member ID).')
