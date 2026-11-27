---
type: Spec
title: A split pane shows one workspace's tabs at a time, and its "+" is a quick pick
description: Each split pane of the window's tabs works in the workspace of the tab it has in front and shows only that workspace's tabs (and tabs of no workspace), keeping every other workspace's tabs to bring back; its "+", pins and right sidebar act on it, and the "+" opens a filterable quick pick shaped as a tree of Terminal, Agent and Panel.
status: stable
x-zomfy-implementation: in-progress
tags: [desktop, tabs, panes, sidebar]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T12:00:00Z" }
---

# Problem

The main window holds the tabs of every workspace in one split tree of panes. What a pane's `+`,
its pinned buttons and its right sidebar acted on was the workspace of the tab it had in front, so
it changed with every click on a tab: two panes side by side could not each stay "the project A
pane" and "the project B pane", and a pane showing a chat of another project quietly moved its
`+` there. On the "New thread" tab, which belongs to no workspace, the window had no workspace in
front at all, so the pane offered only a `+` that opened the New thread tab again, which was
already open: the `+` did nothing.

The `+` menu itself had grown into a long list of nine sections, read top to bottom.

# The model

Zomfy is used in one thread at a time: the person stays in one chat, and the window follows them
from thread to thread. The person does not manage a pane's workspace: **a pane's context follows
the tab it has in front.** Open a thread of project A in a pane and the pane works in A; open a
thread of project B there and it works in B.

This supersedes the first version of this spec, where each pane kept an explicit, saved context
(`TabGroup.context`), set by its first tab, by a picker at the start of its tab strip, or by going
to a thread from outside the strip, and kept whatever tab was clicked. That context and its picker
are gone.

## A pane's workspace (its context)

- Every pane (leaf group) of the main window's tabs has a **context**: a project's workspace (which
  brings its project and host), or **none**. It is worked out from the pane's tabs each time
  (`resolvePaneContext` in lib/pane-context.ts), not saved.
- The floating panel's and a pop-out window's panes always have that panel's or window's
  workspace.

How it is worked out:

1. **The front tab's workspace**, when the tab carries one: a chat, a terminal, a file or a panel
   of a project's workspace (a worktree included); the New thread tab when a place is picked on it.
2. When the front tab carries none (the New thread tab with no place, a browser tab, a chat or
   terminal of no project: a quick thread, the floating workspace), the pane **keeps the last
   context it had**, so its `+` and sidebar still work there. The last context is kept in memory
   for the pane while the window is open.
3. With no last context (a pane just restored or made by a split onto such a tab): the workspace of
   the pane's most recently shown tab that carries one, then of its other tabs.
4. Else none.

A workspace not in the window now (its host not back yet, popped out, deleted) carries no
context.

## What the context does

- **`+` and pins.** Everything a pane's `+` quick pick and pinned buttons open opens in the pane's
  context, as a tab of that pane. With context none, only what needs no workspace is offered: new
  chats (the New thread screen without a place) and `New Terminal…` (the dialog on the first
  connected host); the pins needing a workspace hide in that pane.
- **New chat.** `New {agent} Thread` and `New thread` open the New thread tab in this pane (moving
  it here if another pane had it) prefilled with the pane's context as where it starts.
- **Right sidebar.** The pane's sidebar shows its context's workspace (replacing that rule in
  [pane-sidebars](pane-sidebars.md)). With context none, the pane has no sidebar and no toggle.
- **The drawer** stays the front tab's: it holds that tab's terminals.

Nothing at the start of the tab strip marks the context: the tab in front, and its sidebar, are the
mark.

## One workspace's tabs at a time

A pane holds the tabs of one workspace at a time: its context's **set**. Several threads, terminals
and files of that workspace sit side by side as tabs (two storefront threads, a storefront
terminal). To see two workspaces at once, the person splits the pane.

- **The strip shows the set**: the pane's tabs whose workspace is the context, plus its tabs of no
  workspace (the New thread tab, browser tabs, quick threads and other chats of no project), which
  belong to the pane and show in every set.
- **Other sets are kept, not closed.** A pane keeps every tab it holds, in its order, with each
  workspace's set remembered (`tabOrder` and `recentTabIds` of the pane, as before). The strip hides
  the tabs of other workspaces.
- **Going to another workspace replaces the set.** Opening a thread of billing-api in a pane showing
  storefront (from the sidebar, the Inbox, search, a notification) brings billing-api's tab to the
  front of that pane, so the pane now shows billing-api's set; storefront's tabs wait hidden.
  Opening a storefront thread again brings storefront's set back, as it was left. The sidebar's
  preview tab rule still holds: a thread only looked at replaces the pane's preview tab.
- **Closing a tab** brings the most recently shown tab of the same set to the front; when the
  set's last tab closes, the pane falls back to the set of its most recently shown other tab.
- **Dragging a tab of another workspace into a pane** switches that pane to the dragged tab's
  workspace (the dropped tab comes to the front, as any drop does). A drop is a deliberate act, so
  it is honoured rather than refused; the pane's other set stays kept.
- **Keyboard** tab switching (`Ctrl+Tab`, `Ctrl+1…9`) and the strip's own commands ("Close Other
  Tabs", "Close Tabs to the Right") act on the set shown. The `+` quick pick's "Switch to tab" finds
  the tabs of every set; picking a hidden one brings its set back.
- The floating panel and a pop-out window are one workspace already: nothing is hidden there.

