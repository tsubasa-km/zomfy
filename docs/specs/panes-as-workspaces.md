---
type: Spec
title: A split pane is a workspace, and its "+" is a quick pick
description: Each split pane of the window's tabs has a workspace of its own (or none) that its "+", pins and right sidebar act on, shown as a coloured mark at the start of its tab strip; the "+" opens a filterable quick pick with Terminal, Agent and Panel scopes.
status: stable
x-zomfy-implementation: done
tags: [desktop, tabs, panes, sidebar]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T00:00:00Z" }
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
from thread to thread. Panes are optional side contexts beside it, as Orca's workspaces are: a
second pane is "another place I keep open", with its own project.

## A pane's workspace (its context)

- Every pane (leaf group) of the main window's tabs has a **context**: a workspace (which brings
  its project and host), or **none** ("no project", a floating pane). It is kept with the pane in
  the tab layout (`TabGroup.context` in stores/tab-layout-store.ts: a workspace id, `null` for
  none, absent while not yet set), so it survives restarts.
- The floating panel's and a pop-out window's panes always have that panel's or window's
  workspace; they have no context of their own.

What sets it:

1. **First tab.** A pane whose context is not yet set takes the workspace of the tab it shows,
   else of its first tab that has one, as soon as there is one, and keeps it. A pane made by a
   split therefore starts in the workspace of the tab that made it. A pane showing only the New
   thread tab takes that tab's workspace when it has one. A pane with nothing to take stays
   unset and acts as **none** until it gets one.
2. **Explicitly.** The pane's mark (below) opens a picker of every workspace in the window, and
   `No project`.
3. **Going somewhere.** Bringing a thread or workspace to the front from outside the tab strip:
   the left sidebar, the Inbox, search, a notification, Jump to agent (`selectSession`,
   `previewSession`, `selectWorkspace`) re-points the pane it comes to the front in. So the one
   pane of a window used one thread at a time always follows the thread the person is in.
   Starting a chat from the New thread tab re-points the pane the chat takes the tab's place in.

What does not change it:

- Moving or dragging a tab into a pane, dropping a thread or a file on it, splitting a tab out of
  it: the tab keeps its own content and workspace, and the pane keeps its context.
- Clicking a tab in the strip, closing tabs, opening tabs from `+` (also a terminal in another
  folder picked in the New terminal dialog).

When the context workspace is not in the window (its host not back yet, popped out, deleted), the
pane keeps it saved and acts meanwhile on the workspace rule 1 would pick, without saving that;
picking another from the mark replaces it.

## What the context does

- **`+` and pins.** Everything a pane's `+` quick pick and pinned buttons open opens in the pane's
  context, as a tab of that pane. With context none, only what needs no workspace is offered: new
  chats (the New thread screen without a place) and `New Terminal…` (the dialog on the first
  connected host); the pins needing a workspace hide in that pane.
- **New chat.** `New {agent} Thread` opens the New thread tab in this pane (moving it here if
  another pane had it) with the pane's context as where it starts.
- **Right sidebar.** The pane's sidebar shows its context's workspace, not the front tab's
  (replacing that rule in [pane-sidebars](pane-sidebars.md)). With context none, the pane has no
  sidebar and no toggle, as the New thread tab of a quick thread had.
- **The drawer** stays the front tab's: it holds that tab's terminals.

## The mark

At the start of each pane's tab strip, before the tabs, a small square in the project's colour
with the project's first letter (the same colour for a name every time, as connector avatars
have). It is the pane's context at a glance; panes in different projects differ in colour.

- With the window split, the mark is followed by the project's name (and the branch for a
  worktree), muted and truncated, so side-by-side panes can be told apart by name too.
- With one pane, only the mark shows; its tooltip names the workspace.
- Context none shows a hollow dashed square, no letter.
- Pressing the mark opens the picker: a filter field, `No project`, then the window's workspaces
  as `project · branch`, the current one checked. Picking one sets the context.

No other words are added to the strip.

# The "+" quick pick

The `+` opens a quick pick, as VS Code's: one search field at the top and a list below.

## Scopes

