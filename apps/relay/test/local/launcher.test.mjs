import { spawn, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { freePort } from '../../scripts/local-lib.mjs'

// Starts scripts/local.mjs for real (wrangler dev on workerd, 127.0.0.1 only) in a temporary relay
// home. No tunnel reaches the internet: the cloudflared here is a fake that only prints a URL.
const LAUNCHER = join(import.meta.dirname, '..', '..', 'scripts', 'local.mjs')
const running = new Set()

function launch(args) {
  const child = spawn(process.execPath, [LAUNCHER, '--json', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  running.add(child)
  const events = []
  const waiters = []
  let stderr = ''
  child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-4000)))
  createInterface({ input: child.stdout }).on('line', (line) => {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    events.push(event)
    for (const waiter of [...waiters]) {
      if (event.event === waiter.name || event.event === 'error') {
        waiters.splice(waiters.indexOf(waiter), 1)
        if (event.event === 'error') waiter.reject(new Error(`${event.message}\n${stderr}`))
        else waiter.resolve(event)
      }
    }
  })
  const exited = new Promise((resolve) =>
    child.on('exit', (code) => {
      running.delete(child)
      for (const waiter of waiters.splice(0)) waiter.reject(new Error(`launcher exited (${code}) before "${waiter.name}"\n${stderr}`))
      resolve(code)
    })
  )
  return {
    exited,
    next: (name) =>
      new Promise((resolve, reject) => {
        const found = events.find((e) => e.event === name)
        if (found) resolve(found)
        else waiters.push({ name, resolve, reject })
      }),
    stop: () => {
      child.stdin.write('stop\n')
      return exited
    }
  }
}

afterEach(() => {
  for (const child of running) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  }
})

const publicKey = () => generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')

async function register(url, setupCode) {
  const res = await fetch(`${url}/v1/hosts/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupCode, publicKey: publicKey(), name: 'launcher-test' })
  })
  return { status: res.status, body: await res.json() }
}

describe('bun run relay:local', () => {
  it('keeps its storage across restarts and hides /cdn-cgi/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zomfy-relay-home-'))
    const port = await freePort()
    const first = launch(['--dir', dir, '--port', String(port), '--tunnel', 'none'])
    const ready = await first.next('ready')
    expect(ready).toMatchObject({ localUrl: `http://127.0.0.1:${port}`, publicUrl: null, newSetupCode: true, sources: [] })
    expect(ready.setupCode).toMatch(/^[0-9a-f]{32}$/)
    expect(readFileSync(join(dir, 'relay.env'), 'utf8')).toContain(`SETUP_CODE=${ready.setupCode}`)

    const health = await fetch(`${ready.localUrl}/health`)
    expect(await health.json()).toMatchObject({ ok: true, sources: [] })
    expect((await fetch(`${ready.localUrl}/cdn-cgi/local/explorer/api`)).status).toBe(404)
    // Wrangler's own port has no Local Explorer either: the request reaches the Worker, which 404s.
    const explorer = await fetch(`http://127.0.0.1:${ready.internalPort}/cdn-cgi/local/explorer/api/workers/durable_objects/namespaces`)
    expect(explorer.status).toBe(404)
    expect(await explorer.json()).toEqual({ error: 'not_found' })

    const registered = await register(ready.localUrl, ready.setupCode)
    expect(registered.status).toBe(200)
    expect(registered.body.hostId).toMatch(/^h_/)
    expect(await first.stop()).toBe(0)

    const second = launch(['--dir', dir])
    const again = await second.next('ready')
    // The port and tunnel came from local.json; the code is the same and the Hub remembers its use.
    expect(again).toMatchObject({ localUrl: `http://127.0.0.1:${port}`, setupCode: ready.setupCode, newSetupCode: false })
    expect(await register(again.localUrl, ready.setupCode)).toEqual({ status: 403, body: expect.objectContaining({ error: 'setup_code_used' }) })
    expect(await second.stop()).toBe(0)
  })

  it('points a quick tunnel at its proxy and reports the tunnel URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zomfy-relay-home-'))
    const argsFile = join(dir, 'fake-cloudflared-args.json')
    const fake = join(dir, 'fake-cloudflared.mjs')
    writeFileSync(
      fake,
      [
        "import { writeFileSync } from 'node:fs'",
        "if (process.argv[2] === '--version') process.exit(0)",
        `writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify({ args: process.argv.slice(2), token: process.env.TUNNEL_TOKEN ?? null }))`,
        "process.stderr.write('INF Requesting new quick Tunnel on trycloudflare.com...\\nINF |  https://fake-tunnel-for-tests.trycloudflare.com  |\\n')",
        'setInterval(() => {}, 1000)',
        ''
      ].join('\n')
    )
    const port = await freePort()
    const run = launch(['--dir', dir, '--port', String(port), '--tunnel', 'cloudflared', '--cloudflared', fake])
    expect(await run.next('tunnel')).toEqual({ event: 'tunnel', kind: 'cloudflared', publicUrl: 'https://fake-tunnel-for-tests.trycloudflare.com' })
    const ready = await run.next('ready')
    expect(ready.publicUrl).toBe('https://fake-tunnel-for-tests.trycloudflare.com')
    expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual({ args: ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], token: null })
    // A quick tunnel's URL is not remembered.
    expect(JSON.parse(readFileSync(join(dir, 'local.json'), 'utf8'))).toEqual({ port, tunnel: 'cloudflared', named: false })
    expect(await run.stop()).toBe(0)
  })
})
