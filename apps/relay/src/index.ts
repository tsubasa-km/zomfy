// Zomfy Relay: one Worker for the bots connector and the phone relay
// (docs/decisions/one-relay-worker.md). The Worker reads and size-checks requests and hands them to
// the one Hub; it never waits for a daemon.

import { CONTRACT_VERSION, limits } from './contract'
import { configuredSources, RELAY_VERSION, type Env } from './env'

export { DiscordGateway } from './discord-gateway'
export { Hub } from './hub'

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })

function hub(env: Env) {
  return env.HUB.get(env.HUB.idFromName('hub'))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    if (pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, version: RELAY_VERSION, contract: CONTRACT_VERSION, sources: configuredSources(env) })
    }

    if (pathname === '/v1/host' && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return Response.json({ error: 'bad_request' }, { status: 426 })
      }
      return hub(env).fetch(request)
    }

    if ((pathname === '/v1/hosts/register' || pathname === '/v1/hosts/invite') && request.method === 'POST') {
      const length = Number(request.headers.get('Content-Length') ?? '0')
      if (length > limits.maxRequestBytes) return Response.json({ error: 'too_large' }, { status: 413 })
      const body = await request.arrayBuffer()
      if (body.byteLength > limits.maxRequestBytes) return Response.json({ error: 'too_large' }, { status: 413 })
      return hub(env).fetch(new Request(request.url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }))
    }

    // Source routes (Discord, Slack, GitHub, Linear, webhooks) and the phone routes arrive with
    // their phases; until a source has secrets its routes answer 404 anyway.
    return notFound()
  }
} satisfies ExportedHandler<Env>
