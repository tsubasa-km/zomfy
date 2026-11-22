// Zomfy Relay: one Worker for the bots connector and the phone relay
// (docs/decisions/one-relay-worker.md). The Worker reads and size-checks requests and hands them to
// the one Hub; it never waits for a daemon.

import { CONTRACT_VERSION, limits } from './contract'
import { verifyDiscordRequest } from './discord/verify'
import { verifyGitHubRequest } from './github/api'
import { verifySlackRequest } from './slack/verify'
import { configuredSources, RELAY_VERSION, type Env } from './env'

export { DiscordGateway } from './discord-gateway'
export { Hub } from './hub'

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 })

function hub(env: Env) {
  return env.HUB.get(env.HUB.idFromName('hub'))
}

function gateway(env: Env) {
  return env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName('discord'))
}

/** Reads a body of at most `maxRequestBytes`, or null when it is larger. */
async function readBody(request: Request): Promise<ArrayBuffer | null> {
  const length = Number(request.headers.get('Content-Length') ?? '0')
  if (length > limits.maxRequestBytes) return null
  const body = await request.arrayBuffer()
  return body.byteLength > limits.maxRequestBytes ? null : body
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    const sources = configuredSources(env)
    const discord = sources.includes('discord')
    // The Gateway is held all the time; any of these requests starts it again if it is not.
    const holdGateway = () => {
      if (discord) ctx.waitUntil(gateway(env).ensure().catch(() => {}))
    }

    if (pathname === '/health' && request.method === 'GET') {
      let discordGateway: unknown
      if (discord) {
        await gateway(env).ensure().catch(() => {})
        discordGateway = await gateway(env).status().catch(() => ({ state: 'failed' }))
      }
      const uptime = (discordGateway as { uptimeSeconds?: number } | undefined)?.uptimeSeconds
      return Response.json({
        ok: true,
        version: RELAY_VERSION,
        contract: CONTRACT_VERSION,
        sources,
        ...(discord ? { discordGatewayUptime: uptime ?? null, discordGateway } : {})
      })
    }

    if (pathname === '/discord/interactions' && request.method === 'POST' && discord) {
      const body = await readBody(request)
      if (!body) return Response.json({ error: 'too_large' }, { status: 413 })
      const text = new TextDecoder().decode(body)
      const ok = await verifyDiscordRequest(
        env.DISCORD_PUBLIC_KEY ?? '',
        request.headers.get('X-Signature-Ed25519') ?? '',
        request.headers.get('X-Signature-Timestamp') ?? '',
        text
      )
      if (!ok) return Response.json({ error: 'bad_signature' }, { status: 401 })
      let interaction: { type?: number }
      try {
        interaction = JSON.parse(text)
      } catch {
        return Response.json({ error: 'bad_request' }, { status: 400 })
      }
      holdGateway()
      // PING is answered here, so the endpoint check works before any host has paired.
      if (interaction.type === 1) return Response.json({ type: 1 })
      return Response.json(await hub(env).discordInteraction(interaction))
    }

    if (pathname === '/v1/host' && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return Response.json({ error: 'bad_request' }, { status: 426 })
      }
      holdGateway()
      return hub(env).fetch(request)
    }

    if ((pathname === '/v1/hosts/register' || pathname === '/v1/hosts/invite') && request.method === 'POST') {
      const body = await readBody(request)
      if (!body) return Response.json({ error: 'too_large' }, { status: 413 })
      return hub(env).fetch(new Request(request.url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }))
    }

    if ((pathname === '/slack/events' || pathname === '/slack/interactivity') && request.method === 'POST' && sources.includes('slack')) {
      const body = await readBody(request)
      if (!body) return Response.json({ error: 'too_large' }, { status: 413 })
      const text = new TextDecoder().decode(body)
      const ok = await verifySlackRequest(
        env.SLACK_SIGNING_SECRET ?? '',
        request.headers.get('X-Slack-Signature') ?? '',
        request.headers.get('X-Slack-Request-Timestamp') ?? '',
        text
      )
      if (!ok) return Response.json({ error: 'bad_signature' }, { status: 401 })
      holdGateway()
      if (pathname === '/slack/interactivity') {
        let payload: unknown
        try {
          payload = JSON.parse(new URLSearchParams(text).get('payload') ?? '')
        } catch {
          return Response.json({ error: 'bad_request' }, { status: 400 })
        }
        await hub(env).slackInteraction(payload)
        return new Response(null, { status: 200 })
      }
      let event: { type?: string; challenge?: string }
      try {
        event = JSON.parse(text)
      } catch {
        return Response.json({ error: 'bad_request' }, { status: 400 })
      }
      // Answered here, so the Request URL check works before any host has paired.
      if (event.type === 'url_verification') return Response.json({ challenge: event.challenge ?? '' })
      await hub(env).slackEvent(event)
      return new Response(null, { status: 200 })
    }

    if (pathname === '/github/webhook' && request.method === 'POST' && sources.includes('github')) {
      const body = await readBody(request)
      if (!body) return Response.json({ error: 'too_large' }, { status: 413 })
      const text = new TextDecoder().decode(body)
      if (!(await verifyGitHubRequest(env.GITHUB_WEBHOOK_SECRET ?? '', request.headers.get('X-Hub-Signature-256') ?? '', text))) {
        return Response.json({ error: 'bad_signature' }, { status: 401 })
      }
      const event = request.headers.get('X-GitHub-Event') ?? ''
      const deliveryId = request.headers.get('X-GitHub-Delivery') ?? ''
      if (event === 'ping') return Response.json({ ok: true })
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        return Response.json({ error: 'bad_request' }, { status: 400 })
      }
      if (!deliveryId) return Response.json({ error: 'bad_request' }, { status: 400 })
      holdGateway()
      await hub(env).githubWebhook(event, deliveryId, payload)
      return Response.json({ ok: true }, { status: 202 })
    }

    // The phone routes arrive with their phase; a source without secrets answers 404.
    return notFound()
  }
} satisfies ExportedHandler<Env>
