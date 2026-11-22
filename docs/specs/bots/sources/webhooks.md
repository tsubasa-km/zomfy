---
type: Spec
title: Webhook source
description: A URL per bot hook that any system can call to start a bot run, with a 256-bit key, optional sender signatures, filters, redaction, caps and 7-day retention, copied from Orca's webhook contract.
status: stable
x-zomfy-implementation: in-progress
tags: [bots, webhooks, security]
sources:
  - id: orca-bots
    resource: /research/orca-bots.md
    title: Orca Bots, and a self-hosted equivalent for Zomfy
  - id: orca-wh
    resource: https://github.com/stablyai/orca/tree/main/cloud/packages/connector-contract/src
    title: Orca webhook-names, webhook-routes, webhook-envelope, webhook-matcher
  - id: orca-sec
    resource: https://orca.dev/docs/bots/security
    title: Orca Bots security
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Monitoring, forms, CI systems and scripts should be able to wake a bot with one HTTP call, without
being able to steer it: the body is information, not instructions.[^orca-sec]

# Setup the person does

In Zomfy, a bot → **New trigger → Webhook**: name, the prompt the run gets, optional filters, an
optional sender type and signing secret. Zomfy shows the URL and key once, with copy buttons, and
the person pastes them into the calling system.

# Behaviour

- **Ids and key:** hook id `wh_` + 16 alphanumerics; call id `call_` + 20; key `zomfywh_` + 43
  base64url characters (256 bits), stored at the Hub as a hash. The `zomfywh_` prefix lets the key
  be redacted to `[zomfy webhook key]` anywhere text leaves the Hub or the daemon.[^orca-wh]
- **Calls:** `POST <worker>/hooks/<hookId>` with `Authorization: Bearer <key>`, or
  `POST <worker>/hooks/<hookId>/<key>` for senders that cannot set headers.
- **Signatures:** optional per hook; a pasted or generated secret (≤ 1024 chars). Native checks for
  the senders Orca supports: `standard` (Standard Webhooks), `github`, `sentry`, `linear`,
  `pagerduty`, `stripe`; with none, the key alone authorises.[^orca-wh]
- **Body:** ≤ 1 MiB (413 over it); header values ≤ 1024; depth ≤ 128; ≤ 100k nodes; parsed as JSON,
  form (repeated keys → arrays) or text. Credential and signature headers are dropped, only
  allowlisted headers kept, and the key is scrubbed from the body.
- **Filters:** up to 8 `where` clauses, ANDed, ops `=`, `!=`, `in`, `contains`, `exists`,
  `!exists`, on paths from `body.` or `headers.`; `pick` ≤ 12 fields passed to the run;
  `subjectFrom` folds calls with the same subject into one open run. Orca's matcher semantics and
  its test cases are copied.[^orca-wh]
- **Answer to the caller:** 200 `{callId, status}` with `queued`, `ignored` (filters), `duplicate`
  or `paused`; 401 bad key or signature; 404 unknown hook; 413 too large; 429 over the cap.
- **Caps:** 200 runs per hook per rolling hour (owner may lower), 300 per deployment; the owner
  gets a notice in Zomfy on a refusal burst or a reached cap.
- **To the daemon:** a `webhook_notice`; the daemon fetches the call with `webhook.fetch` and runs
  the hook's automation, the body wrapped as untrusted information. Bodies are deleted after the
  run is done or after 7 days, whichever is first.
- **Rotation:** a new key overlaps the old until a set time; Stop now cancels pending calls.

# Built so far

