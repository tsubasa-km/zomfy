---
type: Spec
title: Discord source
description: Asking a bot by mention, DM or slash command in Discord, with threads, buttons for questions, approvals and Stop, through one Discord application per deployment.
status: stable
x-zomfy-implementation: in-progress
tags: [bots, discord]
sources:
  - id: orca-connectors
    resource: https://github.com/stablyai/orca/blob/main/src/renderer/src/components/bots/bot-connectors.ts
    title: Orca bot connectors list (Discord "Coming soon")
  - id: discord-interactions
    resource: https://discord.com/developers/docs/interactions/overview
    title: Discord interactions
  - id: discord-gateway
    resource: https://discord.com/developers/docs/events/gateway
    title: Discord Gateway
  - id: cf-do
    resource: https://developers.cloudflare.com/durable-objects/platform/pricing/
    title: Cloudflare Durable Objects pricing
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

The person does not use Slack; Discord is the first source tested end to end. Orca lists Discord
only as "Coming soon" ("Chat with the bot from Discord channels, threads, and direct messages"),
with no implementation to copy,[^orca-connectors] so Zomfy designs it to behave like Orca's Slack
source: mention or DM, answer in a thread, buttons for questions, approvals and Stop.

# Setup the person does

1. discord.com/developers → **New Application** ("Zomfy"). On **Bot**: copy the token; turn on the
   **Message Content** intent (needed for thread follow-ups without a mention; free for bots in
   fewer than 100 servers).
2. **General Information**: copy the Application ID and Public Key; set **Interactions Endpoint
   URL** to `<worker>/discord/interactions` (Discord sends a PING the Worker must answer).
3. `wrangler secret put` (or `bun run deploy` asks): `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`,
   `DISCORD_BOT_TOKEN`. The Worker registers the slash command `/ask` on first start.
4. **OAuth2 → URL Generator**: scopes `bot`, `applications.commands`; permissions View Channels,
   Send Messages, Send Messages in Threads, Create Public Threads, Read Message History, Add
   Reactions, Embed Links, Attach Files. Open the link and add the app to the server.
5. In Zomfy, the bot's Who can ask → Discord: paste your own user id (Developer Mode → Copy User ID)
   as owner; add members the same way.

# Behaviour

## Receiving messages

