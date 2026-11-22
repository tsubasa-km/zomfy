---
type: Spec
title: Slack source
description: Asking a bot by mention or DM in Slack, with thread replies, Block Kit questions, approvals, Stop and status edits, through one Slack app per deployment.
status: stable
x-zomfy-implementation: in-progress
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
`reactions:write`, `files:read`, `files:write`, `users:read`, `pins:write`, and, added while
building, `channels:read` and `groups:read` (for `find` and `check`) and `canvases:write` (for
`canvas` and `list`); events `app_mention`, `message.im`, `message.channels`, `message.groups`,
`message.mpim`, and `reaction_added` (for `reaction` triggers); interactivity at
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

# Built so far

The Worker side of phase B3 ([overview](../overview.md#phases)), in `apps/relay/src/slack/`, with
the manifest in `apps/relay/slack-manifest.yaml` and the Slack steps in `bun run deploy` and the
README. Details settled while building:

- **Routes.** `POST /slack/events` and `POST /slack/interactivity` check the signature on the raw
  body in the Worker, answer `url_verification` there (so the Request URL check works before any
  host has paired), and hand the rest to the Hub, which answers within 2 s while the work goes on.
- **Dedupe.** On `event_id`, and on the message itself (`<channel>:<ts>`), since Slack sends a
  mention as both `app_mention` and `message`. The app's own user comes from the events'
  `authorizations`; messages by bots and edits are skipped.
- **Conversations.** `externalId` is `<team>:<channel>:<thread_ts>`, the thread of the asking
  message (a top-level message's own `ts`), in channels and DMs alike; a DM's top-level message
  starts a new thread. `placeId` is `slack:<team>:<channel>`, and the `start` carries `placeKind`.
  Thread context is `conversations.replies`; a bare mention's request is the asker's own messages
  after the bot's last post (`earlier` items, a `more` item when there were more than 10).
  Attachments are the files' permalinks; the daemon downloads one with `read {download: <fileId>}`
  (inline base64, ≤ 512 KiB), since the bot token never leaves the Worker.
- **Who can ask.** A non-asker's mention gets `chat.postEphemeral` with **Request access**; a
  non-asker's thread reply is `no_access` context. A press by someone else than the asker or the
  owner gets an ephemeral note through the press's `response_url`.
- **Status and replies.** The status message (activity line, plan steps as ticks, **Stop**) is posted
  in the thread on `turn-started`, edited at most every 3 s, and becomes the answer on `reply`.
  Markdown is turned into mrkdwn; an answer is cut into 3,000-character sections, and one needing
  more than 10 sections is uploaded as `answer.md` with the first section posted. Every call goes
  through the Hub's outbound queue, one lane per channel, waiting out 429 `Retry-After`.
- **Buttons.** The action ids are Discord's custom ids (`z1:<prompt>:<i>`, `z1s:<turn>`,
  `z1r:<bot>`). An asker's press replaces the buttons at once ("… chose Allow once"); a later
  `prompt-cleared` edits it again. A `byReply` question takes the asker's next thread message;
  a number or an option's label picks that option, anything else is the text.
- **Triggers.** Messages, mentions and `reaction_added` are matched against `slack` rules
  (`message`, `mentioned`, `reaction`); a message that asks a bot carries that bot's matching rules
  as `ruleIds` (`triggerInTurn`) instead of a separate `trigger`.
- **Actions.** `reply`, `post` (with `postAt` it schedules; with `mirror: true` it posts under the
  bot owner's Slack name and picture), `react`, `read`, `find` (channels by name), `check`
  (`conversations.info`), `edit`, `delete`, `attach`, `pin`, `canvas`, `list` (a canvas holding a
  checklist: the Slack Lists API is not used), `scheduled` (list, or `cancel`). A post with an
  idempotency key posts once.
- Tested in workerd against fake Slack APIs (`apps/relay/test/slack.test.ts`).

Left: the end-to-end checks in a test workspace, and on the daemon side (a follow-up for the
daemon's agent): mirroring the owner's Zomfy messages with `post {mirror: true}`, downloading
files with `read {download}`, and running `ruleIds` inside the turn.

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
