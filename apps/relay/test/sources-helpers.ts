// Shared by the Slack, GitHub, webhook and Linear tests: the fake APIs, a paired host whose hello
// lists the test's bots and rules, and a clean Hub after each test.

import { runInDurableObject } from 'cloudflare:test'
import type { HelloBot } from '../src/contract'
import type { Hub } from '../src/hub'
import { connect, hello, hubStub, type Link, registerHost, testEnv } from './helpers'

export interface ApiCall {
  host: string
  method: string
  path: string
  body: any
  auth: string | null
}

export async function fakeApi(what: 'reset' | 'state' | 'config', body?: unknown): Promise<any> {
  const res = await testEnv.SOURCES_TRANSPORT!.fetch(`https://fake.test/_test/${what}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return res.json()
}

export async function apiCalls(match: (call: ApiCall) => boolean = () => true): Promise<ApiCall[]> {
  return ((await fakeApi('state')).calls as ApiCall[]).filter(match)
}

export async function until<T>(check: () => Promise<T | undefined | null | false>, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value && !(Array.isArray(value) && value.length === 0)) return value
    if (Date.now() > deadline) {
      const calls = await apiCalls()
      throw new Error(`timed out; calls: ${JSON.stringify(calls.map((c) => [c.method, c.path]))}`)
    }
    await new Promise((r) => setTimeout(r, 30))
  }
}

export class Paired {
  seq = 0
  constructor(
    readonly link: Link,
    public helloRev: number,
    readonly hostId: string
  ) {}

  /** Says hello again with these bots and rules (a rule naming a hook minted after the first hello). */
  async rehello(bots: HelloBot[], rules: unknown[]) {
    this.link.send(hello(this.hostId, bots, { rules, sources: ['slack', 'github', 'linear', 'webhook'] }))
    const ok = await this.link.type('hello-ok')
    this.helloRev = ok.helloRev
    this.seq = 0
  }

  deliveries(kind?: string): any[] {
    return this.link.frames
      .filter((f) => f.type === 'delivery')
      .flatMap((f) => f.deliveries)
      .filter((d: any) => !kind || d.kind === kind)
  }

  async next(kind: string, ms?: number): Promise<any> {
    const frame = await this.link.take((f) => f.type === 'delivery' && f.deliveries.some((d: any) => d.kind === kind), ms)
    return frame.deliveries.find((d: any) => d.kind === kind)
  }

  events(events: unknown[]) {
    this.link.send({ ch: 'bots', type: 'events', helloRev: this.helloRev, seq: this.seq++, events })
  }

  async action(verb: string, ref: string | undefined, args: Record<string, unknown> = {}, idempotencyKey?: string): Promise<any> {
    const reqId = `req-${Math.random().toString(36).slice(2)}`
    this.link.send({ ch: 'bots', type: 'action', helloRev: this.helloRev, reqId, verb, ...(ref ? { ref } : {}), args, ...(idempotencyKey ? { idempotencyKey } : {}) })
    return this.link.take((f) => f.type === 'action-result' && f.reqId === reqId, 5000)
  }
}

const open: Link[] = []

export async function pairWith(bots: HelloBot[], rules: unknown[] = [], sources: string[] = ['slack', 'github', 'linear', 'webhook']): Promise<Paired> {
  const { hostId, key } = await registerHost()
  const link = await connect(hostId, key)
  link.send(hello(hostId, bots, { rules, sources }))
  const ok = await link.type('hello-ok')
  open.push(link)
  return new Paired(link, ok.helloRev, hostId)
}

/** Closes links, empties every table and the alarm, and resets the fake APIs. */
export async function cleanHub() {
  for (const l of open.splice(0)) l.close()
  await runInDurableObject(hubStub(), async (_hub: Hub, state) => {
    const sql = state.storage.sql
    for (const { name } of sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").toArray()) {
      sql.exec(`DELETE FROM "${name}"`)
    }
    await state.storage.deleteAlarm()
  })
  await fakeApi('reset')
}

export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
}
