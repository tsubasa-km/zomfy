---
type: Decision
title: One Cloudflare Worker for bots and the phone relay
description: Zomfy Bots' connector and the phone app's relay are one open-source Worker with one Durable Object, which each person deploys to their own Cloudflare account.
status: stable
tags: [bots, mobile, relay, cloudflare]
sources:
  - id: orca-bots
    resource: /research/orca-bots.md
    title: Orca Bots, and a self-hosted equivalent for Zomfy
  - id: mobile-app
    resource: /research/mobile-app.md
    title: A phone app for Zomfy
  - id: person
    resource: "decisions given by the person on 2026-11-22"
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Context

Two features need something on the internet that reaches a daemon behind NAT which only dials out:
[Zomfy Bots](../specs/bots/overview.md) (Discord, Slack, GitHub, Linear and webhook callers must
reach the computer that runs the bot) and the [phone app](../specs/mobile/overview.md) (the phone
must reach the daemon away from home, and get push notifications).[^mobile-app] Orca runs both as
hosted services: a closed-source connector and an open relay with a closed auth
service.[^orca-bots] The person wants nothing hosted by the Zomfy project: each person deploys the
cloud part to their own Cloudflare account, and there is no account system.[^person]

# Decision

- **One Worker, `apps/relay` ("Zomfy Relay"), MIT, deployed per person** with the Deploy to
  Cloudflare button or `bun run deploy`. It serves the bot source routes, the phone routes and the
  daemons' link. Its design is in [connector](../specs/bots/connector.md) and
  [phone relay](../specs/mobile/relay.md).
- **One Durable Object class, `Hub`, one instance per deployment, SQLite storage.** One person's
  traffic is tiny, so a single object gives strict ordering and transactions without D1, KV or
  Queues. It holds registered hosts and devices, bot deliveries, conversation links, trigger rules,
  webhook calls and every WebSocket (daemons and phones), hibernated while idle.
- **One outbound WebSocket per daemon** (`/v1/host`), authenticated by the **host key** the daemon
  registered at first run ([pairing](../specs/mobile/pairing.md)). It carries two channels: `bots`
  (typed, plaintext to the Worker, because sources send plaintext) and `phone` (opaque end-to-end
  encrypted frames the Hub only splices).
- **One contract package, `packages/relay-contract`**, imported by the Worker and the daemon
  ([contract](../specs/bots/contract.md)).
- The daemon treats bot input as lower trust than a window or a paired phone: it can only start
  and steer the bot's own chats, within the bot's permission mode.

# Options weighed

| Option | Why not |
| --- | --- |
| Two Workers (connector, relay) | Two deploys, two host registrations, two sockets per daemon, two sets of secrets, for the same "reach a daemon that dials out" problem. |
| A Durable Object per host | Needed only when several people share a deployment; it adds cross-object calls for routing a bot's delivery to its host. Revisit with team deployments. |
| Orca's HTTP long-poll instead of a WebSocket | Works, but a hibernated WebSocket pushes a delivery at once and costs nothing while idle; Orca's message semantics (ids, leases, two acks, `seq`) are kept unchanged on top.[^orca-bots] |
| Slack Socket Mode / Discord Gateway from the daemon | No queue while the computer sleeps, and GitHub, Linear and webhooks still need a public URL. |

# Consequences

- The bot connector and the relay share host registration, the daemon link, reconnect logic and the
  push sender; whichever feature lands first builds them.
- A deployment's secrets (source tokens, Expo token) live only in Cloudflare Worker secrets.
- If phone traffic (terminal streams) ever crowds the single object, phone splicing moves to a
  per-host object without changing the contract.

[^mobile-app]: A phone app for Zomfy, "One relay for the phone and the chat bots"
[^orca-bots]: Orca Bots research, §2–3
[^person]: The person's decisions of 2026-11-22
