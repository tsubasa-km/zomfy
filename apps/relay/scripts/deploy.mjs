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
/** `--github` / `--linear`: go straight to that source's setup. */
const ONLY_GITHUB = process.argv.includes('--github')
const ONLY_LINEAR = process.argv.includes('--linear')
const ONE_SOURCE = ONLY_GITHUB || ONLY_LINEAR

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Opens a URL in the person's browser, best effort. */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // printed anyway
  }
}

/**
 * A browser round trip on this computer: serves `page` at http://127.0.0.1:<port>/ and waits (up to
 * 10 minutes) for the browser to come back to `callbackPath`; `onCallback` gets the query and
 * returns the page to show. Nothing secret passes through the Worker.
 */
async function browserFlow(page, callbackPath, onCallback) {
  const { createServer } = await import('node:http')
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(page(port))
        return
      }
      if (url.pathname !== callbackPath) {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const done = await onCallback(url.searchParams)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><meta charset="utf-8"><title>Zomfy Relay</title><body style="font-family:system-ui;margin:3em">${done}</body>`)
        server.close()
        resolve(undefined)
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(String(error instanceof Error ? error.message : error))
        server.close()
        reject(error)
      }
    })
    let port = 0
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      const local = `http://127.0.0.1:${port}/`
      console.log(`  Open ${local} in your browser if it did not open by itself.`)
      openBrowser(local)
    })
    setTimeout(() => {
      server.close()
      reject(new Error('No answer from the browser within 10 minutes.'))
    }, 10 * 60 * 1000).unref()
  })
}

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
if (!existing.includes('SETUP_CODE') || (!ONE_SOURCE && await yes('\nMake a new setup code (for pairing another computer)?', false))) {
  setupCode = randomBytes(16).toString('hex')
  await putSecret('SETUP_CODE', setupCode)
}

