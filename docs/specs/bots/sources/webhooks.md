---
type: Spec
title: Webhook source
description: A URL per bot hook that any system can call to start a bot run, with a 256-bit key, optional sender signatures, filters, redaction, caps and 7-day retention, copied from Orca's webhook contract.
status: stable
x-zomfy-implementation: planned
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
