---
type: Spec
title: Slack source
description: Asking a bot by mention or DM in Slack, with thread replies, Block Kit questions, approvals, Stop and status edits, through one Slack app per deployment.
status: stable
x-zomfy-implementation: planned
tags: [bots, slack]
sources:
  - id: orca-bots
    resource: /research/orca-bots.md
    title: Orca Bots, and a self-hosted equivalent for Zomfy
  - id: orca-conn
    resource: https://orca.dev/docs/bots/connectors
    title: Orca Bots connectors
  - id: orca-cc
    resource: https://github.com/stablyai/orca/tree/main/cloud/packages/connector-contract/src
    title: Orca connector-contract package
  - id: slack-events
    resource: https://docs.slack.dev/apis/events-api/
    title: Slack Events API
  - id: slack-verify
    resource: https://docs.slack.dev/authentication/verifying-requests-from-slack
    title: Verifying requests from Slack
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Slack is Orca Bots' main source and must work to Orca's level even though the person does not use
Slack. Orca makes one Slack app per bot from a configuration token;[^orca-conn] for a self-hoster
that is too much setup, so Zomfy uses **one Slack app per deployment** and names bots by handle.

# Setup the person does

1. api.slack.com → **Create New App → From a manifest**, pick the workspace, paste
   `apps/relay/slack-manifest.yaml` with the Worker URL filled in (`bun run deploy` prints it ready
   to paste).
2. **Install to Workspace** (an admin may have to approve). Copy the **Bot User OAuth Token**
   (`xoxb-…`) and, from Basic Information, the **Signing Secret**: `SLACK_BOT_TOKEN`,
   `SLACK_SIGNING_SECRET`.
3. In Zomfy, the bot's Who can ask → Slack: your member id (profile → ⋯ → Copy member ID) as owner;
   members the same way.

Manifest: bot scopes `app_mentions:read`, `chat:write`, `chat:write.customize`, `channels:history`,
`groups:history`, `im:history`, `im:read`, `im:write`, `mpim:history`, `reactions:read`,
`reactions:write`, `files:read`, `files:write`, `users:read`, `pins:write`; events `app_mention`,
`message.im`, `message.channels`, `message.groups`, `message.mpim`; interactivity at
`/slack/interactivity`; App Home messages tab on.

# Behaviour

- **Asking:** `@Zomfy reviewer …` in a channel, or a DM to the app (handle optional; the default
  bot otherwise). Asker places: `direct_message`, `group_message`, `public_channel`,
  `private_channel`, as in Orca's contract.[^orca-cc]
- **Threads:** the conversation is the thread of the asking message (`thread_ts`); a reply in it by
  an asker is a `send`; others' are `no_access` context. Context on `start` is the thread so far
  (`conversations.replies`), labelled. A **bare mention** carries the asker's own last ≤ 10
  messages (≤ 4000 chars, ≤ 10 files) as the request, as in Orca.[^orca-cc]
- **Status:** one message per turn with the current activity line and plan steps and a **Stop**
  button, edited with `chat.update` at most every 3 s; replaced by the reply.
- **Questions and approvals:** a Block Kit message with one button per option (and **Answer in
  Zomfy**); a `byReply` question takes the asker's next thread reply as the text; approvals show
  Allow once / Allow always / Deny. A press is acked within 3 s, checked against the asker and the
  owner (others get an ephemeral note), and queued as `answer`. Unsupported prompts show a card
  linking to Zomfy.
- **Mirroring:** what the owner types in the Zomfy chat is posted to the thread under the owner's
  name and picture (`chat:write.customize`), like Orca's mirror.
- **Actions:** the shared verbs plus Slack's `pin`, `canvas`, `list`, `scheduled` (scheduled posts
  up to 120 days ahead), as in Orca.
- **Not allowed:** an ephemeral "ask the owner" note with **Request access**.

## Signatures and limits

- Signature: HMAC-SHA256 of `v0:<X-Slack-Request-Timestamp>:<raw body>` with the signing secret,
  compared with `X-Slack-Signature`; timestamps more than 5 minutes off are refused. The
  `url_verification` challenge is answered.[^slack-verify]
- Ack within 3 s or Slack retries (`X-Slack-Retry-Num`); dedupe on `event_id`.[^slack-events]
- `chat.postMessage` about 1 per second per channel; `chat.update` Tier 3; long answers split at
  3,000 characters per section, or uploaded as a file.

# Non-goals

- One Slack app per bot, Orca's configuration-token flow and app hand-off.
- Socket Mode.
- Slack Enterprise Grid org-wide installs.

# Acceptance

- Worker tests: good and bad signatures; an old timestamp refused; `url_verification` answered; a
  retried event (same `event_id`) creates one delivery.
- Worker test: a Block Kit button press by a non-asker gets an ephemeral note and no `answer`; by
  the asker, an `answer` delivery and the buttons are replaced.
- End to end in a free test Slack workspace: a mention opens a thread with a status and Stop, and
  one answer lands; a DM works the same; an approval round-trips; Stop stops.
- The manifest in the repo installs without edits other than the URL.

# Open questions

None for the person.

[^orca-conn]: Orca Bots connectors page
[^orca-cc]: Orca's `delivery-messages.ts`, `earlier-own-messages.ts`, `action-messages.ts`, `connector-slack-mirror-contract.ts`
[^slack-verify]: Verifying requests from Slack
[^slack-events]: Slack Events API