let discordApp = null
const hasDiscord = ['DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN'].every((n) => existing.includes(n))
console.log('\nDiscord: you need an application from https://discord.com/developers/applications (see the README).')
if (!ONE_SOURCE && await yes(hasDiscord ? 'Change the Discord secrets?' : 'Set up Discord now?', !hasDiscord)) {
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
if (!ONE_SOURCE && await yes(hasSlack ? 'Change the Slack secrets?' : 'Set up Slack now?', false)) {
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

// GitHub: your own GitHub App, made from github-app-manifest.json through GitHub's manifest flow.
// The browser comes back to this computer with a code that is exchanged for the app's id, key and
// webhook secret, which go straight to Cloudflare as Worker secrets.
const hasGitHub = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_APP_SLUG'].every((n) => existing.includes(n))
let githubApp = null
console.log('\nGitHub: your own GitHub App, made for you from apps/relay/github-app-manifest.json.')
if (ONLY_GITHUB || (!ONE_SOURCE && await yes(hasGitHub ? 'Make a new GitHub App (replacing the secrets)?' : 'Set up GitHub now?', false))) {
  const name = await ask('  App name, unique on GitHub (Enter for zomfy-bots): ', 'zomfy-bots')
  const org = await ask('  Organization to own it (Enter for your own account): ')
  const manifestFor = (port) =>
    JSON.parse(
      readFileSync(new URL('../github-app-manifest.json', import.meta.url), 'utf8')
        .replaceAll('https://YOUR-WORKER.workers.dev', workerUrl)
        .replaceAll('http://127.0.0.1:PORT', `http://127.0.0.1:${port}`)
    )
  const state = randomBytes(16).toString('hex')
  const target = org ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new` : 'https://github.com/settings/apps/new'
  if (DRY) {
    console.log(`  [dry run] would open a page that posts this manifest to ${target}:`)
    console.log(JSON.stringify({ ...manifestFor(0), name }, null, 2).replace(/^/gm, '    '))
    githubApp = { slug: name, html_url: `https://github.com/apps/${name}` }
  } else {
    console.log('  Your browser opens GitHub with the app filled in; check the name and press Create.')
    await browserFlow(
      (port) => `<!doctype html><meta charset="utf-8"><title>Zomfy Relay → GitHub</title>
<body style="font-family:system-ui;margin:3em"><p>Taking you to GitHub to create the app…</p>
<form id="f" method="post" action="${escapeHtml(`${target}?state=${state}`)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify({ ...manifestFor(port), name }))}">
<button>Create the GitHub App</button></form><script>document.getElementById('f').submit()</script>`,
      '/github/callback',
      async (query) => {
        if (query.get('state') !== state) throw new Error('The answer from GitHub did not match this run; start again.')
        const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(query.get('code') ?? '')}/conversions`, {
          method: 'POST',
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'zomfy-relay-deploy' }
        })
        if (!res.ok) throw new Error(`GitHub refused the app code (${res.status}).`)
        const app = await res.json()
        await putSecret('GITHUB_APP_ID', String(app.id))
        await putSecret('GITHUB_APP_SLUG', app.slug)
        await putSecret('GITHUB_APP_PRIVATE_KEY', app.pem)
        await putSecret('GITHUB_WEBHOOK_SECRET', app.webhook_secret)
        githubApp = app
        return `<p>The app <b>${escapeHtml(app.slug)}</b> is made and its secrets are in Cloudflare.</p><p><a href="${escapeHtml(app.html_url)}/installations/new">Install it on your repositories</a>, then come back to the terminal.</p>`
      }
    ).catch((error) => fail(String(error.message ?? error)))
  }
}

// Linear: your own OAuth app with client credentials (comments come from the app; the Worker gets
// its 30-day token itself), or a personal API key (comments come from you, with the asked-by line).
const hasLinear = existing.includes('LINEAR_WEBHOOK_SECRET') && (existing.includes('LINEAR_ACCESS_TOKEN') || ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'].every((n) => existing.includes(n)))
let linearSet = false
console.log('\nLinear: your own Linear OAuth app, or a personal API key (see the README).')
if (ONLY_LINEAR || (!ONE_SOURCE && (await yes(hasLinear ? 'Change the Linear secrets?' : 'Set up Linear now?', false)))) {
  const how = await ask('  1 = OAuth app (comments from the app, recommended), 2 = personal API key [1]: ', '1')
  if (how === '2') {
    console.log('  Linear → Settings → Security & access → Personal API keys → New key.')
    const key = await ask('  Personal API key (lin_api_…): ')
    if (!/^lin_api_/.test(key)) fail('That does not look like a personal API key (it starts with lin_api_).')
    await putSecret('LINEAR_ACCESS_TOKEN', key)
  } else {
    console.log('  Linear → Settings → API → OAuth applications → New: name "Zomfy", any callback URL')
    console.log(`  (e.g. ${workerUrl}), and turn on "Client credentials". Save, then copy the client id and secret.`)
    const id = await ask('  Client ID: ')
    const secret = await ask('  Client secret: ')
    if (!id || !secret) fail('Both the client id and the client secret are needed.')
    await putSecret('LINEAR_CLIENT_ID', id)
    await putSecret('LINEAR_CLIENT_SECRET', secret)
  }
  console.log(`  Linear → Settings → API → Webhooks → New: URL ${workerUrl}/linear/webhook,`)
  console.log('  resources Issues, Comments and Issue labels. Save, then copy its signing secret.')
  const signing = await ask('  Webhook signing secret: ')
  if (!signing) fail('The webhook signing secret is needed.')
  await putSecret('LINEAR_WEBHOOK_SECRET', signing)
  linearSet = true
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
if (githubApp || hasGitHub) {
  console.log('\nGitHub:')
  if (githubApp) console.log(`  Install the app on the repositories it should hear: ${githubApp.html_url}/installations/new`)
  else console.log('  The app is set up; install it on more repositories from its page (github.com/settings/apps).')
  console.log(`  Ask on an issue or pull request with @${githubApp?.slug ?? '<app-slug>'} <handle> …`)
}
if (linearSet || hasLinear) {
  console.log('\nLinear:')
  console.log(`  Webhook URL: ${workerUrl}/linear/webhook (Issues, Comments, Issue labels)`)
  console.log('  Ask with @Zomfy <handle> … in a comment, or add the label bot:<handle> to an issue.')
}
console.log('\nWebhooks need nothing here: make one in Zomfy (a bot → New trigger → Webhook).')
console.log('\nIn Zomfy: Settings → Bots → Relay: paste the Worker URL and the setup code, then Pair.')
console.log('Then per bot, Who can ask: your own id on each source as owner, and members the same way')
console.log('  (Discord: Developer Mode → Copy User ID; Slack: your profile → ⋯ → Copy member ID; GitHub: your login; Linear: picked from the list).')
