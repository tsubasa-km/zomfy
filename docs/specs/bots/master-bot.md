---
type: Spec
title: The master bot
description: Zomfy comes with one bot, "Zomfy" (@zomfy), registered once per host as the Default bot, which manages chats, workspaces and worktrees across every project with the manager tools.
status: stable
x-zomfy-implementation: in-progress
tags: [bots, daemon, desktop]
sources:
  - id: person
    resource: "decisions given by the person on 2026-11-25"
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

A new Zomfy has no bots, so a message to the deployment's Discord or Slack app that names no bot
has nobody to go to, and the person has to set up a bot before they can ask anything from outside
Zomfy. The person wants Zomfy to come with one bot from the first run: their manager, which sees
and drives the chats, workspaces and worktrees of every project, as the Manager chat
does.[^person]

# Behaviour

## Seeding

- When the daemon starts, it registers the **master bot** once per host, then remembers that it
  did (`masterSeededAt` in `~/.zomfy/bots.json`). It is never registered again: a person who deletes
  it, or renames it, keeps what they chose.
- On a fresh install, and on an install that has bots already, it is added the same way. It is
  the **Default bot** only when no other bot is: an install whose person chose a default keeps it.
- When another bot already has the handle `zomfy`, nothing is added and the seed is still
  remembered.
- When the home cannot be made (a folder `~/zomfy/bots/zomfy` that is not a bot's home, say), the
  daemon logs why and tries again on its next start.
- The bots root follows `ZOMFY_BOTS_DIR` when it is set (previews and tests), else
  `~/zomfy/bots`.

## Its settings

| Field | Value |
| --- | --- |
| Name, handle, avatar | `Zomfy`, `zomfy`, none (the initials) |
| Purpose | The person's manager across their projects: sees and drives chats, workspaces and worktrees on every host, and hands code work to worker chats |
| Agent, model | Claude, the agent's default model |
| Permission mode | `default` (Ask for approval), as for every bot ([daemon](daemon.md#decisions)) |
| Home | `~/zomfy/bots/zomfy`, with SOUL, MEMORY and the rules as for any bot |
| `isDefault` | `true` unless another bot is the default |
| `manager` | `true` |

## Manager bots

- `Bot` gains an optional `manager` flag (additive; absent is false), set from Create bot / Edit
  bot as **Manager across projects**. The master bot is a bot with `manager: true`; any bot may
  have it.
- Every bot chat is offered the manager tools as any chat is, plus `create_bot_automation`. A
  manager bot's chat is treated as the Manager chat is: the tools are loaded up front, and the
  Manager's own tools (`managerAllowed`: start sessions and workspaces, send prompts, forward to
  the person) run without asking. Other tools, and every edit or command, ask as the bot's
  permission mode says.
- Its rules (`AGENTS.md`) add a **Manager** section: look before acting (`list_hosts`,
  `list_workspaces`, `list_sessions`), prefer existing chats, put code work in a worker chat in its
  own worktree, wait for and read what the workers did, and forward the person's calls with
  `forward_to_person` rather than approving risky actions itself.
- As for the Manager chat, the manager tools are carried by an open Zomfy window; with no window
  open the bot answers, and a manager tool says the app must be opened.

## In the desktop app

- The master bot shows on the Bots page and in Settings → Bots like any bot: editable, pausable and
  deletable. A manager bot has a small **Master** badge beside its name, next to **Default**.

# Non-goals

- Re-creating the master bot after the person deletes it, or a "restore" button.
- Manager calls without a window open (the daemon does not reach other hosts on its own).

# Acceptance

`bun test` in `packages/daemon`, with a temp home and bots root:

- A first start with no bots adds `Zomfy` (`@zomfy`), Claude, `default` permission mode,
  `manager: true`, `isDefault: true`, homed in `<bots root>/zomfy` with its rules naming the
  manager tools.
- A second start adds nothing; after the master is deleted, a start adds nothing.
- A start on an install with a default bot adds the master, not as the default.
- A start on an install with a bot `@zomfy` adds nothing.

`bun test` in `apps/desktop`: the Master badge shows for a manager bot only.

In a preview with its own state: the Bots page lists Zomfy with Default and Master, and no folder
appears under the person's `~/zomfy/bots`.

# Decisions

Given by the person on 2026-11-25: Zomfy ships one master bot registered by default, the Default
bot, with the manager's reach across projects; it is a bot like any other, editable and deletable.

Made while specifying (least surprising): it is added once, also to installs that have bots, and
never takes the default from a bot the person chose.

# Open questions

None for the person.

[^person]: The person's request of 2026-11-25
