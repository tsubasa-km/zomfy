---
type: Spec
title: Bots connector (Zomfy Relay Worker)
description: The Cloudflare Worker and Durable Object each person deploys to receive source events, check Who can ask, queue deliveries for the daemon and post replies back to the sources.
status: stable
x-zomfy-implementation: planned
tags: [bots, relay, cloudflare]
sources:
  - id: orca-bots
    resource: /research/orca-bots.md
    title: Orca Bots, and a self-hosted equivalent for Zomfy
  - id: orca-cc
    resource: https://github.com/stablyai/orca/tree/main/cloud/packages/connector-contract/src
    title: Orca connector-contract package
  - id: cf-do
    resource: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
    title: Cloudflare Durable Objects WebSockets
  - id: cf-deploy
    resource: https://developers.cloudflare.com/workers/platform/deploy-buttons/
    title: Cloudflare Deploy buttons
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Sources call a public HTTPS URL and expect an answer within seconds; the daemon is behind NAT, may
be asleep, and only dials out. Orca's connector that bridges them is closed source.[^orca-bots]
Zomfy's is open source, in `apps/relay`, deployed by each person to their own Cloudflare account,
and shared with the [phone relay](../mobile/relay.md) ([decision](../../decisions/one-relay-worker.md)).

# Behaviour

## Routes

| Route | Role |
| --- | --- |
| `POST /discord/interactions` | Discord HTTP interactions (buttons, slash command, PING) — [Discord](sources/discord.md) |
| `POST /slack/events`, `POST /slack/interactivity` | Slack Events API and Block Kit actions — [Slack](sources/slack.md) |
| `POST /github/webhook` | GitHub App webhooks — [GitHub](sources/github.md) |
| `POST /linear/webhook` | Linear webhooks — [Linear](sources/linear.md) |
| `POST /hooks/<hookId>`, `POST /hooks/<hookId>/<key>` | Generic webhooks — [webhooks](sources/webhooks.md) |
| `POST /v1/hosts/register`, `POST /v1/hosts/invite` | Host registration — [pairing](../mobile/pairing.md) |
| `GET /v1/host` (upgrade) | The daemon's link, channels `bots` and `phone` — [contract](contract.md) |
| `GET /v1/device/<hostId>/ws` (upgrade) | Phone sockets — [phone relay](../mobile/relay.md) |
| `GET /health` | `{ok, version, sources: [configured…]}`, no secrets |

Every source route: read the raw body, verify the source's signature (bad → 401), dedupe on the
source's event id, hand the event to the Hub, and answer 2xx within the source's deadline (Slack
3 s, Discord 3 s, Linear 5 s, GitHub 10 s). It never waits for the daemon.

## Durable Objects

- **`Hub`** (SQLite storage, one instance named `hub`): tables `hosts`, `devices`, `bots` (from the
  latest `hello` per host), `deliveries`, `conversations` (`{source, externalId} ↔ {hostId,
  sessionId}`), `prompts` (pending questions and the source messages showing them), `rules`,
  `webhooks`, `webhook_calls`, `seen_events` (dedupe, 7 days), `outbound` (posts with idempotency
  keys), `due` (timers). All daemon and phone sockets use hibernation (`ctx.acceptWebSocket`); the
  attachment holds only `{kind, hostId|deviceId}`; nothing that matters lives in memory.[^cf-do]
