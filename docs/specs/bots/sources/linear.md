---
type: Spec
title: Linear source
description: Asking a bot on a Linear issue by mention or bot label through the person's own Linear app, replies as comments with an asked-by line, and Linear triggers.
status: stable
x-zomfy-implementation: in-progress
tags: [bots, linear]
sources:
  - id: orca-conn
    resource: https://orca.dev/docs/bots/connectors
    title: Orca Bots connectors
  - id: orca-cc
    resource: https://github.com/stablyai/orca/tree/main/cloud/packages/connector-contract/src
    title: Orca connector-contract package
  - id: orca-triggers
    resource: https://github.com/stablyai/orca/blob/main/src/shared/automation-event-triggers.ts
    title: Orca event trigger kinds
  - id: linear-webhooks
    resource: https://linear.app/developers/webhooks
    title: Linear webhooks
  - id: linear-oauth
    resource: https://linear.app/developers/oauth-2-0-authentication
    title: Linear OAuth 2.0 authentication
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Work is often tracked in Linear; Orca lets a bot be asked on an issue by mention or label and
answer there.[^orca-conn] Zomfy copies that with the person's own Linear app instead of Orca's.

# Setup the person does

1. Linear → Settings → API → **OAuth applications → New**, actor **Application** (so comments come
   from the app), name it "Zomfy"; or, for one person, a **personal API key** (comments then come
   from the person, with the asked-by line).
2. `bun run deploy --linear` asks for the app's client id and secret (`LINEAR_CLIENT_ID`,
   `LINEAR_CLIENT_SECRET`; the app must have **Client credentials** turned on) or the personal key
   (`LINEAR_ACCESS_TOKEN`). Changed while building: Linear's authorization-code tokens now last 24
   hours and need a rotating refresh token, so the Worker instead gets the app's own token with the
   client-credentials grant (app actor, 30 days, fetched again when it runs out).[^linear-oauth]
3. Settings → API → **Webhooks → New**: URL `<worker>/linear/webhook`, resources Issues, Comments,
   Issue labels; copy the signing secret into `LINEAR_WEBHOOK_SECRET`.
4. In Zomfy, the bot's Who can ask → Linear: your Linear user (picked from a list the Hub reads) as
   owner; members likewise.

# Behaviour

- **Asking:** `@Zomfy <handle>` in an issue comment or description, or adding the label
  `bot:<handle>` to an issue; no handle → the default bot of that Linear workspace, as in
  Orca.[^orca-cc] The conversation is the issue.
- **Replies** are comments on the issue. A comment written for someone other than the owner gets
  the line "asked by <name> via <bot>" (≤ 140 chars, extra names fold into "and N others", never
  twice), as in Orca.[^orca-cc]
- **Status:** an "On it…" comment edited with the activity line and replaced by the reply; a
  `- [ ]` checklist in it shows the plan.
- **Questions:** posted as a comment with numbered options; an asker answers by replying, or in
  Zomfy. Approvals are `unsupported` (answered in Zomfy).
- **Not allowed:** a public "ask the owner" comment.
- **Triggers:** `assigned`, `mentioned`, `issue_created`, `issue_moved` (with team and state
  filters).[^orca-triggers]

## Signatures and limits

- `Linear-Signature`: HMAC-SHA256 of the raw body with the webhook secret; reject a
  `webhookTimestamp` more than 60 s off; answer within 5 s (Linear retries after 1 min, 1 h,
  6 h).[^linear-webhooks]
- Comments up to 64 KiB; issue ids match `^[A-Za-z0-9]{1,16}-\d{1,9}$`.

# Built so far

The Worker side of phase B6's Linear part ([overview](../overview.md#phases)), in
`apps/relay/src/linear/`, with the Linear steps in `bun run deploy --linear` and the README. Details
settled while building:

- **Auth.** With `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` the Hub asks
  `POST /oauth/token` for a client-credentials token (scopes `read,write,app:assignable,app:mentionable`),
  keeps it in memory only, and asks again a day before it expires or on a 401. A pasted
  `LINEAR_ACCESS_TOKEN` is used as it is (a `lin_api_` key bare, any other as a Bearer token). The
  app's own user (`viewer`) is who gets mentioned and assigned, and whose comments are the bot's.
- **Route.** `POST /linear/webhook` checks `Linear-Signature` and that `webhookTimestamp` is within
  60 s in the Worker, and hands the payload to the Hub (answered within 3 s); dedupe on
  `Linear-Delivery`.
- **Asking.** A comment or a new (or newly) mentioning description: `@zomfy`, the app's name, or
  Linear's profile-link mention, then an optional handle. An added `bot:<handle>` label asks that
  bot with the issue's title as the text; a removed one does nothing. `externalId` and `placeId`
  are `<org>:<ENG-123>` / `linear:<org>:<ENG-123>`. Context: the issue and its last 20 comments.
  A non-asker gets a public comment and can comment `@Zomfy <handle> request access`.
- **Replies.** "On it…" is posted on `turn-started`, edited at most every 3 s with the activity and
  the plan as a `- [ ]` checklist, and becomes the reply, which ends with the asked-by line for
  non-owner askers. Questions are numbered comments answered by an asker's plain reply; approvals
  are answered in Zomfy only. Calls go through the outbound queue, one lane per issue; a 429 or
  `RATELIMITED` holds every Linear lane until `X-RateLimit-Requests-Reset`.
- **Triggers.** `issue_created`; `issue_moved` when `updatedFrom` has `stateId` (`states` names the
  states, `team` the team key); `assigned` when the issue is assigned to the app's user;
  `mentioned`. The asked bot's matching rules go in its `start` or `send` as `ruleIds`.
- **Actions.** `find {source: 'linear', text}` lists active members (no apps or guests) for Who can
  ask; `reply`/`post` (once per idempotency key), `react`, `read`, `edit`, `delete`.
- Tested in workerd against a fake Linear (`apps/relay/test/linear.test.ts`), with a pasted token;
  the client-credentials fetch is not covered by a test.

Left: the end-to-end check in a Linear workspace, the desktop's member picker that calls `find`,
and the nightly memory tidy-up (the daemon's part of B6).

# Non-goals

- Linear's agent-session UI ("open the bot's agent session"): Orca uses it, but how is closed
  source; later, if the comment flow falls short.
- Orca's sealed hand-off of the person's own Linear login to the desktop; the host uses its own
  Linear access (for example an MCP server) for other work.

# Acceptance

- Worker tests: signature accept/reject; an old timestamp refused; a comment mention becomes
  `start`; adding `bot:reviewer` becomes `start` for that bot; removing it does nothing.
- Worker test: a reply for a member includes one asked-by line; for the owner none.
- Trigger tests: `assigned` to the app's user fires; `issue_moved` with a state filter fires only
  for that state.
- End to end in a free Linear workspace: label an issue and get one reply comment.

# Open questions

None for the person.

[^orca-conn]: Orca Bots connectors page
[^orca-cc]: Orca's `linear-messages.ts`, `bot-owner-writes.ts`, `action-messages.ts`
[^orca-triggers]: Orca's `automation-event-triggers.ts`
[^linear-webhooks]: Linear webhooks documentation
[^linear-oauth]: Linear's OAuth 2.0 authentication documentation
