---
type: Spec
title: Adding a tab — the "+" menu, pinned items, new chats and terminals that pick their place
description: The tab strip's "+" menu lists every kind of tab; any item can be pinned as a button beside it (Terminal by default, replacing the old Terminal button); a new chat opens the New thread screen prefilled with the current workspace; a new terminal lets the person pick its host, folder and shell.
status: stable
x-zomfy-implementation: in-progress
tags: [desktop, tabs, terminal, chat]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

The tab strip's add controls came from Orca, where everything happens in one worktree: the `+`
menu's "New … Thread" starts a chat in the current tab's workspace, the Terminal button beside it
opens a shell on that workspace's host, and nothing else can sit there. In Zomfy a person works
across projects and hosts, so a new chat or terminal should be able to start somewhere else, and
the strip's one-click buttons should be the ones the person uses.

# What it does

## The "+" menu

The menu belongs to the workspace of the pane's tab, as before (its "home"). From the top:

| Section | Items |
| --- | --- |
| Omnibox | search box; its results replace the items while it has a query (unchanged) |
| Chats | `New Claude Thread`, `New {agent} Thread` for each other chat agent the host can run (unavailable ones disabled with the reason) |
| Terminal | `New Terminal…` — see [New terminal](#new-terminal) |
| Agents | one item per TUI agent CLI found on the host, `Launch Agent with Prompt…`, `Refresh Agents` (unchanged) |
| Commands | the quick commands of the workspace's project, then the global ones; selecting runs it in a new tab. Shown only when there are any |
| Workflows | the project's workflows, `Run {name}…` asks for the task (the Workflows page's run dialog) and starts the run. Shown only for a workspace in a project that has workflows |
| SSH | saved SSH logins and `SSH connections…` (unchanged) |
| Browser | `New Browser Tab` (unchanged) |
| Panels | each workspace panel as a tab (unchanged) |

The per-shell "New Terminal (PowerShell)" items move into the New terminal dialog's shell choice.

## Pins

- Hovering (or keyboard-highlighting) an item that can be pinned shows a pin button at its right.
  Pressing it pins the item; on a pinned item the button shows filled and unpins it. The menu stays
  open. Items that cannot be pinned: the omnibox, `Refresh Agents`, `SSH connections…`, disabled
  items.
- Pinned items show as buttons in the tab strip right after `+`, where the Terminal button was, in
  the order they were pinned, followed by the Command button (unchanged). Several are allowed.
- A pinned button does what its menu item does, for the pane's workspace. Terminal, Browser and
  panels show their icon only; the others show their icon and a short label. Each has a tooltip
  with the item's full name.
- Right-clicking a pinned button offers `Unpin`.
- A pin whose item does not exist for the pane's workspace (a quick command of another project, a
  workflow of another project, an agent this host cannot run, a deleted SSH login) is not shown
  there; it stays pinned and shows again where the item exists.
- Pins are a window setting, `newTabPins` (an ordered list of item ids) in
  `stores/settings-store.ts`. The default is `["terminal"]`, so a window without the setting keeps
  its Terminal button.
- Item ids: `terminal`, `browser`, `chat:<agent>`, `agent:<tui agent>`, `command:<quick command id>`,
  `workflow:<workflow id>`, `ssh:<connection id>`, `<panel id>` (`panel:explorer`, `plugin:…`).
- The window-wide strip with no workspace in front keeps its single "New thread" `+` and shows no
  pins.

## New chat

`New {agent} Thread` (from the menu or a pin) no longer creates the session at once. It opens the
window's **New thread** screen (components/QuickStart.tsx, the same one shown after creating a
project) with that agent picked and the current workspace as where it starts. There the person can:

- keep the workspace and type: the chat starts in it, as before;
- open the workspace chip to pick another workspace of the same project, or `New worktree` (git
  projects) to start in a fresh worktree of that project;
- press the chip's `×` (`Start somewhere else`): the project picker shows, prefilled with the same
  project, and any project, a host (when no project is picked) or a fresh folder can be chosen.

In a pop-out workspace window or the floating workspace there is no New thread screen; there the
item starts the chat in the workspace at once, as before.

## New terminal

`New Terminal…` (and the default `Terminal` pin) opens a small **New terminal** dialog:

- **Host**: the connected hosts, defaulting to the current workspace's host. Shown only when more
  than one host is connected.
- **Folder**: the workspaces on the picked host, labelled `project · branch`, defaulting to the
  current workspace (or, on another host, its first project's main checkout).
- **Shell**: the picked host's shells, defaulting to the host's default.
- `Open` (Enter) opens the terminal as a tab of the picked workspace and puts it in front;
  `Cancel` / Escape closes. The defaults make Enter open where the old button opened.
- With no folder on the picked host, `Open` is disabled and the dialog says so.

The keyboard shortcut `terminal.new` (Ctrl+Shift+`) still opens a terminal in the focused workspace
at once, without the dialog.

# What it does not do

- No drag-to-reorder of pins; unpin and pin again to move one to the end.
- No pins in the window-wide strip without a workspace.
- The Command button keeps its own run/menu; commands in the `+` menu are a second way in.

# Acceptance

- The tab strip has no dedicated Terminal button; a fresh window shows a pinned Terminal button
  after `+`.
- Hovering a `+` menu item shows a pin button; pinning two items shows two buttons in pin order;
  `Unpin` from the menu or the button's context menu removes it; pins survive a reload.
- `New Claude Thread` opens the New thread screen with the current workspace's chip; `×` shows the
  project picker on the same project; the chip lists the project's other workspaces.
- `New Terminal…` opens the dialog defaulting to the current host and workspace; Enter opens a
  terminal there; picking another folder opens it in that workspace.
- `bun run typecheck` and the desktop tests pass; the pin list helpers have unit tests.
