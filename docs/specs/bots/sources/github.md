---
type: Spec
title: GitHub source
description: Asking a bot by mention on issues and pull requests through the person's own GitHub App, replies and review notes, PR events for the bot's own pull requests, and GitHub triggers.
status: stable
x-zomfy-implementation: in-progress
tags: [bots, github]
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
  - id: orca-triggers
    resource: https://github.com/stablyai/orca/blob/main/src/shared/automation-github-triggers.ts
    title: Orca GitHub trigger kinds
  - id: gh-webhooks
    resource: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
    title: Validating GitHub webhook deliveries
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

Code review and CI happen on GitHub. A bot must be askable on an issue or PR, answer there, and be
woken when something happens to a PR it opened, so "come back to a tested pull request" closes the
loop. Orca uses a shared Orca GitHub App;[^orca-conn] Zomfy uses the person's own.

# Setup the person does

1. `bun run deploy --github` opens GitHub's **create app from manifest** page with the Worker URL,
   permissions and events filled in; the person names the app (e.g. `zomfy-bots-<name>`) and
   creates it. The callback stores `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`
   and `GITHUB_WEBHOOK_SECRET` as Worker secrets.
2. **Install** the app on chosen repositories (an org owner may need to approve).
3. In Zomfy, the bot's Who can ask → GitHub: your login as owner; members by login.

Permissions: Issues R/W, Pull requests R/W, Checks R, Contents R, Metadata R, Actions R, and,
added while building because their events need them, Deployments R, Code scanning alerts
(`security_events`) R and Dependabot alerts (`vulnerability_alerts`) R. Events:
`issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`,
`check_suite`, `check_run`, `workflow_run`, `push`, `deployment_status`, `security_advisory`
alerts (`dependabot_alert`, `code_scanning_alert`).

# Behaviour

- **Asking:** `@<app-slug> <handle> …` in an issue or PR comment, review comment or body; no handle
  → the default bot. The conversation is the issue or PR (`github:<installation>:<owner/repo>:<n>`).
- **Replies** are comments by the app; a reply with review notes (≤ 30, path ≤ 256, ≤ 1000 chars,
  side `LEFT|RIGHT`) is posted as one review, or appended to the comment where a review is not
  possible.[^orca-cc] Comments by others than the owner carry an "asked by … via …" line (≤ 140
  chars).
- **Status:** a 👀 reaction on the asking comment while the turn runs, replaced by the reply.
- **Questions and approvals:** GitHub has no buttons. The bot posts the question as a comment with
  numbered options; an asker answers by replying with the number or text, or answers in Zomfy.
  Approvals from GitHub-started chats are `unsupported` (answered in Zomfy only), since a comment
  is too easy to spoof by quoting.
- **Not allowed:** a public "ask the owner" reply (GitHub has no private replies).
- **PR events:** on PRs the owner opened (not forks, not the app itself), `check_failed`,
  `check_passed`, `comment`, `review_comment`, `review`, `merged`, `closed`, `reopened` become
  `pr_event` deliveries for the worker whose workspace is that branch at that commit.[^orca-cc]
- **Code work** (push, open PRs) uses the person's own `gh` sign-in on the host, never the app's
  token.
- **Triggers:** Orca's kinds — `issue_opened`, `pr_opened`, `pr_pushed`, `pr_merged`, `comment`,
  `review_comment`, `review`, `mentioned`, `review_requested`, `assigned`, `ci_failed`,
  `ci_passed`, `pr_conflicted`, `pr_closed`, `pr_ready`, `labeled`, `issue_closed`,
  `deploy_finished`, `security_alert`, `workflow_finished`. The owner's own actions start nothing
  except `fromOwner` on `pr_opened`; state changes (CI, merges, deploys) fire whoever caused them;
  the bot never triggers itself.[^orca-triggers]

## Signatures and limits

- `X-Hub-Signature-256`: HMAC-SHA256 of the raw body with the webhook secret; bad → 401; dedupe on
  `X-GitHub-Delivery`; answer within 10 s.[^gh-webhooks]
- The Hub signs an RS256 JWT (≤ 10 min) with the private key and caches installation tokens for
  under an hour; tokens are not assumed to be 40 characters.

# Built so far

