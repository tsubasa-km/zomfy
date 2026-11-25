---
type: Spec
title: Zomfy Bots
description: Named agents that live in a folder on the person's computer and can be asked from Zomfy, Discord, Slack, GitHub, Linear, webhooks and schedules, copied from Orca Bots.
status: stable
x-zomfy-implementation: in-progress
tags: [bots]
sources:
  - id: orca-bots
    resource: /research/orca-bots.md
    title: Orca Bots, and a self-hosted equivalent for Zomfy
  - id: orca-docs
    resource: https://orca.dev/docs/bots
    title: Orca Bots quickstart
  - id: person
    resource: "decisions given by the person on 2026-11-22"
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T03:21:28Z" }
---

# Problem

Zomfy's agents can only be asked from a Zomfy window. The person wants to ask an agent from where
the work is discussed (a Discord channel, a Slack thread, a GitHub PR, a Linear issue), from other
systems (a webhook), and on a schedule, and to get its questions and approvals back in the same
place. Orca Bots does this well; Zomfy copies it almost as-is, with every source Orca supports,
except that the cloud part is open source and runs in the person's own Cloudflare
account.[^person][^orca-bots] Orca has no Discord source yet ("Coming soon"), so Discord is
designed here to behave like Orca's Slack source.

# What a bot is

- A **bot** is a named agent with a picture and an optional purpose, living in **one home folder on
  one host** (a Zomfy workspace on this computer, WSL or an SSH host). It runs on that host's own
  Claude Code or Codex sign-in.[^orca-docs]
- The home holds `SOUL.md` (who it is and how it works) and `MEMORY.md` (what it has learned), plus
  `AGENTS.md` / `CLAUDE.md` that point the agent at both ([daemon](daemon.md)).
- Each conversation with the bot is a Zomfy chat in its home. Code work is handed to a **worker**: a
  chat in a new worktree, never the person's checkout, which comes back as a branch or PR.
- A bot answers where it was asked: the Zomfy chat, the Discord thread, the Slack thread, the issue
  or PR.

# User stories

1. In Zomfy, I create a bot "reviewer" with a home folder and talk to it from the sidebar, without
   any cloud set up ([desktop](desktop.md)).
2. I deploy Zomfy Relay to my Cloudflare account in a few minutes and pair Zomfy with it
   ([connector](connector.md)).
3. I mention `@reviewer` in a Discord channel or DM; a chat appears in Zomfy, live status shows in
   Discord, and the answer lands in the Discord thread ([Discord](sources/discord.md)).
4. When the bot needs a decision or an approval, buttons appear where I asked; I or whoever asked
   presses one, or answers in Zomfy, and the work goes on. A Stop button stops the turn.
5. My computer is asleep: the request waits up to a day and runs when it wakes.
6. Only the people I add to **Who can ask** can start or steer the bot; others are told to ask me
   and may send an access request.
7. "Every weekday at 9, summarise yesterday's merged PRs into #eng" becomes a schedule that posts
   in Discord or Slack ([daemon](daemon.md#schedules-and-triggers)).
8. A failed CI run on a PR the bot opened wakes the worker that owns that branch
   ([GitHub](sources/github.md)); a new Linear issue with `bot:reviewer` starts work
   ([Linear](sources/linear.md)); a monitoring system calls the bot's webhook URL
   ([webhooks](sources/webhooks.md)).

# Scope

| Spec | What it covers |
| --- | --- |
| [Connector](connector.md) | The Cloudflare Worker and Durable Object: routes, storage, delivery semantics, pairing, limits, deploy, secrets |
| [Contract](contract.md) | The messages between daemon and connector, in `packages/relay-contract` |
| [Daemon](daemon.md) | Bot records, deliveries to chats, replies, questions and approvals, schedules and triggers, SOUL/MEMORY |
| [Desktop](desktop.md) | Settings, the bot UI, and talking to a bot from Zomfy |
| Sources | [Discord](sources/discord.md), [Slack](sources/slack.md), [GitHub](sources/github.md), [Linear](sources/linear.md), [webhooks](sources/webhooks.md) |

The connector is the same Worker as the phone relay ([decision](../../decisions/one-relay-worker.md)).

# Non-goals

- A hosted service run by the Zomfy project, or any Zomfy account.
- Team deployments where several people's daemons share one connector with per-user ownership.
- Bots with manager powers (delegating across hosts, other projects' chats) in the MVP: manager
  calls run in a desktop window today, and MVP bots must work with no window open.[^person]
  The [master bot](master-bot.md) later added manager bots, whose manager calls still need a window.
- Gmail and Google Calendar triggers (Orca's local-only Google rules) — not in the requested source
  list; may follow later.
- One Slack app per bot: one Slack app per deployment, bots named by handle.[^person]

# Phases

Each phase ends with its acceptance checks passing. The shared groundwork comes first and alone.

| Phase | Delivers | First test path |
| --- | --- | --- |
| B0 Groundwork (done) | `packages/relay-contract`; `packages/protocol/src/bots.ts`; `apps/relay` with host registration and the `/v1/host` link (shared with the phone relay) and the delivery queue (lease, ack, re-send, expiry); the daemon's pairing, link and connector client | Contract fixtures round-trip; a fake daemon registers and says `hello` against `wrangler dev` |
| B1 MVP | Bot records, home, SOUL/MEMORY; talk to a bot from Zomfy; Discord mentions, DMs and threads; replies; Who can ask; Stop; the 24 h offline queue; deploy button and `bun run deploy` | **Zomfy app itself**, then **Discord** |
| B2 Back to the person (built; Discord end-to-end check left) | Questions and approvals as Discord buttons and in Zomfy's Needs you; live activity; access requests; schedules with a bot | Discord |
| B3 Slack | Slack to Orca's level: mentions, DMs, threads, Block Kit questions, approvals, Stop, status edits | Slack test workspace (the person does not use Slack; checked with a free workspace) |
| B4 GitHub | GitHub App; mention on issues and PRs; replies and review notes; PR events for the bot's own PRs | A test repository |
| B5 Webhooks and triggers | Webhook URLs; event triggers from every source; trigger deliveries with grace | `curl` and recorded source events |
| B6 Linear and memory | Linear mentions, labels, triggers; nightly memory tidy-up | A Linear test workspace |

# Acceptance

The end-to-end checks of the MVP; each spec has its own detailed checks.

- With no relay configured, a bot created in Zomfy answers in its own chat in its home folder.
- After deploy and pairing, `@bot fix the typo in README` in a Discord DM opens a Zomfy chat in the
  bot's home, and the answer is posted in Discord once.
- With the daemon stopped, a Discord mention sent then is answered after the daemon starts, if
  within 24 hours; after 24 hours the asker is told it expired.
- A Discord user not in Who can ask gets the "ask the owner" note and no chat is created.

# Decisions

Answered by the person on 2026-11-22:

1. One Discord application and one Slack app per deployment; several bots are told apart by handle
   (`@Zomfy reviewer …`), as Orca does with its shared GitHub app.
2. Discord's Gateway runs on the Cloudflare side all the time, so mentions wait while the PC is
   off; this may need Workers Paid ([Discord](sources/discord.md#decisions)).

# Open questions

1. Should MVP bots be limited to one host, or may two hosts each host bots on one deployment from
   the start? (The contract allows both; the spec does not limit it.)

[^orca-bots]: Orca Bots research, §1
[^orca-docs]: Orca Bots quickstart and security pages
[^person]: The person's decisions of 2026-11-22
