import { createServer, request } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  cloudflaredArgs,
  ensureEnvFile,
  freePort,
  funnelUrl,
  isBlockedPath,
  nextBackoff,
  parseArgs,
  parseEnv,
  quickTunnelUrl,
  relayHome,
  resolveOptions,
  startProxy,
  wranglerArgs,
  wranglerEnv
} from '../../scripts/local-lib.mjs'

const EXAMPLE = join(import.meta.dirname, '..', '..', '.dev.vars.example')

describe('arguments and remembered settings', () => {
  it('parses flags and refuses unknown ones', () => {
    expect(parseArgs(['--tunnel', 'tailscale', '--port=9000', '--public-url', 'https://relay.example.com/x', '--json'])).toMatchObject({
      tunnel: 'tailscale',
      port: 9000,
      publicUrl: 'https://relay.example.com',
      json: true
    })
    expect(() => parseArgs(['--tunnel', 'ngrok'])).toThrow(/--tunnel/)
    expect(() => parseArgs(['--port', 'x'])).toThrow(/--port/)
    expect(() => parseArgs(['--public-url', 'ftp://x'])).toThrow(/http/)
    expect(() => parseArgs(['--tunel'])).toThrow(/Unknown option/)
  })

  it('uses ZOMFY_RELAY_HOME or ~/.zomfy/relay', () => {
    expect(relayHome({ ZOMFY_RELAY_HOME: '/srv/relay' })).toBe('/srv/relay')
    expect(relayHome({}).replace(/\\/g, '/')).toMatch(/\.zomfy\/relay$/)
  })

  it('lets flags win over local.json and defaults to cloudflared when installed', () => {
    expect(resolveOptions(parseArgs([]), {}, { hasCloudflared: true })).toEqual({ port: 8787, tunnel: 'cloudflared', named: false })
    expect(resolveOptions(parseArgs([]), {}, { hasCloudflared: false })).toEqual({ port: 8787, tunnel: 'none', named: false })
    const saved = { port: 9001, tunnel: 'cloudflared', named: true, publicUrl: 'https://relay.example.com' }
    expect(resolveOptions(parseArgs([]), saved)).toEqual(saved)
    // Another tunnel forgets the old public URL.
    expect(resolveOptions(parseArgs(['--tunnel', 'tailscale']), saved)).toEqual({ port: 9001, tunnel: 'tailscale', named: false })
  })

  it('never remembers a quick tunnel URL, and needs a public URL for a named tunnel', () => {
    expect(resolveOptions(parseArgs(['--public-url', 'https://a.trycloudflare.com']), { tunnel: 'cloudflared' })).toEqual({
      port: 8787,
      tunnel: 'cloudflared',
      named: false
    })
    expect(() => resolveOptions(parseArgs(['--tunnel-token', 'tok']), {})).toThrow(/--public-url/)
  })
})

describe('relay.env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zomfy-relay-env-'))
  const file = join(dir, 'relay.env')

  it('is made once from .dev.vars.example with a random setup code, then kept', () => {
    const first = ensureEnvFile(file, EXAMPLE)
    expect(first.created).toBe(true)
    expect(first.setupCode).toMatch(/^[0-9a-f]{32}$/)
    expect(readFileSync(file, 'utf8')).toContain('DISCORD_BOT_TOKEN=')
    writeFileSync(file, readFileSync(file, 'utf8').replace('SLACK_BOT_TOKEN=', 'SLACK_BOT_TOKEN=xoxb-made-up'))
    const second = ensureEnvFile(file, EXAMPLE)
    expect(second).toMatchObject({ created: false, renewed: false, setupCode: first.setupCode })
    expect(second.values.SLACK_BOT_TOKEN).toBe('xoxb-made-up')
  })

  it('gets a new setup code on request and keeps the rest', () => {
    const before = parseEnv(readFileSync(file, 'utf8'))
    const renewed = ensureEnvFile(file, EXAMPLE, { renew: true })
    expect(renewed.renewed).toBe(true)
    expect(renewed.setupCode).not.toBe(before.SETUP_CODE)
    expect(renewed.values.SLACK_BOT_TOKEN).toBe('xoxb-made-up')
  })
})

