---
type: Spec
title: Linear source
description: Asking a bot on a Linear issue by mention or bot label through the person's own Linear app, replies as comments with an asked-by line, and Linear triggers.
status: stable
x-zomfy-implementation: planned
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
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Work is often tracked in Linear; Orca lets a bot be asked on an issue by mention or label and
answer there.[^orca-conn] Zomfy copies that with the person's own Linear app instead of Orca's.

# Setup the person does

1. Linear → Settings → API → **OAuth applications → New**, actor **Application** (so comments come
   from the app), name it "Zomfy"; or, for one person, a **personal API key** (comments then come
   from the person, with the asked-by line).
2. Authorize it on the workspace; `bun run deploy --linear` runs the OAuth exchange on the Worker
   and stores `LINEAR_ACCESS_TOKEN`.
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
