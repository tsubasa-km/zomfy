import { SECRET_PLACEHOLDER_PREFIX } from '@zomfy/protocol'
import type { SecretRedactor } from './secret-redaction.ts'
import { log } from './log.ts'

// The tunnel (docs/specs/agent-secrets.md): a loopback HTTP server that forwards
// `/t/<route token>/<path>` to the secret's bound upstream, swapping the secret's placeholder for
// its value in the request's headers and query on the way out, and redacting the value on the way
// back. The agent's processes hold the placeholder and the route; never the value.

export interface TunnelTarget {
  name: string
  value: string
  upstream: string
}

/** Headers that belong to one connection, not to the request. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
])

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** This secret's placeholder only, not one whose name merely starts the same way. */
function placeholderPattern(name: string, encoded: boolean): RegExp {
  const placeholder = `${SECRET_PLACEHOLDER_PREFIX}${name}`
  const text = encoded ? encodeURIComponent(placeholder) : placeholder
  return new RegExp(`${escapeRegExp(text)}(?![A-Za-z0-9_])`, 'g')
}

export class SecretTunnel {
  private server: ReturnType<typeof Bun.serve> | null = null
  /** Route token → secret id, and back. Tokens are new each time the daemon starts. */
  private readonly routes = new Map<string, string>()
  private readonly tokens = new Map<string, string>()

  constructor(
    private readonly target: (secretId: string) => TunnelTarget | null,
    private readonly redactor: SecretRedactor,
    private readonly fetchUpstream: typeof fetch = fetch
  ) {}

  /** The address a secret's base URL variable points at; starts the server on first use. */
  baseUrl(secretId: string): string {
    const server = this.start()
    let token = this.tokens.get(secretId)
    if (!token) {
      token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
      this.tokens.set(secretId, token)
      this.routes.set(token, secretId)
    }
    return `http://127.0.0.1:${server.port}/t/${token}`
  }

  /** A deleted secret's route closes at once. */
  forget(secretId: string): void {
    const token = this.tokens.get(secretId)
    if (!token) return
    this.tokens.delete(secretId)
    this.routes.delete(token)
  }

  stop(): void {
    void this.server?.stop(true)
    this.server = null
  }

  private start(): ReturnType<typeof Bun.serve> {
    this.server ??= Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      // Streaming answers (server-sent events) can be quiet for a while between chunks.
      idleTimeout: 0,
      fetch: (request) => this.handle(request)
    })
    return this.server
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const match = /^\/t\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(url.pathname)
    const secretId = match ? this.routes.get(match[1]!) : undefined
    const target = secretId ? this.target(secretId) : null
    if (!match || !target) return new Response('Not found', { status: 404 })
    const swap = (text: string) => text.replace(placeholderPattern(target.name, false), target.value)
    const upstream = new URL(target.upstream)
    upstream.pathname = `${upstream.pathname.replace(/\/+$/, '')}${match[2] ?? ''}` || '/'
    const encodedValue = encodeURIComponent(target.value)
    upstream.search = url.search.replace(placeholderPattern(target.name, true), encodedValue).replace(placeholderPattern(target.name, false), encodedValue)
    const headers = new Headers()
    request.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, swap(value))
    })
    // Uncompressed, so the value can be found in what comes back.
    headers.set('accept-encoding', 'identity')
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    let answer: Response
    try {
      answer = await this.fetchUpstream(upstream, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        redirect: 'manual'
      })
    } catch (error) {
      log(`tunnel for ${target.name}: ${upstream.origin} unreachable: ${error instanceof Error ? error.message : String(error)}`)
      return new Response(`${upstream.origin} is unreachable`, { status: 502 })
    }
    const back = new Headers()
    answer.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (HOP_BY_HOP.has(lower) || lower === 'content-encoding') return
      back.append(key, this.redactor.text(value))
    })
    const body = answer.body && this.redactor.active ? answer.body.pipeThrough(this.redactor.stream()) : answer.body
    return new Response(body, { status: answer.status, statusText: answer.statusText, headers: back })
  }
}