# The "+" quick pick

The `+` opens a quick pick: one search field at the top and, below it, a **tree** of what the pane
can open. This replaces the flat list with Terminal, Agent and Panel scope chips of the first
version: the tree's top level is those three, so there is nothing to narrow by.

## The tree

With an empty field, from the top:

1. **`New thread`** (a pen-on-page icon, as the left sidebar's), highlighted, so `+` then `Enter`
   starts a thread. It opens the New thread screen in this pane with the pane's context as where
   the thread starts, keeping the agent last picked there. It cannot be pinned.
2. The **pinned** items, in pin order, as leaves at the top level.
3. Three branches, folded by default:

| Branch | Inside |
| --- | --- |
| **Terminal** | One branch per connected host (none when there is only one host: its shells sit right under Terminal), holding that host's shells, its **default shell first** (the host's `defaultShellId`, else the first detected); then the quick commands (project's, then global), each saved SSH login, `SSH connections…`, and last `Other folder…` (the New terminal dialog, to pick another host, folder or shell). |
| **Agent** | One branch per agent the host has (Claude, Codex, OpenCode, GitHub Copilot…), its icon and name; inside, what that agent can start: `New thread` (a chat with it), `In a terminal` (its CLI, when found on the host), `With a prompt…` (the launch dialog, the agent picked). After the agents: the project's workflows (`Run {name}…`) and `Refresh Agents`. |
| **Panel** | `New Browser Tab`, then the workspace panels as tabs |

A shell opens a terminal tab on its host in the pane's workspace folder when the pane's workspace
is on that host, else in that host's default folder (its first project's main checkout, as the
dialog picks), at once, with no dialog.

A branch row shows a chevron, its icon and its name; an agent branch its agent's icon. Which
branches are open is remembered (local storage) for the next `+`.

An entry that cannot run now (a chat agent whose CLI has no ACP mode, an agent not installed) stays
in its place, greyed and inert; why is its tooltip, never a sentence on the row. An agent with
nothing runnable is greyed as a whole.

## With a query

Typing turns the tree into a flat list of the leaves that match (every character in order,
case-insensitive, on the name or on its English name in a translated window), best first: a name
that starts with the query, then one with a word that does, then one that contains it, then a
scattered match; pinned items first among equals. Each row shows its path before the name in muted
text (`Agent › Codex ›`), and the matched characters in full contrast. Branches do not match on
their own; searching `codex` finds the leaves under Codex, whose names carry the agent's name.

The query also offers, as before: the matching open tabs (`Switch to tab`) first; then the matching
files of the workspace (`Open file`) and the query as a URL or a search (`Open URL`, `Search
Google`).

## Keyboard

- The field has focus when the quick pick opens; typing filters.
- `↑` / `↓` move the highlight over the visible rows (wrapping); `Enter` runs a leaf, or opens or
  folds a branch; `Escape` closes.
- `→` opens the highlighted branch, or on an open one moves to its first child; `←` folds an open
  branch, or on a child moves to its branch.
- The highlighted leaf shows its pin button; `Alt+P` pins or unpins it.

## Pins

Unchanged from [new-tab-menu-and-pins](new-tab-menu-and-pins.md): every leaf that could be pinned
there shows the pin button on hover or highlight, a pinned one a filled pin; pins show as buttons
beside `+`, and at the tree's top under `New thread`.

The pinned **Terminal** button opens the Terminal branch as a small menu under it (the same tree,
`Terminal` itself left out), its first row the default shell on the pane's host, highlighted, so a
click then `Enter` opens it. `` Ctrl+Shift+` `` still opens the default terminal at once, with no
menu. With a query in the `+` quick pick, a shell lists with its path (`Terminal › WSL › Ubuntu` on
a host branch, `Terminal › PowerShell` on one host).

# What it does not do

- No context for the floating panel or a pop-out window (they are one workspace already).
- No host-only context (a host without a folder); none means the local host's defaults.
- The New thread tab stays one for the window; it moves to the pane whose `+` asked for it.
- No sorting of tabs by context and no warning when a pane holds tabs of other workspaces.
- No way to set a pane's context by hand: it is the front tab's.

# Acceptance

- A pane showing a thread of project A: `+` → `New Terminal…` defaults to A, the sidebar shows A.
  Clicking a tab of project B in the same pane turns both to B.
- Two panes side by side, each showing a project's thread: each pane's `+` and sidebar act on its
  own front tab's project.
- With the New thread tab (no place), a browser tab or a quick thread in front, the pane keeps the
  context it had: `+` opens the quick pick and `New Claude Thread` opens the New thread screen
  prefilled with that project.
- The tab strip has no mark or picker before the tabs.
- A pane with storefront tabs open: opening a billing-api thread from the sidebar shows only
  billing-api's tabs (and tabs of no workspace) in that pane; opening a storefront thread again
  shows storefront's tabs as they were. Two storefront threads sit side by side as tabs.
- Dragging a billing-api tab into a pane showing storefront switches that pane to billing-api.
- The quick pick is a tree: `New thread` and the pins first, then Terminal, Agent (one branch per
  agent) and Panel; `→`/`←` open and fold, `↑`/`↓`/`Enter` move and run; typing lists the matching
  leaves with their path; a disabled entry has no sentence under it.
- `bun run typecheck` and the tests pass; the context resolution, the scope cycling and the
  matching have unit tests.
