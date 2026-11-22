---
type: Spec
title: Bots connector contract
description: The versioned messages the daemon and Zomfy Relay exchange over the host link for bots, kept in the new package packages/relay-contract and copied from Orca's connector contract.
status: stable
x-zomfy-implementation: done
tags: [bots, relay, protocol]
sources:
  - id: orca-bots
    resource: /research/orca-bots.md
    title: Orca Bots, and a self-hosted equivalent for Zomfy
  - id: orca-cc
    resource: https://github.com/stablyai/orca/tree/main/cloud/packages/connector-contract/src
    title: Orca connector-contract package
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T03:21:28Z" }
---

# Problem

The daemon and the [connector](connector.md) are built, tested and deployed apart, often by
different agents. Their messages need one definition both import, versioned so an old daemon and a
new Worker (or the reverse) keep working. Orca solved the hard parts — idempotent deliveries, two
acks, resumable event batches — and Zomfy keeps its semantics.[^orca-cc]

# Where it lives

- **`packages/relay-contract`** (`@zomfy/relay-contract`): zod schemas and TypeScript types,
  no runtime dependencies besides zod. `src/link.ts` (the shared host link and registration
  bodies), `src/bots/*.ts` (this spec), `src/phone/index.ts` ([phone relay](../mobile/relay.md)),
  `src/frames.ts` (`parseToHub` / `parseToHost`), `src/limits.ts`, `src/version.ts`, and
  `src/fixtures.ts`, one valid example of every message, which the tests of all three packages use.
- One file per area in `src/bots/`, after Orca's split: `hello`, `deliveries`, `events`, `actions`,
  `triggers`, `pr-events`, `webhooks`, `askers`, `failures`, `refs`.