- **`DiscordGateway`** (one instance, only when Discord is configured): holds the Discord Gateway
  connection, which cannot hibernate, and forwards message events to the Hub
  ([Discord](sources/discord.md#receiving-messages)).
- One alarm per object, set to the earliest row in `due`: lease re-sends, 24 h expiry, 5-minute
  expiry of answers and cancels, 7-day purge of webhook bodies and dedupe rows.

## Who can ask

The Hub checks it before a delivery exists: the asker is the bot's owner on that source or in its
members (`canAskBot`, Orca's single rule).[^orca-cc] Otherwise:

- the person gets an "ask the owner" note (private where the source allows: Slack ephemeral,
  Discord ephemeral or DM; public on GitHub and Linear), with an **access request** button or link;
- the request becomes an `access_request` delivery to the bot's host; the owner allows or declines
  in Zomfy;
- messages from non-askers in a thread the bot is in are kept as `no_access` context, never start or
  steer work.

Event triggers are not gated by Who can ask (as in Orca); their `from` field narrows them.

## Delivery, lease and ack

- A delivery is `pending` → `leased` (sent on the host link) → `received` → `done`. A leased
  delivery with no `received` after 30 s is re-sent with the same id; on reconnect, after
  `hello-ok`, every not-`done` delivery is re-sent and listed in `unsettled`.
- `start`, `send` and `trigger` wait up to 24 h for the host; `answer` and `cancel` 5 minutes. An
  expired request tells the asker in the source ("Your computer was offline; this expired") and is
  acked `expired` locally.
- Deliveries for a bot go to the host whose latest `hello` lists it; a bot listed by no host waits.
- `done refused` / `unsupported` outcomes are phrased back to the asker; failures use the typed
  failure categories.

## Replies and status in the source

- `turn-started` posts or updates one **status message** per turn with a Stop button; `activity`
  edits it at most once every 3 s; `turn-ended` replaces it with the result. `reply` posts the
  answer (split at the source's length limit) and is recorded in `outbound` by idempotency key, so a
  retried event never posts twice.
- `prompt` posts the question or approval with buttons; a press is checked (only the asker or the
  owner may answer; others get a private "only … can answer"), acked to the source at once, and
  queued as an `answer`. `prompt-cleared` edits the buttons away ("Answered in Zomfy").
- All outbound calls use tokens from Worker secrets; nothing secret is sent to the daemon.

## Deploy

- `apps/relay` builds on its own: `wrangler.jsonc` declares `Hub` and `DiscordGateway` with a
  `new_sqlite_classes` migration; the contract is vendored into `src/contract/`
  ([contract](contract.md#where-it-lives)); `.dev.vars.example` lists every secret.[^cf-deploy]
- **Deploy to Cloudflare** button: `https://deploy.workers.cloudflare.com/?url=<repo>/tree/main/apps/relay`;
  Cloudflare clones it into the person's GitHub, creates the objects and asks for the secrets.
- **`bun run deploy`** (in `apps/relay`): checks `wrangler whoami`, runs `wrangler deploy`, generates
  `SETUP_CODE`, asks for each source's secrets the person wants (skipping the rest), and prints the
  Worker URL, the setup code, and each source URL to paste.
- Both work on the Workers Free plan for one person, except as noted in
  [Discord](sources/discord.md#open-questions).

## Secrets

`SETUP_CODE`; `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`;
`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`; `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_SLUG`; `LINEAR_ACCESS_TOKEN`, `LINEAR_WEBHOOK_SECRET`;
`EXPO_ACCESS_TOKEN` (optional, [push](../mobile/push.md)). A source with no secrets is off and its
routes answer 404. The Hub stores public keys, in-flight requests, conversation links, recent
thread text used as context, and webhook bodies for at most 7 days.

## Limits

| Limit | Value | Consequence |
| --- | --- | --- |
| Workers Free CPU | 10 ms per request | Verify and forward only; render messages in the Hub |
| Workers Free requests | 100,000 per day | Ample for one person |
| DO WebSocket message | 32 MiB received; attachment 16 KiB | Contract caps messages at 1 MiB |
| DO alarms | one per object | The `due` table |
| Source deadlines | Slack 3 s, Discord 3 s, Linear 5 s, GitHub 10 s | Ack first, work later |

# Non-goals

- A hosted deployment, accounts, or several people on one deployment.
- Queues, KV or D1: the Hub's SQLite is the queue.
- Cron Triggers: schedules run on the daemon.

# Acceptance

Worker tests with `@cloudflare/vitest-pool-workers`, plus a fake daemon script against `wrangler dev`:

- Each source route rejects a bad signature with 401 and accepts a good one within its deadline.
- The same source event delivered twice (a retry) creates one delivery.
- A delivery with no `received` is re-sent with the same id after 30 s; after a reconnect it is in
  `unsettled` and re-sent.
- A `start` not received in 24 h expires and the asker is told once; an `answer` expires after 5 min.
- A non-asker's mention creates no delivery, gets the "ask the owner" note, and offers an access
  request that reaches the host as `access_request`.
- A `reply` event retried three times posts one message.
- `bun run deploy` against a fresh test account prints a working URL; `/health` lists only the
  configured sources; the Deploy button works from the public repo.
- Nothing in Hub storage or logs contains a secret value (grep test with marker secrets).

# Open questions

1. The Deploy button needs a **public** repository (`tsubasa-km/zomfy`). Is the repo public, or
   should the button point at a separate public template repo that CI keeps in sync?

[^orca-bots]: Orca Bots research, §2 and §3
[^orca-cc]: Orca's `bot-askers.ts`, `connector-limits.ts`
[^cf-do]: Cloudflare Durable Objects WebSocket hibernation
[^cf-deploy]: Cloudflare Deploy buttons
