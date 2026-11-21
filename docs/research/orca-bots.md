# Orca Bots, and a self-hosted equivalent for Zomfy

Research note, 2026-11-21. Sources are Orca's public docs and the `stablyai/orca` repository at `main`
(read through `gh api`). Short names used below:

| Tag | Source |
| --- | --- |
| [HOME] | <https://orca.dev/bots> |
| [QS] | <https://orca.dev/docs/bots> (quickstart) |
| [SEC] | <https://orca.dev/docs/bots/security> |
| [CONN] | <https://orca.dev/docs/bots/connectors> |
| [IMP] | <https://orca.dev/docs/bots/import> |
| [AUTO] | <https://orca.dev/docs/cli/automations> |
| [REM] | <https://orca.dev/docs/remote-servers> |
| `cc/<file>` | `cloud/packages/connector-contract/src/<file>` in [stablyai/orca](https://github.com/stablyai/orca/tree/main/cloud/packages/connector-contract/src) |
| `desk/<file>` | `src/main/connector-cloud/<file>` in [stablyai/orca](https://github.com/stablyai/orca/tree/main/src/main/connector-cloud) |
| [CLOUD-README] | [`cloud/README.md`](https://github.com/stablyai/orca/blob/main/cloud/README.md) |

Cloudflare, Slack, GitHub and Linear facts are linked inline where they are used.

---

## 1. What Orca Bots does for the user

### 1.1 A bot

- A bot is a named agent with a picture and an optional purpose, living in **one folder on one
  computer** (yours, or a server paired with Orca). It runs on that computer's own Claude Code or
  Codex sign-in, so its work counts against the plan the person already pays for [QS] [SEC] [HOME].
- The bot's home folder holds `SOUL.md` ("who you are and how you work"), `MEMORY.md` ("one line per
  fact, newest first", with longer notes in `memory/<topic>.md`), and an `AGENTS.md` / `CLAUDE.md`
  that point the agent at both; Orca rewrites `AGENTS.md`, `CLAUDE.md` and `bot.json` itself
  ([`src/main/bots/bot-home.ts`](https://github.com/stablyai/orca/blob/main/src/main/bots/bot-home.ts),
  [`src/shared/bot-soul.ts`](https://github.com/stablyai/orca/blob/main/src/shared/bot-soul.ts)).
  The first non-heading paragraph of `SOUL.md` is shown as the bot's description.
- Memory: "keeps what it learns in its memory, so you can start a new chat for each job" [QS]. A
  nightly **memory tidy-up** run proposes changes and runs no commands; the person can review them
  [SEC] (`src/main/bots/bot-memory-tidy-up*.ts`). Rules: never save a secret, and never save an
  instruction that came from mail, messages, issues, files or webhooks [SEC].
- A person chats with the bot in Orca (sidebar, or `@bot` in any chat) [QS].

### 1.2 Entry points

| Place | How a person asks | Identity the bot posts as |
| --- | --- | --- |
| Slack | `@bot-name` in a channel or a DM. **Each bot is its own Slack app**, created by Orca Cloud from a pasted Slack *App Configuration Token* (refresh token `xoxe-…`) [CONN]; the token is "spent at once and never stored" (`cc/slack-grant-messages.ts`). | The bot's own app |
| GitHub | Mention the bot on an issue or PR after installing the shared **Orca GitHub App** on chosen repos and turning the bot on [CONN]. Bots that share one app are named by a handle (`@Orca reviewer`) (`cc/hello-messages.ts`). | Orca app for replies in place; the person's own `gh` sign-in for other work [CONN] [SEC] |
| Linear | `@Orca <handle>` on an issue, or the label `bot:<handle>` [CONN]. | Orca app; new comments get an "asked by … via …" line [SEC] |
| Webhook | One HTTP call to a URL the bot minted; body handed to the bot "as information, not instructions" [CONN]. | — |
| Google (Gmail, Calendar) | Not a place to ask; only starts automations. Uses the person's own Google Cloud app, checked on the computer about once a minute [CONN]. | — |
| Phone | Orca mobile app: a "Needs you" list to answer, approve or start jobs [HOME]. | — |

The contract also lists `discord` as a source (`cc/connector-wire-scalars.ts`), not yet documented.

**Who can ask.** By default only the owner; the owner adds people per source ("Who can ask") [QS]
[SEC]. The cloud checks this before a request reaches the computer [SEC]; the rule is "the bot's
owner, and the members they added with the same rights" (`cc/bot-askers.ts`). Someone not on the
list gets a note asking them to ask the owner (private on Slack, public on GitHub/Linear) and can send
an **access request** the owner reviews in Orca (`cc/access-request-messages.ts`). Messages from
non-members in a thread the bot is in are kept as context but cannot start or steer work [SEC].

### 1.3 How a bot picks a repo / worktree

- The bot's own chat runs in its home folder. Code work is handed to a **worker**: a Claude Code or
  Codex session in a new git worktree under the bot, never the person's checkout; changes come back as
  a branch and PR [QS] [SEC] [HOME].
- The docs do not say how a Slack mention chooses a repo; the bot decides from context. On the wire a
  `start` delivery carries a `placeId`, opaque to the cloud: "the machine encodes [repoHostId,
  repoId], or a folder's project group" (`cc/connector-wire-scalars.ts`), and on the desktop "a place
  is the bot home a connector start runs in" (`desk/connector-places.ts`). So the cloud never picks a
  repo; the desktop routes a conversation to a bot home and the bot spawns workers where needed.
- Automations take `--repo` or `--workspace` targets [AUTO].
- GitHub `pr_event` deliveries (check failed, review, merged…) for a PR the owner opened are matched
  **by the desktop** "to the worker whose workspace is that branch at that commit"
  (`cc/pr-event-messages.ts`), which is how "come back to a tested pull request" closes the loop.

### 1.4 Threads and replies

- "A bot answers where it was asked": the Slack thread, issue or PR [CONN].
- One external conversation (`{source, externalId}`) is linked to one Orca chat ("pane"); the
  `linked` / `unlinked` / `acts-for` events record that, and a deleted chat makes the cloud release the
  thread (`chat_gone`) (`cc/event-messages.ts`, `cc/delivery-messages.ts`).
- A `start` opens a new chat; a `send` adds to the linked one. Sends queued behind a running turn may
  arrive batched and run as one turn (`batchedSends` feature, `cc/hello-messages.ts`).
- Context: the cloud sends what came before in the thread, labelled per item (`earlier`, `no_access`,
  `issue`, `bot`, `more`, `unreadable`) and, for a bare `@bot` mention, the asker's own earlier
  messages as the request (`cc/delivery-messages.ts`, `cc/earlier-own-messages.ts`).
- While a turn runs, the desktop streams `turn-started`, `activity` ("Running pnpm test", plan steps,
  ≤120 chars, ≤20 steps), `workers` (sub-agents still running) and `turn-ended`; the answer goes as a
  `reply` with an outcome (`answered`, `quiet`, `no_answer`, `interrupted`, `failed`, `cancelled`, …)
  and up to 5 PR links (`cc/event-messages.ts`, `cc/connector-limits.ts`). A reply can carry inline
  PR review notes (≤30) posted as one GitHub review.
- Beyond replying, a bot can act in a source through shared verbs on `/v1/connector/actions`:
  `reply, react, read, post, find, check, edit, delete, attach, set` plus Slack pins/canvases/lists and
  scheduled posts (`cc/action-messages.ts`). Posts carry an idempotency key.

### 1.5 Questions and approvals back to the person

- When the bot needs a decision, sign-in or approval "the request waits under Needs you until you
  answer" [QS]. "When the bot asks for approval, whoever asked it can approve." [SEC]
- Permission modes: Ask for approval, Accept edits, Approve for me, Full access (default for chats);
  Ask for approval is recommended for bots others can ask [SEC].
- On the wire, the desktop reports a pending `prompt` of kind `approval` (tool, summary, options),
  `question` (text, header, options) or `unsupported` (answerable only in Orca, with a ≤1500-byte
  text for a card linking back) (`cc/event-messages.ts`). The cloud renders buttons in Slack; a press
  comes back as an `answer` delivery with `optionId`, or — for a single free-text question shown
  `byReply` — the owner's thread reply as `text` (≤4000 chars) (`cc/delivery-messages.ts`). A Stop
  button arrives as `cancel` naming the turn.

### 1.6 Schedules, triggers, webhooks

- Schedules: hourly, daily, weekdays, weekly, cron, RRULE; the person can ask the bot in chat
  ("every weekday at 9") and it creates the automation [QS] [AUTO]. They run on the computer, only
  while awake, with a missed-run grace [AUTO]. A scheduled "looking around" run is read-only [SEC].
- Event triggers [CONN]: GitHub (issues/PRs opened, pushes, comments, reviews, review requests,
  labels, CI failing/passing, conflicts, merges, deploys, security alerts, workflow runs finished),
  Linear (assigned, mention, new issue, moved), Slack (e.g. "when someone posts in #eng"), Gmail,
  Calendar. The owner's own GitHub actions do not start the bot, except a rule for PRs the owner
  opened (`fromOwner`) [CONN] (`cc/trigger-messages.ts`, `desk/own-pr-trigger-guard.ts`).
- **Rules live on the desktop and are uploaded in every `hello`** (`triggers`, ≤100 rules, ≤10
  places each); the cloud matches source events against them and queues a `trigger` delivery that
  waits up to the automation's grace (≤24 h) (`cc/hello-messages.ts`, `cc/trigger-messages.ts`,
  `cc/connector-limits.ts`). A message that both asks the bot and matches a rule runs the rule inside
  that turn (`triggerInTurn`). Google rules never leave the computer (`desk/connector-triggers.ts`).
- Webhooks: the cloud mints a hook id and a 256-bit key; callers POST to `<base>/hooks/<hookId>` with
  the key as Bearer (or in the path); an optional signing secret; native signature checks
  for some known senders; body ≤1 MiB, credentials and signature headers stripped, key text redacted
  anywhere it is echoed; bodies kept ≤7 days; the desktop fetches each call and reserves a run start
  (`cc/webhook-names.ts`, `cc/webhook-envelope.ts`, `cc/webhook-routes.ts`, `cc/webhook-messages.ts`)
  [SEC].

### 1.7 Security model (as documented)

- Runs on one computer as the person, within the chosen permission mode; what the bot reads goes to
  the agent's model provider [SEC].
- Orca Cloud holds: the encrypted Slack configuration grant, recent thread messages used as context,
  undelivered requests, webhook bodies ≤7 days [SEC]. The computer "connects out", so no open port
  [CONN].
- Enforced by Orca: Who-can-ask check in the cloud; read-only look-around; tool-less memory tidy-up;
  "asked by" attribution lines; explicit Create bot. Only *told* to the bot: don't merge unless asked,
  draft rather than send mail, treat others' content as information, never save secrets [SEC]. Orca
  states none of this is a guarantee [SEC].
- Local secrets (Google, Composio) in the OS keychain, else a 0600 file [SEC]. A Linear connect hands
  the person's own Linear login to the desktop sealed to an X25519 key only that desktop holds, so the
  cloud keeps ciphertext it can't open (`cc/connect-login-seal.ts`).

### 1.8 Pairing and offline behaviour

- There is no separate pairing step for bots: the desktop **signs in to Orca** and mints a 5-minute
  *connector token* from Orca's auth service, identifying the user and the per-install machine id
  (`sub`, `mid`); a per-install host key proves the mint comes from that machine
  (`cc/connector-endpoints.ts`, `desk/connector-token-mint.ts`, `desk/connector-host-key.ts`).
- Linear/GitHub accounts are linked in one browser trip ending at a loopback
  `http://127.0.0.1:<port>/connector/done` or an `orca://` deep link (`cc/connect-messages.ts`).
- An always-on bot runs on a server paired with Orca (Remote Orca Servers, beta, over a private
  network such as Tailscale) [QS] [REM].
- Offline: "a person's request waits up to a day and then runs when it's back" [CONN]; answers and
  cancels live 5 minutes (`MACHINE_WAIT_MS`, `deliveryTtlMs` in `cc/connector-limits.ts`). The
  delivery carries `askedAt` so the agent can say how long it waited. Signed out, events pause [CONN].

---

## 2. Architecture

```
 Slack / GitHub / Linear / webhook callers
            │  HTTPS webhooks (signed)
            ▼
 ┌────────────────────────────┐      Orca auth service mints 5-min connector tokens
 │ Orca Cloud "connector"     │◀──── (closed source; Cloud Run per a comment in
 │ (closed source)            │       cc/connector-limits.ts)
 │ - verifies source events   │
 │ - Who-can-ask, rule match  │
 │ - per-machine delivery queue (≤24 h)
 │ - posts to Slack/GitHub/Linear as the bot
 └────────────▲───────────────┘
              │ outbound HTTPS only: hello, long-poll, acks, events, replies, actions
 ┌────────────┴───────────────┐
 │ Orca desktop / `orca serve`│ bots, SOUL/MEMORY, chats, automations, workers in worktrees
 └────────────────────────────┘
```

[CLOUD-README] confirms the split: `connector-contract` is "the wire contract between Orca and the
connector service … The hosted service is run by Orca and is not in this repository". The open
`cloud/` folder holds only the mobile relay and push gateway.

### 2.1 Transport: HTTP long-poll, not WebSocket

All connector routes are plain HTTPS with `Authorization: Bearer <connector token>`; 401 means mint a
new token (`cc/connector-endpoints.ts`):

| Route | Role |
| --- | --- |
| `PUT /v1/connector/hello` | Machine announces itself: contract version, host, runtime, `features`, `sources`, `promptKinds`, its **bots** (≤20 per hello, more via `bot-pages`) and **trigger rules**. Cloud answers a monotonically increasing `helloRev` and its own `features`. Everything else carries `helloRev`; a stale one gets 409 `hello_required`. |
| `POST /v1/connector/poll` | Held ~50 s (machine abandons at 70 s). Returns ≤20 deliveries / ≤8 MiB, plus on the first poll after a hello the `unsettled` list, and an optional control (`stop`, `pausedForMs`, `reconnect`). |
| `POST /v1/connector/acks` | Two acks per delivery: `received` (after a durable local receipt) then `done` with an outcome (`accepted`, `refused`, `unknown`, `expired`, `unsupported`). An un-received delivery is re-sent with the same id after a 30 s lease. |
| `POST /v1/connector/events` | Ordered batches (`seq` from 0 per hello, idempotent retry) of chat state: `snapshot`, `linked`, `prompt`, `turn-started`, `activity`, `workers`, `turn-ended`, `reply`. |
| `POST /v1/connector/replies` | Posting a turn's answer (older path; newer machines use `reply` events through an outbox). |
| `POST /v1/connector/actions` | Shared verbs (`reply`, `react`, `read`, `post`, `find`, …) and capability queries. |
| `/v1/connector/bots/<id>/slack…`, `/slack/grants`, `/linear…`, `/github…`, `/access-requests`, webhook routes | Setup and management. |

Limits are in `cc/connector-limits.ts`; the contract is versioned (`CONNECTOR_CONTRACT_VERSION = 1`)
and evolves through feature lists both sides advertise, with unknown fields ignored.

### 2.2 The contract, file by file

| File | Role |
| --- | --- |
| `index.ts` | Re-exports everything. |
| `connector-endpoints.ts` | Route paths, auth rule, error codes (`invalid_token`, `hello_required`, `grant_expired`, `unknown_bot`, …), contract version. |
| `connector-limits.ts` | Every size, count and timeout (poll hold, leases, 24 h wait, message caps). |
| `connector-wire-scalars.ts` | `PlaceId`, host description (`serve` / `desktop`), sources (`slack, discord, linear, github, webhook`), conversation id, acts-for. |
| `hello-messages.ts` | Hello request/response, bot schema (id, name, agent, members, paused, handle, per-workspace members), machine and cloud feature flags. |
| `delivery-messages.ts` | Poll request/response; deliveries `start`, `send`, `answer`, `cancel`, `trigger`, `webhook_notice`, `pr_event`; the `asker` (who, role, place, text, context, links); acks and outcomes. |
| `event-messages.ts` | Machine→cloud events: pending prompts (approval / question / unsupported), turn lifecycle, activity, workers, snapshot, replies with outcomes, PR links and review notes. |
| `action-messages.ts` | The verbs a bot uses inside a source, refs (`slack:T:C:thread:ts`, `github:<inst>:<repo>:<n>`, `linear:<org>:…`), file upload/download, Linear issue fields. |
| `trigger-messages.ts` | Automation rules (source, kinds, places, `from`, `fromOwner`, label, workflow run, grace, `inThread`) and the matched event. |
| `pr-event-messages.ts` | Events on PRs the owner opened (check failed/passed, comment, review, merged, closed). |
| `webhook-*.ts` | Hook ids and keys, key redaction, routes, stored-call envelope, filters/matcher, notices. |
| `slack-bot-messages.ts`, `slack-grant-messages.ts`, `slack-bot-handoff-messages.ts` | Creating each bot's own Slack app from a config token, install links (30 min), handing app creation to another account. |
| `github-messages.ts`, `linear-messages.ts`, `linear-issue-names.ts`, `connect-messages.ts`, `connect-login-seal.ts` | Linking GitHub/Linear identities and installs in one browser trip; Linear login sealed to the desktop. |
| `access-request-messages.ts`, `bot-askers.ts` | Request-access flow; the single who-may-ask rule. |
| `earlier-own-messages.ts`, `failure-messages.ts` | Bare-mention context; typed failure reasons (usage limit with reset time, agent error, lost track). |

### 2.3 Desktop side

`src/main/connector-cloud/` is the client: `connector-poll-client.ts` ("one held poll, two
confirmations per delivery, and turn events back"), `connector-hello.ts`, `connector-deliveries.ts`
(maps each delivery onto a local "seam" call, writing a receipt before acking `received`),
`connector-outbox.ts` (FIFO, exponential backoff 1–30 s, Retry-After honoured, halves oversize
batches), `connector-reply-outbox.ts` and `connector-turn-outbox-file.ts` (answers survive a quit),
`connector-snapshot.ts` (restates active conversations after every hello),
`connector-triggers.ts`, `connector-token-mint.ts`, `connector-host-key.ts`. The design point worth
copying: **every hop is idempotent and resumable** (delivery ids, receipts, `unsettled` list,
`seq`-numbered event batches, post idempotency keys).

---

## 3. Proposed design for Zomfy: a connector you deploy to your own Cloudflare account

### 3.1 Goals

- Open source, one deployment per person (or team), in **their own Cloudflare account**; nothing
  hosted by the Zomfy project.
- The daemon connects **out**; no open ports, works behind NAT, on WSL and SSH hosts.
- Requests wait while the computer is asleep (Orca's 24 h is a good default).
- Reuse Zomfy's chats, workspaces, automations, AskUserQuestion answers and approvals rather than
  building a parallel "bot" runtime.

### 3.2 Components

```
Slack Events API / Interactivity ─┐
GitHub App webhooks ──────────────┼─▶ Worker (fetch handler)
Linear webhooks ──────────────────┘     │ verify signature, dedupe, ack < 3 s
                                        │ ctx.waitUntil / DO call
                                        ▼
                               Durable Object "Hub" (one per deployment, SQLite storage)
                               - deliveries queue (pending → leased → done), 24 h expiry via alarm
                               - conversation ↔ Zomfy session links
                               - who-can-ask, bot config, rule table
                               - hibernatable WebSocket to each paired daemon
                                        ▲
                                        │ wss://<worker>/v1/daemon  (outbound from daemon)
                               Zomfy daemon: `connector-client.ts`
                               → creates/sends to sessions, forwards prompts & replies
```

- **Worker** (`apps/connector/src/index.ts`): routes `/slack/events`, `/slack/interactivity`,
  `/github/webhook`, `/linear/webhook`, `/hooks/:id`, `/v1/daemon` (WebSocket upgrade),
  `/v1/pair`. It verifies each source's signature, then hands the event to the Hub DO and returns
  200 immediately.
- **One Durable Object, SQLite-backed** ("Hub"), named by a fixed id. A single person's traffic is
  tiny, so one object gives strict ordering and transactions without D1. KV and Queues are not
  needed for the MVP; D1 only if a team deployment later wants cross-object queries.
- **Outbound calls** (Slack `chat.postMessage`, GitHub REST, Linear GraphQL) are made by the Hub when
  the daemon sends a reply, so source tokens stay in Cloudflare secrets and never reach the desktop
  — the same split Orca uses.

### 3.3 Daemon ↔ connector protocol

Use a **WebSocket with Durable Object hibernation** instead of Orca's long-poll: the Hub can push a
delivery the moment Slack sends it, and while the socket is idle the object hibernates and incurs no
duration charge. Keep Orca's message semantics, which solve the hard parts:

| Daemon → Hub | Hub → Daemon |
| --- | --- |
| `hello {contract, hostName, features, bots[], rules[]}` → `helloRev` | `delivery {id, kind: start\|send\|answer\|cancel\|trigger, conversation, asker, text, askedAt, expiresAt}` |
| `ack {deliveryId, step: received\|done, outcome}` | `unsettled [ids]` after each hello |
| `event {seq, kind: linked\|prompt\|turn-started\|activity\|turn-ended\|reply}` | `control {stop\|reconnect}` |
| `action {verb: post\|react\|read, ref, idempotencyKey}` → result | |

- On (re)connect the daemon sends `hello`; the Hub replays every delivery not yet `done` (lease and
  redeliver with the same id, as Orca's 30 s lease). The daemon writes a receipt (SQLite, as the
  daemon already uses `bun:sqlite`) before `received`, so a crash never runs a request twice.
- Events are numbered per hello so retries are idempotent; replies carry an idempotency key so a
  Slack message is posted once.
- Heartbeats: WebSocket ping frames, which the runtime answers without waking a hibernated object
  (§3.8); reconnect with backoff on close.
- Put the message schemas in a new `packages/connector-contract` (zod, imported by both the Worker
  and the daemon), mirroring Orca's split; the Worker bundles it (wrangler's esbuild does), and a
  Deploy-button build needs it vendored (§3.8).

### 3.4 Pairing and auth (no account service)

There is no Orca auth service to mint tokens, so pairing is a shared secret set at deploy time:

1. `bun run deploy` (or the Deploy button) generates `PAIRING_SECRET` and stores it with
   `wrangler secret put`.
2. The person pastes the Worker URL and the pairing code into Zomfy → Settings → Bots (new). The
   daemon calls `POST /v1/pair` with the code and an Ed25519 public key it generated; the Hub stores
   the key and burns the code.
3. Each WebSocket connect is authenticated by a signed challenge (nonce from the Hub, signature by
   the daemon's key), or by a short-lived token the Hub mints after a signed `POST /v1/token`. The
   private key stays in the harness home (`~/.acp-harness/connector-key`, mode 0600), like Orca's
   host key. Revoking a machine = deleting its key row.
4. Several daemons (laptop, WSL, an always-on server) can pair; each `hello` lists the bots it hosts
   and the Hub routes a bot's deliveries to the machine that hosts it.

### 3.5 Setup the person does

**Cloudflare** (once): a free account; `bunx wrangler login`; `bun run deploy` from
`apps/connector`, or the "Deploy to Cloudflare" button (`https://deploy.workers.cloudflare.com/?url=<repo-subdir-url>`),
which clones the repo into the person's own GitHub and provisions the bindings declared in
`wrangler.jsonc` (Durable Object class and migration), asking for the secrets named in
`.dev.vars.example` (§3.8). `bun run deploy` does the same with `wrangler deploy` and
`wrangler secret put`.

**Slack** (MVP): one Slack app per deployment (not per bot, which Orca does with configuration
tokens — too much setup for a self-hoster):

1. api.slack.com → Create New App → create it by pasting a manifest, paste `apps/connector/slack-manifest.yaml`
   with the Worker URL filled in (the deploy script prints it ready to paste). Scopes:
   `app_mentions:read`, `chat:write`, `channels:history`, `groups:history`, `im:history`,
   `im:read`, `im:write`, `reactions:write`, `users:read`; events `app_mention`, `message.im`
   (and `message.channels` for thread follow-ups); interactivity URL `/slack/interactivity`.
2. Install to the workspace; copy the **Bot User OAuth Token** (`xoxb-…`) and the **Signing Secret**
   into `wrangler secret put SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET`.
3. In Zomfy, add your Slack user id to the bot's Who can ask (the owner).

**GitHub** (phase 3): create a GitHub App from a manifest (the deploy script can open the
`/settings/apps/new?manifest=` flow), permissions Issues R/W, Pull requests R/W, Checks R, Contents
R, Metadata R; events issue_comment, pull_request, pull_request_review, check_suite/check_run;
webhook URL `/github/webhook`. Secrets: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_WEBHOOK_SECRET`. The Worker signs a JWT with the private key and exchanges it for 1-hour
installation tokens. Code work still uses the person's own `gh` sign-in on the daemon host.

**Linear** (phase 4): Settings → API → create an OAuth application with actor=app (or a personal
API key for a single user) and a webhook to `/linear/webhook`; secrets `LINEAR_TOKEN`,
`LINEAR_WEBHOOK_SECRET`.

### 3.6 Secrets

All in Cloudflare Worker secrets: `PAIRING_SECRET` (burned after first pair), `SLACK_BOT_TOKEN`,
`SLACK_SIGNING_SECRET`, `GITHUB_APP_*`, `LINEAR_*`. The Hub stores only paired daemons' public keys,
in-flight deliveries and conversation links. Nothing secret goes to the daemon. Webhook keys follow
Orca's shape (random 256-bit, prefixed so redaction can find them).

### 3.7 Mapping onto Zomfy

| Orca Bots concept | Zomfy piece |
| --- | --- |
| Bot | A new **bot** record in the daemon (`bot-store.ts`): name, agent, permission mode, home workspace, Who can ask, enabled. Its home is a Zomfy **workspace** (a folder or worktree) holding `SOUL.md`, `MEMORY.md`, `AGENTS.md`. |
| Conversation → chat | A Slack thread maps to one Zomfy **session** in the bot's home workspace (`createSession`, then `runTurn`). The link `{source, externalId} ↔ sessionId` lives in the Hub and in the daemon. A `send` is another turn in the same session. Add `origin: 'connector'` beside the existing `origin: 'workflow'` in `packages/protocol/src/sessions.ts` so the sidebar can group them. |
| Worker in its own worktree | The bot's chat uses the existing manager tools (`create_workspace`, `create_session`, `send_prompt`, `wait_for_session`) and `split_work`; workspace and worktree rules (`worktree-claims.ts`, `worktree-finish.ts`) already give "one chat, one worktree" and PR finishing. |
| Questions (AskUserQuestion) | `ask-user-question.ts` already turns the tool into a permission ask with `QUESTION_OPTIONS`; the connector renders the question and its options as Slack buttons, and an `answer` delivery becomes the `RequestPermissionResponse` with `CHAT_META.answers`. |
| Approvals | Pending permission asks (what `list_approvals` / `answer_approval` already read) are mirrored as Slack buttons; only the asker or owner may press them (check the Slack `user.id` in the interaction payload). |
| "Needs you" | `forward_to_person` and the todo inbox; anything the connector can't render goes there with a link (Orca's `unsupported` prompt). |
| Schedules | Existing **automations** (`automation-service.ts`, RRULE presets). Add `botId` to an automation so a scheduled run uses the bot's home, persona and answer place (e.g. post to a Slack channel). |
| Event triggers | New `AutomationTrigger` kinds (`slack-message`, `github-event`, `webhook`) whose rules the daemon sends in `hello`; the Hub matches and queues a `trigger` delivery. |
| Manager agent | The bot's chat can be a manager-role session so it can delegate across hosts; the routing note in `manager-routing.ts` (manager calls run in a desktop window) means **a bot that delegates needs a window, or the routing must gain a daemon-side path** — an open design question. |
| Unattended guard | `refuseUnattended()` (`chat-agent-launch-specs.ts`) already refuses guarded agents (`antigravity`) for automations; apply it to bots too. |
| Usage-limit pause | `turn-auto-resume.ts` already resumes after a usage limit; report it as Orca's "paused, resumes at …" reply. |

Alternative worth noting: Slack **Socket Mode** lets the daemon talk to Slack with no public URL at
all. It removes Cloudflare for Slack-only use but loses queueing while the computer sleeps, and
GitHub/Linear webhooks still need a public endpoint. The Cloudflare connector is the better base;
Socket Mode could be an offline-free "local only" option later.

### 3.8 Cloudflare and source limits that shape the design

| Limit | Value | Consequence for the design |
| --- | --- | --- |
| Slack Events API ack | 2xx within **3 s**, else retried 3 times (≈ immediately, 1 min, 5 min) with `x-slack-retry-num` ([Events API](https://docs.slack.dev/apis/events-api/)) | The Worker verifies, writes the event into the Hub, and returns 200; it never waits for the daemon. Dedupe on `event_id` in the Hub so retries don't start a second turn. |
| Slack signing | `v0:<timestamp>:<raw body>` HMAC-SHA256 with the signing secret in `X-Slack-Signature`; reject timestamps > 5 min off ([verifying requests](https://docs.slack.dev/authentication/verifying-requests-from-slack)) | Read the raw body before parsing; WebCrypto HMAC. |
| Slack interactivity | 200 within **3 s**; `response_url` usable 5 times within 30 min ([handling interaction](https://docs.slack.dev/interactivity/handling-user-interaction)) | Ack the button press at once, queue an `answer` delivery, update the message later with `chat.update` (Tier 3, ~50/min — [chat.update](https://docs.slack.dev/reference/methods/chat.update)). Throttle `activity` edits to one every few seconds per thread. |
| `chat.postMessage` | ~1 message/s per channel ([chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage)) | Post the reply once per turn; split long answers. |
| Slack Socket Mode | Not allowed in the public Slack Marketplace; ≤10 connections per app ([Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode)) | Fine for a self-hosted internal app, so the "local only" alternative is viable; still no offline queue. |
| GitHub webhook | 2xx within **10 s**; `X-Hub-Signature-256` HMAC ([handling deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-webhook-deliveries), [validating](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)); installation tokens live 1 h, JWT RS256, `exp` ≤ 10 min ([installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), [JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)) | Cache the installation token in the Hub for under an hour; don't assume a 40-char token. |
| Linear webhook | 200 within **5 s**; 3 retries (1 min, 1 h, 6 h); `Linear-Signature` HMAC; reject `webhookTimestamp` older than ~1 min ([Linear webhooks](https://linear.app/developers/webhooks)) | Same ack-then-queue path. |
| Workers CPU | Free **10 ms** per request; Paid 30 s default, up to 5 min ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)) | CPU excludes time waiting on I/O, so verify-and-forward fits the free plan; keep heavy work (Block Kit rendering, JSON parsing of large threads) small. Free plan: 100,000 requests/day, 50 subrequests per invocation — ample for one person. |
| Durable Objects | On the Free plan with SQLite storage only; 30 s CPU per request or WebSocket message (resets per message); 32 MiB received WebSocket message; 1 GB per object on Free ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) | Use the SQLite backend from day one (`new_sqlite_classes` migration). A single Hub object is far below every cap. |
| WebSocket hibernation | Accept with `ctx.acceptWebSocket()`; handlers `webSocketMessage` / `webSocketClose`; no duration charge while hibernated; **in-memory state is lost** on hibernation, the constructor runs again; per-socket `serializeAttachment` ≤ 16 KiB; incoming ping frames get an automatic pong without waking; timers and alarms keep the object awake ([DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)) | Keep everything that matters (deliveries, leases, `helloRev`, which machine a socket is) in SQLite or the socket attachment, never in fields. Use WebSocket ping frames for keep-alive, not app-level pings. Don't use `setTimeout` for leases; use the alarm. |
| DO alarms | One alarm per object; `setAlarm` replaces it; failed `alarm()` retried with backoff up to 6 times ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)) | Store due times in a table and set the alarm to the earliest (lease re-sends, 24 h expiry, 7-day webhook purge). |
| Queues / KV / D1 | Queues on Free with 24 h retention; KV Free 1,000 writes/day; D1 Free 500 MB per DB ([Queues](https://developers.cloudflare.com/queues/platform/limits/), [KV](https://developers.cloudflare.com/kv/platform/limits/), [D1](https://developers.cloudflare.com/d1/platform/limits/)) | Not needed: the Hub's SQLite is the queue. KV's write cap rules it out for per-event state. |
| Cron Triggers | Free 5 per account ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)) | Schedules stay on the daemon (as Zomfy's automations already are); the connector needs no cron. |
| Deploy button | `https://deploy.workers.cloudflare.com/?url=<repo>`; clones the repo into the person's GitHub/GitLab (public repo only), provisions DOs/D1/KV/Queues from the wrangler config, asks for secrets listed in `.dev.vars.example`; a subdirectory works only if **fully self-contained, dependencies included** ([deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)) | `apps/connector` must build on its own: vendor or bundle the shared contract instead of a `workspace:*` dependency, or publish the button from a separate template repo. Ship a `.dev.vars.example` listing `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `PAIRING_SECRET`. |

---

## 4. Phased plan

Each part names its files so parts can run in parallel worktrees. Shared contract first.

### Phase 0 — contract (do first, alone)

- `packages/connector-contract/` (new package): zod schemas for hello, delivery, ack, event, action;
  limits; contract version. Test: `bun test` round-trips fixtures; a fixture per message kind.
- `packages/protocol/src/bots.ts` (new): `Bot`, `BotInput`, `BOT_METHODS` (`_harness/bots/*`),
  connector status. Additions only to `index.ts`.

### Phase 1 — MVP: Slack, one bot, one paired daemon

| Part | Files | Test |
| --- | --- | --- |
| A. Connector Worker | `apps/connector/` (new): `wrangler.jsonc`, `src/index.ts` (routes), `src/slack-verify.ts`, `src/hub.ts` (DO: deliveries table, alarm expiry, hibernatable socket, replay), `src/slack-post.ts`, `src/pair.ts`, `slack-manifest.yaml`, `scripts/deploy.ts` (`bun run deploy`: creates secrets, prints URL + pairing code + filled manifest). | `vitest` with `@cloudflare/vitest-pool-workers` (runs Workers + DOs in workerd): signature accept/reject, duplicate Slack retry ignored, delivery replay after reconnect, expiry after 24 h via alarm, owner-only check. `wrangler dev` + a fake daemon script. |
| B. Daemon client | `packages/daemon/src/connector-client.ts` (WebSocket, hello, backoff, receipts in SQLite), `connector-deliveries.ts` (start → `createSession` + `runTurn`; send → `runTurn`; cancel → stop turn), `connector-replies.ts` (turn end → last assistant message → `reply` event), `bot-store.ts`, `handlers/bot-handlers.ts`. | `bun test` against an in-process fake Hub (Bun WebSocket server speaking the contract): delivery runs one turn once across a simulated crash; reply sent once; refused when bot disabled; guarded agent refused. |
| C. Desktop UI | `apps/desktop/src/components/settings/BotsSettings.tsx` (new): connector URL + pairing code, connection status, one bot (name, agent, home workspace, Who can ask), `SOUL.md` / `MEMORY.md` open buttons; i18n additions in `apps/desktop/src/i18n/ja/` (append only). | `bun test` in `apps/desktop` for the store; manual run via CDP: pair, send `@bot` from Slack, see the chat appear. |

End-to-end check for the MVP: deploy to a test Cloudflare account, create the Slack app from the
manifest, `@bot fix the typo in README` in a DM → chat appears in Zomfy, reply lands in the thread,
computer asleep → message runs on wake.

### Phase 2 — questions, approvals, live status

- Hub: `prompt` events → Slack Block Kit buttons; `/slack/interactivity` → `answer` deliveries;
  Stop button → `cancel`; `activity` → edit a status message (rate-limited).
- Daemon: mirror pending permission asks and AskUserQuestion; apply `answer` as the permission
  response; send `activity` from tool-call updates.
- Test: fake-Hub tests for answer round-trip and stale answers (prompt already answered in the
  window); Workers tests for interaction signature and who may press.

### Phase 3 — GitHub App

- Hub: `/github/webhook` (HMAC), JWT + installation tokens, `issue_comment` mention → start,
  replies as PR/issue comments, `pr_event` for check failures on worker PRs.
- Daemon: map `pr_event` to the session whose workspace has that branch (worktree records already
  know branches).
- Test: recorded webhook fixtures; token exchange mocked with `fetchMock`.

### Phase 4 — triggers and webhooks

- Protocol: new `AutomationTrigger` kinds, `botId` on automations (additive).
- Hub: rule table from `hello`, matcher, `trigger` deliveries with grace; `/hooks/:id` with key +
  optional HMAC, body cap and header scrub, 7-day retention.
- Test: matcher unit tests (Orca's `webhook-matcher.test.ts` cases are a good checklist).

### Phase 5 — Linear, several bots, memory tidy-up

- Linear webhook + GraphQL comments; one Slack app per bot (optional, via manifest API) or handles
  in one app; nightly tool-less memory tidy-up automation that proposes a `MEMORY.md` diff.

### Open questions

1. Manager tools route through a desktop window today (`manager-routing.ts`); a bot running while
   no window is open needs a daemon-side route, or bots stay non-manager in the MVP.
2. One Slack app for all bots (simple setup, bots named by handle) vs one per bot (own name and
   avatar in Slack, needs a configuration token like Orca).
3. Team deployments: several people's daemons on one connector need per-user ownership — out of
   scope for the MVP.