The Worker side of phase B4 ([overview](../overview.md#phases)), in `apps/relay/src/github/`, with
the app manifest in `apps/relay/github-app-manifest.json`, `bun run deploy --github` and the README.
Details settled while building:

- **The manifest flow** runs on the person's computer, not the Worker: the script serves a page on
  `127.0.0.1` that posts the manifest to GitHub, GitHub sends the browser back there with a code,
  and the script exchanges it (`POST /app-manifests/<code>/conversions`) and puts the four secrets
  with `wrangler secret put`. A Worker cannot set its own secrets.
- **Route.** `POST /github/webhook` checks `X-Hub-Signature-256` in the Worker, answers `ping`, and
  hands the rest to the Hub (answered within 5 s while the work goes on); dedupe on
  `X-GitHub-Delivery`. Events by the app itself (`<slug>[bot]`) are dropped whole.
- **Asking.** A mention is `@<slug>` in a new issue's or pull request's body, an issue or PR
  comment, a review comment or a review's body. `externalId` is `<installation>:<owner/repo>:<n>`
  (found again by repository and number, whatever the installation); `placeId` is the repository
  ref `github:<installation>:<owner/repo>` (the contract's refs gained a repository form), and
  `placeKind` is `issue` or `pull_request`. Logins are compared in any case. Context on `start`: the
  issue (`issue` label) and its last 20 comments, labelled `earlier`, `bot` or `no_access`. A later
  mention in the same issue is a `send`; comments without a mention are kept as context.
- **Access requests.** GitHub has no buttons and anyone could open a link, so a non-asker is told to
  comment `@<slug> <handle> request access`, which becomes the `access_request` (GitHub vouches
  for who wrote it).
- **Answers.** An asker's plain reply on an issue with an open question answers it (a number or an
  option's label picks the option). Approvals are posted as "answered in Zomfy only" and no reply
  answers them.
- **Replies.** 👀 on the asking comment (or the issue) from `turn-started` until the reply or
  `turn-ended`; the reply is one comment, with "asked by … via …" (Orca's `askedByLine`) for the
  non-owner askers since the last reply. On a pull request, review notes with a line make one
  `COMMENT` review (notes without a line go in its body); GitHub refusing it (422) falls back to
  one comment. Calls go through the outbound queue, one lane per issue, waiting out 429/403
  `Retry-After` and spent rate limits.
- **Tokens.** The JWT is RS256 (PKCS#1 keys are wrapped for WebCrypto), issued a minute back and
  valid 9 minutes; installation tokens are kept in memory only and used until 10 minutes before
  they expire, so the Hub's storage never holds one.
- **PR events.** For pull requests whose author is a bot's GitHub owner, from the same repository
  (no forks): `check_run` failures are `check_failed` (remembered per check), a later success of the
  same check `check_passed`; comments, review comments and reviews without a mention, and
  `merged`, `closed`, `reopened`. One `pr_event` per host, to the owner's default bot there; it
  carries `actor`, `check`, `reviewState`, `url`, `text` and `ref`.
- **Triggers.** Every kind above is mapped from the webhook events (`pr_conflicted` only when a
  `pull_request` payload already says `mergeable_state: dirty`). Places match by repository,
  whatever the installation. The rules of the asked bot that the same event matches go in the
  `start`/`send` as `ruleIds`.
- **Actions.** `reply`/`post` (a comment, once per idempotency key), `react`, `read` (the issue and
  its comments), `edit`, `delete` (comments) and `check` (a pull request's state and check runs).
- Tested in workerd against a fake GitHub API (`apps/relay/test/github.test.ts`).

The daemon's part followed with phase B2: `pr_event` reaches the worker chat on that branch
(tested in the daemon), and the owner's answer to an access request is commented on the issue it
was asked on.

Left: the end-to-end check on a test repository.

# Non-goals

- A shared Zomfy GitHub App; GitHub Enterprise Server; Discussions.

# Acceptance

- Worker tests with recorded webhook fixtures: signature accept/reject; a duplicate delivery id
  ignored; a mention by an asker becomes `start`, by a non-asker a public note and no delivery.
- Worker test with GitHub's API mocked: a reply with 3 review notes posts one review; installation
  token fetched once per hour.
- Daemon test: `pr_event check_failed` reaches the worker chat on that branch and commit.
- Trigger matcher tests: owner's `pr_opened` fires only with `fromOwner`; owner's comment fires
  nothing; `ci_failed` fires whoever pushed.
- End to end on a test repo: a mention on an issue gets one reply comment by the app.

# Open questions

None for the person.

[^orca-conn]: Orca Bots connectors page
[^orca-cc]: Orca's `pr-event-messages.ts`, `connector-limits.ts`, `bot-owner-writes.ts`
[^orca-triggers]: Orca's `automation-github-triggers.ts`, `automation-event-triggers.ts`, `own-pr-trigger-guard.ts`
[^gh-webhooks]: GitHub webhook validation and handling documentation
