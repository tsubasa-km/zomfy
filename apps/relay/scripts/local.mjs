#!/usr/bin/env node
// `bun run relay:local` (or `bun run local` in apps/relay): runs Zomfy Relay on this machine, on
// workerd through `wrangler dev --local` with its storage on disk, behind a tunnel you control
// (docs/specs/bots/self-host.md).
//
//   1. uses the relay home ~/.zomfy/relay (--dir, ZOMFY_RELAY_HOME): relay.env, state/, local.json
//   2. makes relay.env with a new SETUP_CODE the first time (or with --new-setup-code)
//   3. starts the tunnel: cloudflared (quick, or named with --tunnel-token), tailscale funnel, or none
//   4. starts a proxy on 127.0.0.1:<port> that hides /cdn-cgi/, and wrangler behind it
//   5. waits for /health, prints the URLs, the setup code and each source's steps
//   6. restarts wrangler or the tunnel when one exits; Ctrl+C (or a "stop" line with --json) stops both
//
// Plain Node, so it runs wherever wrangler does.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cloudflaredArgs,
  command,
  ensureEnvFile,
  freePort,
  funnelUrl,
  hasProgram,
  homePaths,
  killTree,
  nextBackoff,
  parseArgs,
  quickTunnelUrl,
  readJson,
  relayHome,
  resolveOptions,
  saveSettings,
  spawnTree,
  startProxy,
  wranglerArgs,
  wranglerEnv
} from './local-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const RELAY_DIR = join(HERE, '..')

const HELP = `Zomfy Relay on this machine (docs/specs/bots/self-host.md)

  bun run relay:local [-- options]

  --tunnel cloudflared|tailscale|none   how the internet reaches it (remembered; default cloudflared if installed)
  --tunnel-token <token>                a named Cloudflare tunnel's token (stored in the relay home, not shown again)
  --public-url <https://…>              the public URL (a named tunnel's hostname, or your own with --tunnel none)
  --port <n>                            the local port the tunnel points at (default 8787)
  --dir <path>                          the relay home (default ~/.zomfy/relay, or ZOMFY_RELAY_HOME)
  --new-setup-code                      make a new single-use setup code
  --json                                one JSON object per line; a "stop" line on stdin stops it
  --dry-run                             print what would run
  --cloudflared <path>, --tailscale <path>   where those programs are, if not on PATH
`

let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(String(error.message ?? error))
  process.exit(2)
}
if (args.help) {
  console.log(HELP)
  process.exit(0)
}

const JSON_OUT = args.json
const say = (text) => {
  if (!JSON_OUT) console.log(text)
}
const emit = (event, data = {}) => {
  if (JSON_OUT) process.stdout.write(`${JSON.stringify({ event, ...data })}\n`)
}
const fail = (message) => {
  if (JSON_OUT) emit('error', { message })
  else console.error(`\n${message}`)
  shutdown(1)
}

const paths = homePaths(args.dir ?? relayHome())
const cloudflared = args.cloudflared ?? 'cloudflared'
const tailscale = args.tailscale ?? 'tailscale'
const saved = readJson(paths.settings, {})

let options
try {
  options = resolveOptions(args, saved, { hasCloudflared: args.dryRun || hasProgram(cloudflared) })
} catch (error) {
  console.error(String(error.message ?? error))
  process.exit(2)
}

const wranglerBin = (() => {
  try {
    const pkg = createRequire(join(RELAY_DIR, 'package.json')).resolve('wrangler/package.json')
    return join(dirname(pkg), 'bin', 'wrangler.js')
  } catch {
    return null
  }
})()

if (args.dryRun) {
  console.log('[dry run] relay home:', paths.dir)
  console.log(`[dry run] proxy on http://127.0.0.1:${options.port} (hides /cdn-cgi/)`)
  if (options.tunnel === 'cloudflared') console.log(`[dry run] ${cloudflared} ${cloudflaredArgs({ named: options.named, port: options.port }).join(' ')}${options.named ? '   (TUNNEL_TOKEN from cloudflared.token)' : ''}`)
  if (options.tunnel === 'tailscale') console.log(`[dry run] ${tailscale} funnel ${options.port}`)
  console.log(`[dry run] X_LOCAL_EXPLORER=false node wrangler ${wranglerArgs({ port: '<internal port>', stateDir: paths.stateDir, envFile: paths.envFile, publicUrl: options.publicUrl ?? '<tunnel URL>' }).join(' ')}`)
  process.exit(0)
}

