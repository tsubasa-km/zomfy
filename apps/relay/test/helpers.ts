import { env, SELF } from 'cloudflare:test'
import { bytesToBase64, CONTRACT_VERSION, inviteSigningText, linkSigningText, type HelloBot } from '../src/contract'
import { fixtureBot } from '../src/contract/fixtures'
import type { Env } from '../src/env'

export const testEnv = env as unknown as Env
export const SETUP_CODE = 'marker-setup-code-7f3a'
export const BASE = 'https://relay.test'

export function hubStub() {
  return testEnv.HUB.get(testEnv.HUB.idFromName('hub'))
}

export interface HostKey {
  publicKey: string
  sign(text: string): Promise<string>
}

export async function newHostKey(): Promise<HostKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer
  return {
    publicKey: bytesToBase64(new Uint8Array(raw)),
    async sign(text) {
      const sig = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(text))
      return bytesToBase64(new Uint8Array(sig))
    }
  }
}

export async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export async function registerHost(key?: HostKey, name = 'Desk'): Promise<{ hostId: string; key: HostKey }> {
  const k = key ?? (await newHostKey())
  const res = await post('/v1/hosts/register', { setupCode: SETUP_CODE, publicKey: k.publicKey, name })
  if (res.status !== 200) throw new Error(`register failed ${res.status} ${await res.text()}`)
  const { hostId } = (await res.json()) as { hostId: string }
  return { hostId, key: k }
}

export async function mintInvite(hostId: string, key: HostKey, at = Date.now()): Promise<Response> {
  return post('/v1/hosts/invite', { hostId, at, signature: await key.sign(inviteSigningText(hostId, at)) })
}

/** A test-side daemon socket that records every frame and the close. */
export class Link {
  readonly frames: any[] = []
  closed: { code: number; reason: string } | null = null
  private waiters: Array<() => void> = []

  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.frames.push(JSON.parse(event.data as string))
      this.wake()
    })
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason }
      this.wake()
    })
    ws.accept()
  }

  private wake() {
    for (const waiter of this.waiters.splice(0)) waiter()
  }

  send(message: unknown) {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message))
  }

  /** The next not-yet-taken frame that matches, waiting up to `ms`. */
  async take(match: (frame: any) => boolean, ms = 2000): Promise<any> {
    const deadline = Date.now() + ms
    for (;;) {
      const index = this.frames.findIndex(match)
      if (index >= 0) return this.frames.splice(index, 1)[0]
      if (this.closed) throw new Error(`closed ${this.closed.code} ${this.closed.reason} before a matching frame`)
      if (Date.now() > deadline) throw new Error(`no matching frame; got ${JSON.stringify(this.frames)}`)
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }

  async type(type: string, ms?: number) {
    return this.take((f) => f.type === type, ms)
  }

  async waitClosed(ms = 2000) {
    const deadline = Date.now() + ms
    while (!this.closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    return this.closed
  }

  /** Lets in-flight frames arrive, then returns how many are queued. */
  async settle(ms = 150): Promise<number> {
    await new Promise((r) => setTimeout(r, ms))
    return this.frames.length
  }

  close() {
    try {
      this.ws.close(1000, 'test done')
    } catch {
      // already closed
    }
  }
}

export async function openLink(hostId: string): Promise<Link> {
  const res = await SELF.fetch(`${BASE}/v1/host?hostId=${encodeURIComponent(hostId)}`, { headers: { Upgrade: 'websocket' } })
  if (!res.webSocket) throw new Error(`no websocket: ${res.status}`)
  return new Link(res.webSocket)
}

/** Connects and proves the key; returns the link after `auth-ok`. */
export async function connect(hostId: string, key: HostKey): Promise<Link> {
  const link = await openLink(hostId)
  const challenge = await link.type('challenge')
  link.send({ ch: 'link', type: 'auth', signature: await key.sign(linkSigningText(hostId, challenge.nonce)) })
  await link.type('auth-ok')
  return link
}

export function hello(hostId: string, bots: HelloBot[] = [fixtureBot], extra: Record<string, unknown> = {}) {
  return {
    ch: 'bots',
    type: 'hello',
    contract: CONTRACT_VERSION,
    host: { id: hostId, name: 'Desk', kind: 'desktop' },
    features: ['events-seq', 'hello-bots-pages'],
    sources: ['discord'],
    promptKinds: ['approval'],
    bots,
    rules: [],
    ...extra
  }
}

/** Connects, says hello, and returns the link and its `helloRev`. */
export async function connectAndHello(hostId: string, key: HostKey, bots?: HelloBot[]) {
  const link = await connect(hostId, key)
  link.send(hello(hostId, bots))
  const ok = await link.type('hello-ok')
  return { link, helloRev: ok.helloRev as number, unsettled: ok.unsettled as string[] }
}