- The Worker cannot use a `workspace:*` dependency under the Deploy button, so
  `bun run relay:vendor` copies the package source into `apps/relay/src/contract/`; a test fails
  when the copy differs from the package ([connector](connector.md#deploy)).
- `packages/protocol` stays the daemon ↔ window contract; it gains `bots.ts` for the bot methods
  the windows call ([daemon](daemon.md#methods)).

# Behaviour

## Framing

Every WebSocket text frame on `/v1/host` is JSON `{ ch, type, ... }`, where `ch` is `link`, `bots`
or `phone`. Unknown channels, unknown `type`s and unknown fields are ignored; a known `type` with
wrong fields is invalid (the Hub answers `error bad_message`). `CONTRACT_VERSION = 1`; change beyond
that happens through `features` lists both sides advertise, as in Orca.

## Link channel

`challenge {nonce}` (Hub → daemon, on accept), `auth {signature}` (daemon → Hub, Ed25519 over
`zomfy-relay-v1|<hostId>|<nonce>`), `auth-ok {hostId}`, and `ping` / `pong`, which the runtime
answers without waking the Hub, so their frames are fixed byte for byte (`PING_FRAME`,
`PONG_FRAME`). The host id is in the URL: `/v1/host?hostId=<id>` ([pairing](../mobile/pairing.md)).

## Bots channel: daemon → Hub

| Message | Fields | Purpose |
| --- | --- | --- |
| `hello` | `contract`, `host {id, name, kind: desktop\|serve}`, `features[]`, `sources[]`, `promptKinds[]`, `bots[] ≤20`, `rules[]`, `pages` | Announces the host's bots and trigger rules. Sent after every (re)connect and when bots or rules change. |
| `hello-bots` | `page ≥2`, `bots[] ≤20` | The next page of bots when `pages > 1`; the Hub answers `hello-ok` once every page is in. |
| `ack` | `helloRev`, `deliveryId`, `step: received\|done`, `outcome?` | `received` after a durable local receipt; `done` with `accepted`, `refused`, `unknown`, `expired` or `unsupported`. |
| `events` | `helloRev`, `seq`, `events[]` | Ordered batch; `seq` starts at 0 per hello; a retried `seq` is ignored. |
| `action` | `helloRev`, `reqId`, `verb`, `ref`, `args`, `idempotencyKey?` | A bot acting in a source (below). |

A `bots[]` entry: `id`, `name`, `handle`, `avatar?`, `agent`, `paused`, `owner {<source>: id}`,
`askers {<source>: [{id, role}]}`, `places[]`, `isDefault?` (the deployment's default bot, which
takes a source message that names no bot by handle; with none set and one bot known, that one). A `rules[]` entry is in [triggers](#triggers).

## Bots channel: Hub → daemon

| Message | Fields | Purpose |
| --- | --- | --- |
| `hello-ok` | `helloRev`, `features[]`, `unsettled[]` | Monotonic `helloRev`; every later message carries it, and a stale one gets `error hello_required`. `unsettled` lists deliveries not yet `done`. |
| `delivery` | `helloRev`, `deliveries[] ≤20` (see below) | Requests for the host; the daemon parses each item on its own, so one of an unknown kind is acked `done unsupported` without hiding the others. |
| `action-result` | `reqId`, `ok`, `result?`, `error?` | |
| `control` | `stop` \| `pause {forMs}` \| `reconnect` | |
| `error` | `code`, `message`, `about?` | `hello_required`, `unknown_bot`, `grant_expired`, `too_large`, `rate_limited`, `bad_message`. |

## Deliveries

Common fields: `id` (stable across re-sends), `kind`, `botId`, `conversation {source, externalId}`,
`askedAt`, `expiresAt`, `asker {source, id, name, role: owner\|member\|other}`.

| Kind | Extra fields | Daemon does |
| --- | --- | --- |
| `start` | `placeId`, `text`, `context[]`, `links[]`, `attachments[]` | New chat in the bot's home ([daemon](daemon.md#deliveries)) |
| `send` | `text`, `context[]` | Another turn in the linked chat; sends queued behind a running turn may be batched into one turn |
| `answer` | `promptId`, `optionId?` or `text?` | Answers a pending question or approval |
| `cancel` | `turnId` | Stops that turn (the Stop button) |
| `trigger` | `ruleId`, `event {...}`, `graceMs` | Runs the rule's automation |
| `webhook_notice` | `hookId`, `callId` | The daemon fetches the stored call with an action |
| `pr_event` | `repo`, `number`, `branch`, `headSha`, `event` | Wakes the worker whose workspace is that branch at that commit |
| `access_request` | `requester`, `message?` | Shown to the owner in Zomfy |
| `webhook_alert` | `hookId`, `condition: refusal_burst\|cap_reached`, `count?` | A notice to the owner in Zomfy ([webhooks](sources/webhooks.md)) |

Optional fields added with the sources (an older daemon ignores them): `start.placeKind`
(`direct_message`, `group_message`, `public_channel`, `private_channel`, `issue`, `pull_request`, as
in Orca), `start.ruleIds` and `send.ruleIds` (rules of the same bot the asking message also matched,
run inside that turn: `triggerInTurn`), `webhook_notice.ruleId` and `.subject`, and on `pr_event`
`actor`, `check`, `reviewState`, `url`, `text`, `ref`; `pr_event.event` also takes `review_comment`
and `reopened`. A `trigger` delivery's `event` has the shape `triggerEventSchema` documents
(`source`, `kind`, `key`, `actorId`, `fromOwner?`, `actor?`, `placeRef?`, `place?`, `subject?`,
`url?`, `text?`, `occurredAt`, `conversation?`).

`context[]` items carry a `label` (`earlier`, `no_access`, `issue`, `bot`, `more`, `unreadable`) as
in Orca, so the agent can tell its own posts and others' text apart.[^orca-bots]

## Events (daemon → Hub)

Each event has a `kind`; the Hub parses them one by one and skips a kind it does not know.

`snapshot` (active conversations after each hello), `linked` / `unlinked`
(`conversation ↔ sessionId`), `chat-gone`, `prompt` (kind `approval {tool, summary, options[]}`,
`question {text, header, options[], byReply}` or `unsupported {text ≤1500 bytes}`),
`prompt-cleared`, `turn-started`, `activity {text ≤120 chars, steps ≤20}`, `workers`, `turn-ended`,
`reply {turnId, text, outcome, prLinks ≤5, reviewNotes ≤30, idempotencyKey}`.

Reply outcomes, as Orca's: `answered`, `quiet`, `no_answer`, `interrupted`, `failed`,
`cancelled`, `withdrawn`, `cleared`, `not_found`, `unattributed`. Failure categories are typed —
`signed_out`, `usage_limit {window, resetsAt}`, `not_set_up`, `folder_missing`, `agent_error`,
`unconfirmed` (unknown reads as `agent_error`) — so each source can phrase them.[^orca-cc]

## Actions

Shared verbs, as Orca's `/v1/connector/actions`: `reply`, `react`, `read`, `post`, `find`, `check`,
`edit`, `delete`, `attach`, `set`, plus `webhook.fetch` and `capabilities`; Slack's `pin`, `canvas`,
`list`, `scheduled`; and the hook verbs `webhook.mint`, `webhook.list`, `webhook.state`,
`webhook.rotate`, `webhook.secret`, `webhook.delete`, `webhook.done`, whose arguments are
`webhookActionArgs` ([webhooks](sources/webhooks.md)). A `ref` names a place in
a source: `discord:<guild>:<channel>:<thread?>:<message?>`, `slack:<team>:<channel>:<thread_ts?>`,
`github:<installation>:<owner/repo>:<number?>` (no number: the whole repository, as a rule's place),
`linear:<org>:<issue>`, `zomfy:<sessionId>`. An action on a source as a whole names it in
`args.source` instead of a ref. A `post` carries an `idempotencyKey`, so a retry never posts twice.

## Triggers

A rule: `id`, `botId`, `source`, `kinds[]`, `places[] ≤10`, `from?` (ids separated by commas or
spaces), `fromOwner?`, `label?`, `workflowRun?`, `inThread?`, `graceMs ≤24 h`, and, added with the
sources, `textContains?`, `subject?`, `team?` and `states[]?` (Linear), and `webhook?` (a webhook
rule's `hookId` and filters). The kinds per source are `TRIGGER_KINDS`, Orca's. At most 100 rules per hello. The Hub matches source
events against them and queues a `trigger` delivery; a message that both asks the bot and matches a
rule runs the rule inside that turn (`triggerInTurn`).[^orca-bots]

## Limits

`src/limits.ts` holds every number, copied from Orca's `connector-limits.ts` where it has
one:[^orca-cc] deliveries per message 20 (8 MiB); lease 30 s plus 30 s grace; `start`/`send`/`trigger`
wait 24 h (`requestWaitMs`, `maxTriggerWaitMs`); `answer`/`cancel` 5 min (`deliveryTtlMs`); request
1 MiB; event batch 192 KiB (halved on `too_large`); last assistant message 8 KiB, long answer
32 KiB; activity 120 chars and 20 steps; prompt text 1500 bytes; answer text 4000 chars; 5 work
links; 30 review notes (path 256, 1000 chars); bots 20 per hello (more in `hello-bots` pages, up
to 100 pages); 200 members per bot; handle 64 chars; 100 rules with 10 places, rule text 4096;
snapshot 200 conversations active in the last 7 days; earlier own messages 10 × 4000 chars, 10
files. Orca's poll timings do not apply over the WebSocket.

# Non-goals

- Orca's account-bound token minting (`sub`, `mid`): the link is authenticated by the host key
  ([pairing](../mobile/pairing.md)).
- Orca's per-bot Slack app grant and hand-off messages.
- Orca's older `replies` route; replies are `reply` events only.

# Acceptance

- `bun test` in `packages/relay-contract`: a fixture per message kind parses and round-trips; an
  unknown field and an unknown `type` are ignored, not rejected.
- A test fails when `apps/relay/src/contract/` differs from `packages/relay-contract/src/`.
- A message with a stale `helloRev` gets `error hello_required` (tested in the Worker).
- Re-sending an `events` batch with an already-seen `seq` changes nothing (tested in the Worker).
- Every limit above is a named export of `limits.ts`, and both sides import it.

# Open questions

None for the person; field names may still change while B0 is built.

[^orca-bots]: Orca Bots research, §1.4–1.6 and §2.2
[^orca-cc]: `connector-limits.ts`, `delivery-messages.ts`, `event-messages.ts` in Orca's connector contract
