---
type: Spec
title: The Import dialog
description: One Import dialog with a source picker that lists only what is found on the chosen host (Orca's projects, and each agent CLI's own recorded conversations), replacing Import from Orca and Import threads.
status: stable
x-zomfy-implementation: done
tags: [projects, desktop, onboarding, threads]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

Two separate dialogs bring things into Zomfy: **Import from Orca…** (Orca's projects) and **Import
threads…** (conversations an agent's own CLI recorded). The Add a project dialog links to the first
only, the sidebar's add menu lists both, and neither says what else could be imported. The person
wants one **Import…** that asks where from.

# What can be imported today

Only what Zomfy can already read; no new importer is part of this spec.

| Source | What | Read by | Host |
| --- | --- | --- | --- |
| Orca | Projects of Orca's active profile (git repos and folders; WSL ones land on that distro) | `_harness/import/orca` | This computer only: Orca is a desktop app here, and its WSL paths are routed from here |
| Claude Code | Conversations Claude Code recorded (`~/.claude/projects`) | `_harness/sessions/history` with `agents: ['claude']` | Any host |
| Codex | Conversations Codex recorded (`~/.codex/sessions`) | the same, `codex` | Any host |
| Other chat agents (OpenCode, Gemini, …) | Conversations the agent's ACP server lists | the same, per agent | Any host |

Not importable yet, and so not offered: Orca's settings, worktree metadata, chats or bots; Claude
Code or Codex settings, MCP servers or skills; Orca SSH-backed projects.

# The dialog

```
Import                                                    [x]
From  (Orca 12) (Claude Code 48) (Codex 5)          [Host ▾]
<what this source brings, one line>
  …the source's list (projects, or threads with search and folder scope)…
error lines
                                              [Cancel] [Import 3]
```

- `sm:max-w-2xl`, the Add a project dialog's look.
- **Host**: a select of the connected hosts, shown only with more than one. Defaults to the host
  the request names, else the active workspace's.
- **From**: one pill per source found on that host, with its icon and count. A source is found when
  - Orca: the host is this computer and Orca's profile could be read (even with no projects);
  - an agent: it listed at least one conversation, across all folders.
  Sources still being read show as "Looking for Claude Code, Codex…" after the pills; one that
  fails to read is left out. With nothing found once every source answered: "Nothing to import on
  <host>.", one muted line. The dialog has no description line under its title
  ([ui-principles.md](ui-principles.md)).
- The source shown: the one the request asks for when it is found; else the first found in the order
  Orca, then the chat agents in the app's order, waiting until each source before it has answered so
  the dialog does not jump. A source the person clicks stays chosen.
- **Orca**: the existing list (checkbox per project, host it lands on, Already added), Import n.
- **An agent**: the existing thread list narrowed to that agent: search, the "this workspace / All
  folders" scope when opened from a workspace, Import n, Open for one already imported, "Import
  into <workspace>" after a failure and on a row recorded in another folder. Each thread is imported
  into the workspace that owns its recorded folder and runs in that folder
  ([import-keeps-its-folder.md](import-keeps-its-folder.md)).
- Changing host starts the probes again; changing source clears what was ticked.

# Where it opens

- Add a project dialog footer: **Import…** (was "Import from Orca…"), on the dialog's host, asking
  for Orca.
- Sidebar add menu: one **Import…** item instead of "Import from Orca…" and "Import threads…".
- Onboarding's "Import from Orca" card: the Import dialog asking for Orca.

# Acceptance

- `bun test` in `apps/desktop` covers which sources are found, the order and the waiting rule for
  the shown source, and that a request's source wins when found.
- Preview screenshots of the Import dialog with Orca and with an agent source.
