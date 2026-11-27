---
type: Spec
title: A split pane works in its front tab's workspace, and its "+" is a quick pick
description: Each split pane of the window's tabs works in the workspace of the tab it has in front, keeping the last one while that tab has none, and its "+", pins and right sidebar act on it; the "+" opens a filterable quick pick with Terminal, Agent and Panel scopes.
status: stable
x-zomfy-implementation: done
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
- The quick pick: typing filters; each chip narrows to its scope; `Tab` cycles the scopes; `$`,
  `@`, `#` pick them; `↑`/`↓`/`Enter` run an item; pinned items come first; pins still work.
- `bun run typecheck` and the tests pass; the context resolution, the scope cycling and the
  matching have unit tests.