The Worker side of phase B5's webhooks ([overview](../overview.md#phases)), in
`apps/relay/src/webhooks/`, with the names, redaction, filter and stored call in the contract's
`bots/webhooks.ts` (Orca's `webhook-matcher.test.ts` cases run in `packages/relay-contract`).
Details settled while building:

- **The daemon manages hooks with actions**, since it talks to the Hub over its link rather than
  Orca's HTTP routes: `webhook.mint {botId, cap?}` (answers the URL and the key once; the Hub keeps
  `sha256("webhook|" + key)`), `webhook.list`, `webhook.state {live|paused, cap?}`,
  `webhook.rotate {overlapUntil? | stopNow?}` (24 h overlap when no time is named),
  `webhook.secret {adapter, secret | generate}` (only a generated secret comes back),
  `webhook.delete`, `webhook.fetch {callId}` and `webhook.done {callId}` (the body goes at once).
  Only the host whose bot owns a hook may manage it or fetch its calls. The filters travel in the
  hook's rule in `hello` (`rule.webhook {hookId, where, textContains, pick, subjectFrom, subject}`);
  a hook with no rule ignores its calls.
- **A call** goes: unknown hook 404 → key (Bearer or path) 401 → sender signature 401 → the
  same sender delivery id (`webhook-id`, `X-GitHub-Delivery`, `Linear-Delivery`,
  `X-PagerDuty-Webhook-Id`, `Idempotency-Key`) is `duplicate` → a paused hook is `paused` → the key
  is scrubbed (as written and in its encodings) and the body parsed (413 past 1 MiB, depth 128 or
  100k nodes) → filters (`ignored`) → caps (429) → stored and `queued`, with a `webhook_notice`
  carrying `ruleId` and `subject`. Signature checks: Standard Webhooks (`webhook-*`, `whsec_`
  secrets, 5 minutes), GitHub (`X-Hub-Signature-256`), Sentry (`Sentry-Hook-Signature`), Linear
  (`Linear-Signature`, `webhookTimestamp` within 60 s), PagerDuty (`X-PagerDuty-Signature v1=`) and
  Stripe (`Stripe-Signature t=,v1=`, 5 minutes).
- **Stored**: only allowlisted headers (content type, user agent, the senders' event and delivery
  headers), never credentials or signatures; the scrubbed body as text and as the filters read it,
  the subject and the picked fields. Calls are deleted after 7 days by the Hub's purge, or at
  `webhook.done`. The signing secret is kept in the Hub's storage, since every call needs it.
- **Caps**: runs in the last rolling hour, per hook (its `cap`, at most 200) and per deployment
  (300); a refused run answers 429 and queues one `webhook_alert cap_reached` per hook and hour. 20
  refused calls (bad key or signature) within 10 minutes queue one `webhook_alert refusal_burst`.
- Tested in workerd (`apps/relay/test/webhooks.test.ts`).

The daemon's and the desktop's part followed with phase B2: **New trigger → Webhook** mints a
hook and shows the URL and key once, the rule goes in `hello`, `webhook_notice` runs the automation
after `webhook.fetch` (body quoted as information) and then `webhook.done`, a call with the
subject of an unfinished run goes into its chat, and `webhook_alert` is a notice in Needs you.

Left: the end-to-end `curl` check.

# Non-goals

- Synchronous responses carrying the bot's answer to the caller.
- OR filters, scripts in filters.

# Acceptance

- Worker tests: right key → 200 `queued`; wrong key → 401; key in path works; 1 MiB + 1 byte → 413;
  a GitHub-signed hook rejects a bad `X-Hub-Signature-256`; the same call id twice → `duplicate`.
- The stored envelope has no `Authorization` header and no key text (grep test).
- Matcher tests copied from Orca's `webhook-matcher.test.ts` cases pass.
- Cap test: call 201 within an hour → 429 and one owner notice.
- Purge test: a body is gone 7 days after the call (alarm fired with a faked clock).
- End to end: `curl` the URL; a bot run starts in Zomfy with the body shown as information.

# Open questions

None for the person.

[^orca-wh]: Orca's `webhook-names.ts`, `webhook-routes.ts`, `webhook-envelope.ts`, `webhook-matcher.ts`
[^orca-sec]: Orca Bots security page