Right of the field sit three scope chips, icons only with a tooltip: **Terminal** (a terminal
icon), **Agent** (a bot icon), **Panel** (a panel icon). None pressed is "all". A pressed chip
narrows the list to its scope; pressing it again returns to all.

| Scope | Items |
| --- | --- |
| Terminal | `New Terminal…`, the quick commands (project's, then global), saved SSH logins, `SSH connections…` |
| Agent | `New {agent} Thread` for each chat agent, the TUI agent CLIs found on the host, `Launch Agent with Prompt…`, the project's workflows (`Run {name}…`), `Refresh Agents` |
| Panel | `New Browser Tab`, the workspace panels as tabs; with a query also the matching files of the workspace (`Open file`) and the query as a URL or a search (`Open URL`, `Search Google`) |
| all | everything above; with a query also the matching open tabs (`Switch to tab`) first |

Unavailable chat agents stay listed, disabled, with the reason under their name.

## New thread first

**`New thread`** (a pen-on-page icon, as the left sidebar's) is the first row of the quick pick in
all and in the Agent scope, above pins and recent items, and is highlighted when the field is
empty, so `+` then `Enter` starts a thread. It opens the New thread screen in this pane with the
pane's context as where the thread starts, as `New {agent} Thread` does, keeping the agent last
picked there. It is not listed in the Terminal and Panel scopes, which start no thread, and it
cannot be pinned (the strip's own `+` is one press away). With a query it is matched like any
other item (`new`, `thread`), first among equals.

## Order

- With no query: `New thread`, then pinned items in pin order, then recently used ones (the last five run from the
  quick pick, most recent first, `zomfy.new-tab-recent.v1` in local storage), then the rest in
  scope order (Terminal, Agent, Panel). Space separates the three groups; there are no headings.
- With a query: the items whose name matches (every character in order, case-insensitive), or
  whose English name does in a translated window (`term` finds `新しいターミナル…`), best
  first: a name that starts with the query, then one with a word that does, then one that
  contains it, then a scattered match; pinned and recent items first among equals. The matched
  characters are drawn in full contrast.

## Keyboard

- The field has focus when the quick pick opens; typing filters.
- `↑` / `↓` move the highlight (wrapping), `Enter` runs the highlighted item, `Escape` closes.
- `Tab` moves to the next scope (all → Terminal → Agent → Panel → all), `Shift+Tab` back.
- A prefix typed as the first character picks a scope and is taken off the query: `$` Terminal,
  `@` Agent, `#` Panel. `Backspace` in an empty field with a scope returns to all.
- The highlighted row shows its pin button; `Alt+P` pins or unpins the highlighted item.

## Pins

Unchanged from [new-tab-menu-and-pins](new-tab-menu-and-pins.md): every item that could be pinned
there shows the pin button on hover or highlight, a pinned item a filled pin; pins show as buttons
beside `+`. A pinned item also comes first in the quick pick.

# What it does not do

- No context for the floating panel or a pop-out window (they are one workspace already).
- No host-only context (a host without a folder); none means the local host's defaults.
- The New thread tab stays one for the window; it moves to the pane whose `+` asked for it.
- No sorting of tabs by context and no warning when a pane holds tabs of other workspaces.

# Acceptance

- Two panes side by side in two projects: each strip starts with a mark in its project's colour
  and its name; `+` → `New Terminal…` in each defaults to its own project; a new browser tab or
  panel opens in that pane, for that project; each pane's sidebar shows its own project.
- Dragging a tab of project B into the project A pane leaves the A mark and sidebar as they were.
- Picking a thread of project C in the left sidebar while the A pane is focused shows it there and
  the pane's mark turns to C.
- With the New thread tab in front, `+` opens the quick pick; `New Claude Thread` and
  `New Terminal…` work from it.
- The quick pick: typing filters; each chip narrows to its scope; `Tab` cycles the scopes; `$`,
  `@`, `#` pick them; `↑`/`↓`/`Enter` run an item; pinned items come first; pins still work.
- `bun run typecheck` and the tests pass; the context resolution, the scope cycling and the
  matching have unit tests.