- Mentions and DMs arrive over the **Gateway**, held by the `DiscordGateway` Durable Object
  ([connector](../connector.md#durable-objects)): intents `GUILDS`, `GUILD_MESSAGES`,
  `DIRECT_MESSAGES`, `MESSAGE_CONTENT`; heartbeat on the interval Discord gives; **resume** with
  session id and sequence after a drop, identify again only when resume fails.[^discord-gateway]
- It forwards to the Hub only messages that mention the app, DMs to it, and messages in threads the
  Hub has linked; everything else is dropped unread. Event id for dedupe: the message id.
- `/ask <prompt> [bot]` and the message context-menu command **Ask bot** arrive as HTTP
  interactions, so a bot can be asked even while the Gateway is reconnecting.

## Which bot

One Discord application serves all bots. A message names a bot by handle after the mention
(`@Zomfy reviewer fix …`) or by the `/ask` option; with no handle, the deployment's default bot
(set in Zomfy) takes it.

## Threads and replies

- In a channel: the first reply creates a **public thread** from the asker's message (named from the
  first words) and the conversation is that thread (`externalId` = thread id). Later messages in it
  by askers are `send`s, mention or not; others' are `no_access` context.
- In a DM: the conversation is the DM channel, until the person writes `new` or the bot's chat is
  gone; replies use a message reference to the asked message.
- Context on `start`: up to the last 20 messages of the thread or channel before the mention,
  labelled as in the [contract](../contract.md#deliveries).
- Status: one message per turn ("Working… Running bun test") edited at most every 3 s, with a
  **Stop** button; replaced by the reply when the turn ends. Answers over 2000 characters are split
  at paragraph or code-block boundaries; very long ones go as a `.md` attachment.

## Buttons

- Questions: one button per option (≤ 5 per row, ≤ 25), plus **Answer in Zomfy**; `byReply`
  questions take the asker's next message in the thread as the answer. Approvals: **Allow once**,
  **Allow always** (when offered), **Deny**.
- `custom_id` is `z1:<promptId>:<optionIndex>` (≤ 100 chars). A press is verified, acked at once
  with a deferred update (type 6), checked (only the asker or the owner; others get an ephemeral
  "Only … can answer this"), and queued as `answer`. `prompt-cleared` edits the buttons away.

## Signatures and limits

- HTTP interactions: Ed25519 over `X-Signature-Timestamp + raw body` with `DISCORD_PUBLIC_KEY`
  (header `X-Signature-Ed25519`); bad → 401. Answer within 3 s; a follow-up token lasts 15
  minutes.[^discord-interactions]
- Messages 2000 chars; 5 action rows of 5 buttons; rate limits per channel honoured from response
  headers (`X-RateLimit-*`, 429 `retry_after`) by the Hub's outbound queue.
- Non-askers get an ephemeral note (for `/ask`) or a DM (for a mention) to ask the owner, with a
  **Request access** button.

# Built so far

The Worker side of phase B1 ([overview](../overview.md#phases)), in `apps/relay`; the daemon side is
built apart. Details settled while building:

- **Conversations.** `externalId` is `<guild>:<channel>:<message>` for a mention (the thread
  started from that message has the message's id), `@me:<dmChannel>:<message>` for a DM, and
  `<guild|@me>:<channel>:i<interactionId>` for `/ask` and **Ask bot**. A mention inside a thread
  that is not the bot's answers in that thread; a DM conversation lasts until `new` or
  `chat-gone`. `placeId` is the ref `discord:<guild|@me>:<channel>`.
- **Which bot.** The first word after the mention, matched to a handle; otherwise the bot whose
  `hello` sets `isDefault` ([contract](../contract.md#bots-channel-daemon--hub)), otherwise the only
  bot. With none, the asker is told how to name one.
- **Watching.** The Hub tells `DiscordGateway` which threads it lives in before it queues the
  `start`, so a quick follow-up in the thread is not dropped.
- **`/ask`.** Answered at once with a public "asked" message; the thread starts from that message
  (found with the interaction token) when the first status or reply is posted. **Ask bot** threads
  from the target message and answers ephemerally.
- **Buttons.** Stop is `z1s:<turnId>`, Request access `z1r:<botId>`, options `z1:<promptId>:<i>`
  and Answer in Zomfy `z1:<promptId>:z`; ids too long for 100 characters use `#<row>`. A press by
  someone else than the asker or the owner gets the ephemeral note; Request access becomes an
  `access_request` delivery and the DM is edited to "Access requested".
- **Posting.** Every call goes through the Hub's `outbound` table: FIFO per conversation, waits on
  429 `retry_after` and spent buckets (`X-RateLimit-Remaining: 0`), retries 5xx with backoff, and
  keeps the key (`reply:<idempotencyKey>`, `status:<turnId>`, …) for 7 days, so a retried event
  posts once. An answer that would need more than 4 messages goes as `answer.md`. Without the
  right to create threads the bot answers in the channel with a reply reference.
- **Signatures.** Besides the Ed25519 check, a timestamp more than 5 minutes off is refused.
- **Gateway.** Its alarm is the heartbeat and the watchdog (a missed ack reconnects); `RECONNECT`,
  a dropped socket and a resumable `INVALID_SESSION` resume, 4007/4009 and a non-resumable one
  identify again, 4004 and 4010–4014 stop it for 10 minutes. `/health` returns
  `discordGatewayUptime` (seconds since the current connection became ready) and
  `discordGateway {state, uptimeSeconds, heldSeconds, reconnects, lastError}`.
- Tested in workerd against a fake Discord (`apps/relay/test/fake-discord.mjs`, REST and Gateway).
  Left for the end-to-end checks on the person's server.

# Non-goals

- One Discord application per bot; voice; reacting to messages that do not mention the bot.
- Discord triggers beyond `discord-message` in a channel (phase B5).

# Acceptance

- Worker test: a PING with a good signature gets type 1; a bad signature gets 401.
- Worker test with a fake Gateway server: a mention becomes one `start`; the same message after a
  resume is not delivered twice; a thread reply by an asker becomes `send`; by a non-asker, context.
- Worker test: a button press by a non-asker gets the ephemeral note and no `answer`.
- End to end on the person's server: `@Zomfy fix the typo in README` in a channel opens a thread,
  shows a status with Stop, and posts one answer; Stop during a turn ends it with "Stopped".
- An approval in a Discord-started chat shows three buttons; pressing **Allow once** continues the
  turn and removes the buttons; answering in Zomfy instead edits them to "Answered in Zomfy".
- `/ask` works while the Gateway object is restarted.

# Decisions

Answered by the person on 2026-11-22:

1. **The Gateway is held by the Cloudflare side all the time** (the `DiscordGateway` Durable
   Object), so @mentions and DMs work and a request waits up to 24 h in the Hub while the PC is
   off. `/ask` and **Ask bot** stay as well. Estimate: one object awake all day is about 11,000
   GB-s a day, just under the Workers Free plan's 13,000 GB-s daily Durable Object allowance; going
   over means moving the account to **Workers Paid (5 USD a month)**. `/health` reports the
   object's uptime so the person can watch it.[^cf-do]
2. One Discord application per deployment; bots are called by handle.

# Open questions

None for the person.

[^orca-connectors]: Orca's `bot-connectors.ts` and `AddConnectorDialog.tsx`
[^discord-gateway]: Discord Gateway documentation
[^discord-interactions]: Discord interactions documentation
[^cf-do]: Cloudflare Durable Objects pricing
