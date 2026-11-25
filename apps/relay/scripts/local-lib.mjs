// Helpers of `bun run relay:local` (scripts/local.mjs), kept apart so test/local/ can check them
// without starting anything (docs/specs/bots/self-host.md). Plain Node.

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { connect, createServer as createNetServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_PORT = 8787
export const TUNNELS = ['cloudflared', 'tailscale', 'none']

/** The relay home: `ZOMFY_RELAY_HOME`, or `~/.zomfy/relay`. */
export function relayHome(env = process.env) {
  return env.ZOMFY_RELAY_HOME || join(homedir(), '.zomfy', 'relay')
}

export function homePaths(dir) {
  return {
    dir,
    envFile: join(dir, 'relay.env'),
    stateDir: join(dir, 'state'),
    settings: join(dir, 'local.json'),
    tokenFile: join(dir, 'cloudflared.token')
  }
}

/** Command-line flags; unknown flags throw so a typo is not silently ignored. */
export function parseArgs(argv) {
  const args = { json: false, dryRun: false, newSetupCode: false, help: false }
  const value = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const [name, inline] = flag.includes('=') ? [flag.slice(0, flag.indexOf('=')), flag.slice(flag.indexOf('=') + 1)] : [flag, undefined]
    const take = () => {
      if (inline !== undefined) return inline
      const v = value(i, name)
      i++
      return v
    }
    switch (name) {
      case '--dir':
        args.dir = take()
        break
      case '--port': {
        const port = Number(take())
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be a port number')
        args.port = port
        break
      }
      case '--tunnel': {
        const tunnel = take()
        if (!TUNNELS.includes(tunnel)) throw new Error(`--tunnel must be one of ${TUNNELS.join(', ')}`)
        args.tunnel = tunnel
        break
      }
      case '--tunnel-token':
        args.tunnelToken = take()
        break
      case '--public-url':
        args.publicUrl = normalizeUrl(take())
        break
      case '--cloudflared':
        args.cloudflared = take()
        break
      case '--tailscale':
        args.tailscale = take()
        break
      case '--new-setup-code':
        args.newSetupCode = true
        break
      case '--json':
        args.json = true
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`Unknown option ${flag} (see --help)`)
    }
  }
  return args
}

/** An http(s) origin without a trailing slash; throws on anything else. */
export function normalizeUrl(text) {
  let url
  try {
    url = new URL(text.trim())
  } catch {
    throw new Error(`Not a URL: ${text}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Not an http(s) URL: ${text}`)
  return url.origin
}

/**
 * What this run uses: flags win over the remembered `local.json`, which wins over the defaults.
 * The tunnel defaults to cloudflared when it is installed, else none. `publicUrl` is remembered
 * only for named tunnels and `none`; a quick tunnel's URL is new on every start.
 */
export function resolveOptions(args, saved = {}, { hasCloudflared = false } = {}) {
  const tunnel = args.tunnel ?? (args.tunnelToken ? 'cloudflared' : undefined) ?? saved.tunnel ?? (hasCloudflared ? 'cloudflared' : 'none')
  const tunnelChanged = tunnel !== saved.tunnel
  const publicUrl = args.publicUrl ?? (tunnelChanged ? undefined : saved.publicUrl)
  const named = tunnel === 'cloudflared' && Boolean(args.tunnelToken || saved.named)
  if (named && !publicUrl) throw new Error('A named tunnel needs --public-url: the hostname you gave it in the Cloudflare dashboard.')
  return {
    port: args.port ?? saved.port ?? DEFAULT_PORT,
    tunnel,
    named,
    ...(publicUrl && (tunnel !== 'cloudflared' || named) ? { publicUrl } : {})
  }
}

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writePrivate(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows: the file is in the person's profile
  }
}

export function saveSettings(path, options) {
  const { port, tunnel, named, publicUrl } = options
  writePrivate(path, `${JSON.stringify({ port, tunnel, named, ...(publicUrl ? { publicUrl } : {}) }, null, 2)}\n`)
}

export function newSetupCode() {
  return randomBytes(16).toString('hex')
}

/** `KEY=value` lines; `#` comments and blank lines skipped. */
export function parseEnv(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    values[m[1]] = v
  }
  return values
}

/**
 * Makes `relay.env` from `.dev.vars.example` with a new SETUP_CODE the first time; with
 * `renew`, puts a new SETUP_CODE in the existing file. Every other line is kept as it is.
 */