describe('tunnels and wrangler', () => {
  it('reads the quick tunnel URL from cloudflared output', () => {
    const log = '2026-11-22T00:00:00Z INF |  https://Calm-River-1234.trycloudflare.com                     |\n'
    expect(quickTunnelUrl(log)).toBe('https://calm-river-1234.trycloudflare.com')
    expect(quickTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull()
  })

  it('reads the Funnel URL from tailscale status', () => {
    expect(funnelUrl({ Self: { DNSName: 'box.tail1234.ts.net.' } })).toBe('https://box.tail1234.ts.net')
    expect(funnelUrl({})).toBeNull()
  })

  it('keeps a named tunnel token off the command line', () => {
    expect(cloudflaredArgs({ named: true, port: 8787 })).toEqual(['tunnel', '--no-autoupdate', 'run'])
    expect(cloudflaredArgs({ named: false, port: 8787 })).toEqual(['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8787'])
  })

  it('runs wrangler locally with storage, the env file and PUBLIC_URL, without the Local Explorer', () => {
    const args = wranglerArgs({ port: 5000, stateDir: '/r/state', envFile: '/r/relay.env', publicUrl: 'https://relay.example.com' })
    expect(args.slice(0, 2)).toEqual(['dev', '--local'])
    expect(args.join(' ')).toContain('--ip 127.0.0.1 --port 5000 --persist-to /r/state --env-file /r/relay.env')
    expect(args.join(' ')).toContain('--var PUBLIC_URL:https://relay.example.com')
    expect(wranglerArgs({ port: 5000, stateDir: 's', envFile: 'e' })).not.toContain('--var')
    expect(wranglerEnv({ PATH: 'x' })).toMatchObject({ PATH: 'x', X_LOCAL_EXPLORER: 'false', WRANGLER_SEND_METRICS: 'false' })
  })

  it('backs off from 1 s to 30 s', () => {
    let ms = 0
    const seen = []
    for (let i = 0; i < 7; i++) seen.push((ms = nextBackoff(ms)))
    expect(seen).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })
})

describe('the proxy', () => {
  it('blocks /cdn-cgi/ however it is written', () => {
    for (const path of ['/cdn-cgi/local/explorer/api', '/CDN-CGI/x', '//cdn-cgi/x', '/%63dn-cgi/x', '/cdn-cgi', '/\\cdn-cgi/x', 'http://x/cdn-cgi/', '/%zz']) {
      expect(isBlockedPath(path), path).toBe(true)
    }
    for (const path of ['/health', '/hooks/wh_x?cdn-cgi/', '/v1/host']) expect(isBlockedPath(path), path).toBe(false)
  })

  const servers = []
  afterAll(() => servers.forEach((s) => s.close()))

  it('forwards requests unchanged and answers /cdn-cgi/ itself', async () => {
    const seen = []
    const upstream = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.host}`)
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('from upstream')
    })
    const upPort = await freePort()
    await new Promise((r) => upstream.listen(upPort, '127.0.0.1', r))
    servers.push(upstream)
    const port = await freePort()
    let target = null
    servers.push(await startProxy({ port, target: () => target }))

    const get = (path, host) =>
      new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path, headers: host ? { Host: host } : {} }, (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => resolve({ status: res.statusCode, body }))
        })
        req.on('error', reject)
        req.end()
      })

    expect((await get('/health')).status).toBe(503)
    target = upPort
    expect(await get('/health?x=1', 'abc.trycloudflare.com')).toEqual({ status: 200, body: 'from upstream' })
    expect(seen).toEqual(['GET /health?x=1 abc.trycloudflare.com'])
    expect((await get('/cdn-cgi/local/explorer/api')).status).toBe(404)
    expect(seen).toHaveLength(1)
  })
})
