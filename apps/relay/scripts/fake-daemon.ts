// A fake daemon for checking a running relay by hand: registers a throwaway host key with the setup
// code, connects to /v1/host, proves the key, says hello with one bot, and prints what comes back.
//
//   bun scripts/fake-daemon.ts http://127.0.0.1:8787 <setup-code>
//
// Use it against `wrangler dev` (with a .dev.vars holding a made-up SETUP_CODE), never with a real
// deployment's code: the host it registers stays registered.

import { generateKeyPairSync, sign } from 'node:crypto'
import { bytesToBase64, CONTRACT_VERSION, linkSigningText, parseToHost } from '../src/contract'
import { fixtureBot } from '../src/contract/fixtures'

const [relayUrl = 'http://127.0.0.1:8787', setupCode] = process.argv.slice(2)
if (!setupCode) {
  console.error('usage: bun scripts/fake-daemon.ts <relay-url> <setup-code>')
  process.exit(2)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)

const health = await fetch(`${relayUrl}/health`)
console.log('health', health.status, await health.text())

const res = await fetch(`${relayUrl}/v1/hosts/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ setupCode, publicKey: bytesToBase64(rawPublic), name: 'fake-daemon' })
})
const registered = (await res.json()) as { hostId?: string; error?: string }
console.log('register', res.status, registered)
if (!registered.hostId) process.exit(1)
const hostId = registered.hostId

const ws = new WebSocket(`${relayUrl.replace(/^http/, 'ws')}/v1/host?hostId=${hostId}`)
const done = new Promise<number>((resolve) => {
  ws.onmessage = (event) => {
    const parsed = parseToHost(String(event.data))
    console.log('<-', String(event.data))
    if (parsed.kind !== 'message') return
    const msg = parsed.message
    if (msg.type === 'challenge') {
      const signature = bytesToBase64(sign(null, Buffer.from(linkSigningText(hostId, msg.nonce)), privateKey))
      ws.send(JSON.stringify({ ch: 'link', type: 'auth', signature }))
    } else if (msg.type === 'auth-ok') {
      ws.send(
        JSON.stringify({
          ch: 'bots',
          type: 'hello',
          contract: CONTRACT_VERSION,
          host: { id: hostId, name: 'fake-daemon', kind: 'serve' },
          features: ['events-seq'],
          sources: [],
          promptKinds: [],
          bots: [fixtureBot],
          rules: []
        })
      )
    } else if (msg.type === 'hello-ok') {
      console.log(`hello-ok: helloRev ${msg.helloRev}, unsettled ${JSON.stringify(msg.unsettled)}`)
      ws.close(1000, 'done')
      resolve(0)
    }
  }
  ws.onclose = (event) => resolve(event.code === 1000 ? 0 : 1)
})
process.exit(await done)