if (!wranglerBin) {
  console.error('wrangler is not installed: run `bun install` at the repository root first.')
  process.exit(1)
}

// --- The relay home ---

if (args.tunnelToken) {
  const { writeFileSync, chmodSync } = await import('node:fs')
  writeFileSync(paths.tokenFile, args.tunnelToken.trim(), { mode: 0o600 })
  try {
    chmodSync(paths.tokenFile, 0o600)
  } catch {
    // Windows
  }
}
const env = ensureEnvFile(paths.envFile, join(RELAY_DIR, '.dev.vars.example'), { renew: args.newSetupCode })
saveSettings(paths.settings, options)

// --- Children ---

let stopping = false
let internalPort = null
let publicUrl = options.publicUrl ?? null
let wrangler = null
let tunnel = null
let proxy = null
let wranglerBackoff = 0
let tunnelBackoff = 0
let announced = false

function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  killTree(wrangler)
  killTree(tunnel)
  proxy?.close()
  emit('stopped')
  say('\nZomfy Relay stopped.')
  setTimeout(() => process.exit(code), 300).unref()
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
if (process.platform !== 'win32') process.on('SIGHUP', () => shutdown(0))
if (JSON_OUT) {
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (line.trim() === 'stop') shutdown(0)
  })
}

/** Pipes a child's output to ours (text mode only) and hands each chunk to `onText`. */
function watchOutput(child, onText) {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => {
      const text = String(chunk)
      onText?.(text)
      if (!JSON_OUT) process.stderr.write(text)
    })
  }
}

function startTunnel() {
  return new Promise((resolve) => {
    if (options.tunnel === 'none') return resolve(publicUrl)
    let settled = false
    const done = (url) => {
      if (!settled) {
        settled = true
        resolve(url)
      }
    }
    if (options.tunnel === 'tailscale') {
      let url = options.publicUrl ?? null
      if (!url) {
        try {
          const [cmd, argv] = command(tailscale, ['status', '--json'])
          url = funnelUrl(JSON.parse(execFileSync(cmd, argv, { encoding: 'utf8', timeout: 15_000 })))
        } catch {
          url = null
        }
      }
      if (!url) {
        fail('Tailscale is not running or not signed in (`tailscale status` failed).')
        return done(null)
      }
      tunnel = spawnTree(tailscale, ['funnel', String(options.port)], { stdio: ['ignore', 'pipe', 'pipe'] })
      watchOutput(tunnel)
      done(url)
    } else {
      let tokenEnv = {}
      if (options.named) {
        try {
          tokenEnv = { TUNNEL_TOKEN: readFileSync(paths.tokenFile, 'utf8').trim() }
        } catch {
          fail(`No tunnel token in ${paths.tokenFile}: pass --tunnel-token once.`)
          return done(null)
        }
      }
      tunnel = spawnTree(cloudflared, cloudflaredArgs({ named: options.named, port: options.port }), {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...tokenEnv }
      })
      if (options.named) done(publicUrl)
      else {
        let log = ''
        watchOutput(tunnel, (text) => {
          log = (log + text).slice(-8192)
          const url = quickTunnelUrl(log)
          if (url) done(url)
        })
        setTimeout(() => done(null), 60_000).unref()
      }
      if (options.named) watchOutput(tunnel)
    }
    const started = Date.now()
    tunnel.on('error', (error) => fail(`Could not start ${options.tunnel}: ${error.message}`))
    tunnel.on('exit', (code) => {
      done(null)
      if (stopping) return
      tunnelBackoff = Date.now() - started > 60_000 ? 0 : nextBackoff(tunnelBackoff)
      emit('restart', { what: 'tunnel', code, inMs: tunnelBackoff })
      say(`\nThe ${options.tunnel} tunnel exited (${code}); starting it again in ${tunnelBackoff / 1000} s.`)
      setTimeout(async () => {
        if (stopping) return
        const url = await startTunnel()
        if (url && url !== publicUrl) {
          publicUrl = url
          emit('tunnel', { kind: options.tunnel, publicUrl })
          say(`\nNew public URL: ${publicUrl}\nUpdate it in each source and pair Zomfy again (Settings → Zomfy Relay).`)
          killTree(wrangler) // starts again with the new PUBLIC_URL
        }
      }, tunnelBackoff)
    })
  })
}