export function ensureEnvFile(envFile, examplePath, { renew = false, makeCode = newSetupCode } = {}) {
  const created = !existsSync(envFile)
  let text = created ? readFileSync(examplePath, 'utf8') : readFileSync(envFile, 'utf8')
  const current = parseEnv(text).SETUP_CODE ?? ''
  let renewed = false
  if (created || renew || !current) {
    const code = makeCode()
    text = /^\s*SETUP_CODE\s*=.*$/m.test(text) ? text.replace(/^\s*SETUP_CODE\s*=.*$/m, `SETUP_CODE=${code}`) : `SETUP_CODE=${code}\n${text}`
    renewed = !created
  }
  if (created || renewed || !current) writePrivate(envFile, text)
  return { created, renewed, setupCode: parseEnv(text).SETUP_CODE, values: parseEnv(text) }
}

/** The quick tunnel's URL in cloudflared's log, or null. */
export function quickTunnelUrl(text) {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text)
  return m ? m[0].toLowerCase() : null
}

/** This machine's Funnel URL from `tailscale status --json`, or null. */
export function funnelUrl(status) {
  const name = status?.Self?.DNSName
  return typeof name === 'string' && name ? `https://${name.replace(/\.$/, '')}` : null
}

/** Arguments of `wrangler dev` for the local relay. */
export function wranglerArgs({ port, stateDir, envFile, publicUrl }) {
  return [
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--persist-to',
    stateDir,
    '--env-file',
    envFile,
    '--show-interactive-dev-session=false',
    '--log-level',
    'info',
    ...(publicUrl ? ['--var', `PUBLIC_URL:${publicUrl}`] : [])
  ]
}

/** Environment of wrangler: no Local Explorer (it would serve the objects' storage), no telemetry. */
export function wranglerEnv(base = process.env) {
  return { ...base, X_LOCAL_EXPLORER: 'false', X_LOCAL_OBSERVABILITY: 'false', WRANGLER_SEND_METRICS: 'false' }
}

/** Arguments of cloudflared: a named tunnel takes its token from TUNNEL_TOKEN, never argv. */
export function cloudflaredArgs({ named, port }) {
  return named ? ['tunnel', '--no-autoupdate', 'run'] : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`]
}

/** A command, run with Node when it is a script (tests use fake tools). */
export function command(program, args) {
  return /\.(mjs|cjs|js)$/i.test(program) ? [process.execPath, [program, ...args]] : [program, args]
}

/** Whether `program --version` runs. */
export function hasProgram(program) {
  const [cmd, args] = command(program, ['--version'])
  try {
    return spawnSync(cmd, args, { stdio: 'ignore', timeout: 10_000 }).status === 0
  } catch {
    return false
  }
}

/** A free TCP port on 127.0.0.1. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Whether a request path reaches the dev server's own `/cdn-cgi/` routes; odd paths count too. */
export function isBlockedPath(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/')) return true
  let path = rawUrl.split(/[?#]/)[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    return true
  }
  path = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase()
  return path === '/cdn-cgi' || path.startsWith('/cdn-cgi/')
}

/**
 * The relay's front door on `port`: forwards HTTP and WebSocket upgrades to `target()` (wrangler's
 * internal port) unchanged and answers every `/cdn-cgi/…` path 404. Resolves once listening.
 */
export function startProxy({ port, host = '127.0.0.1', target }) {
  const server = createServer((req, res) => {
    if (isBlockedPath(req.url)) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end('{"error":"not_found"}')
      return
    }
    const to = target()
    if (!to) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5' })
      res.end('{"error":"starting"}')
      return
    }
    const up = httpRequest({ host: '127.0.0.1', port: to, method: req.method, path: req.url, headers: req.headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(res.headersSent ? undefined : '{"error":"relay_unavailable"}')
    })
    req.pipe(up)
  })
  server.on('upgrade', (req, socket, head) => {
    const to = target()
    if (isBlockedPath(req.url) || !to) {
      socket.end(`HTTP/1.1 ${to ? '404 Not Found' : '503 Service Unavailable'}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
      return
    }
    const upstream = connect(to, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head?.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    const close = () => {
      socket.destroy()
      upstream.destroy()
    }
    upstream.on('error', close)
    socket.on('error', close)
    upstream.on('close', close)
    socket.on('close', close)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve(server))
  })
}

/** Starts a child in its own process group (POSIX) so its whole tree can be stopped. */
export function spawnTree(program, args, options = {}) {
  const [cmd, argv] = command(program, args)
  return spawn(cmd, argv, { ...options, detached: process.platform !== 'win32', windowsHide: true })
}

/** Stops a child started by spawnTree and everything it started; nothing else. */
export function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
  }, 5000).unref()
}

/** The delay before restarting a child that exited: 1 s, doubling to 30 s. */
export function nextBackoff(previousMs) {
  return previousMs ? Math.min(previousMs * 2, 30_000) : 1000
}