async function startWrangler() {
  internalPort = null
  const port = await freePort()
  wrangler = spawnTree(process.execPath, [wranglerBin, ...wranglerArgs({ port, stateDir: paths.stateDir, envFile: paths.envFile, publicUrl })], {
    cwd: RELAY_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: wranglerEnv()
  })
  const child = wrangler
  watchOutput(child)
  const started = Date.now()
  child.on('exit', (code) => {
    if (wrangler === child) internalPort = null
    if (stopping) return
    wranglerBackoff = Date.now() - started > 60_000 ? 0 : nextBackoff(wranglerBackoff)
    emit('restart', { what: 'wrangler', code, inMs: wranglerBackoff })
    say(`\nwrangler exited (${code}); starting it again in ${wranglerBackoff / 1000} s.`)
    setTimeout(() => {
      if (!stopping) void startWrangler().then(waitForHealth)
    }, wranglerBackoff)
  })
  return port
}

async function waitForHealth(port) {
  const deadline = Date.now() + 120_000
  while (!stopping && Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) {
        internalPort = port
        const health = await res.json()
        if (!announced) announce(health)
        else emit('ready', readyData(health))
        announced = true
        return health
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!stopping) fail('The relay did not answer /health within 2 minutes; see the output above.')
  return null
}

function readyData(health) {
  return {
    localUrl: `http://127.0.0.1:${options.port}`,
    publicUrl,
    internalPort,
    setupCode: env.setupCode,
    newSetupCode: env.created || env.renewed,
    sources: health.sources ?? [],
    discordGateway: health.discordGateway?.state ?? null,
    envFile: paths.envFile,
    stateDir: paths.stateDir
  }
}

function announce(health) {
  const data = readyData(health)
  emit('ready', data)
  if (JSON_OUT) return
  const url = publicUrl ?? `http://127.0.0.1:${options.port}`
  const sources = data.sources
  console.log('\n──────── Zomfy Relay is running on this machine ────────')
  console.log(`Local URL:    ${data.localUrl}`)
  console.log(`Public URL:   ${publicUrl ?? 'none (no tunnel: only this machine can reach it)'}`)
  console.log(`Setup code:   ${data.setupCode}   (single use${data.newSetupCode ? ', new' : ''}; keep it until Zomfy has paired)`)
  console.log(`Secrets:      ${paths.envFile}   (edit, then restart this)`)
  console.log(`Storage:      ${paths.stateDir}`)
  console.log(`Sources:      ${sources.join(', ') || 'none yet'}${data.discordGateway ? `  (Discord Gateway: ${data.discordGateway})` : ''}`)
  if (options.tunnel === 'cloudflared' && !options.named) {
    console.log('\nThis is a quick tunnel: its URL changes every start. For daily use, make a named tunnel')
    console.log('(README, "Run it on your own machine") or use --tunnel tailscale.')
  }
  if (sources.includes('discord')) console.log(`\nDiscord → General Information → Interactions Endpoint URL: ${url}/discord/interactions`)
  if (sources.includes('slack')) {
    console.log(`\nSlack → Event Subscriptions → Request URL: ${url}/slack/events`)
    console.log(`Slack → Interactivity & Shortcuts → Request URL: ${url}/slack/interactivity`)
    console.log(`(Make the app from slack-manifest.yaml with ${url} in place of https://YOUR-WORKER.workers.dev.)`)
  }
  if (sources.includes('github')) console.log(`\nGitHub → your app → Webhook URL: ${url}/github/webhook`)
  if (sources.includes('linear')) console.log(`\nLinear → Settings → API → Webhooks: ${url}/linear/webhook (Issues, Comments, Issue labels)`)
  console.log(`\nIn Zomfy: Settings → Zomfy Relay: paste ${url} and the setup code, then Pair.`)
  console.log('Keep this running (Ctrl+C stops it). The relay is off whenever this machine is.')
}

// --- Start ---

say(`Zomfy Relay: starting on this machine (home ${paths.dir})`)
if (env.created) say(`Made ${paths.envFile} with a new setup code; put the secrets of the sources you want in it.`)

try {
  proxy = await startProxy({ port: options.port, target: () => internalPort })
} catch (error) {
  fail(`Port ${options.port} is in use (${error.code ?? error.message}); pass --port.`)
}

if (options.tunnel !== 'none') {
  say(`Starting the ${options.tunnel} tunnel…`)
  const url = await startTunnel()
  if (!url) fail(`The ${options.tunnel} tunnel gave no public URL; see its output above.`)
  publicUrl = url
  emit('tunnel', { kind: options.tunnel, publicUrl })
}

say('Starting the relay (wrangler dev on workerd)…')
await waitForHealth(await startWrangler())
