---
type: Spec
title: One right sidebar per split pane
description: Each split pane of tabs has its own right sidebar, opened from its own tab strip and showing the workspace of the tab it has in front.
status: stable
x-zomfy-implementation: done
tags: [ui, tabs, sidebar]
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

The window had a single right sidebar (files, changes, checks, ports, side chat) at the window's
right edge, showing the workspace of the tab in front, with its toggle in the title bar. With the
tabs split into panes that each work in another project, the sidebar showed only one of them, and
which one changed with every click between panes.

# What it does

- **A sidebar per pane.** Every leaf of the split tree (components/tab-layout/TabGroupPane.tsx) draws
  its own right sidebar at its own right edge, beside its tab strip and body.
- **What it shows.** Since [panes-as-workspaces](panes-as-workspaces.md), the pane's context workspace; the rest of this point is what it showed before. The workspace of the tab the pane has in front. On the "New thread" tab it
  follows the rules of `sidebarWorkspaceId` in session-store: the workspace the thread was opened
  from, else the main checkout of the project picked there, else nothing. A pane with no tab shows
  the workspace last in front, as the single sidebar did. A pop-out window's panes show its workspace.
- **Its own state.** Open or closed, the panel shown and the width are kept per pane
  (stores/pane-sidebar-store.ts, keyed by the tab layout and the pane's group id), across restarts.
  A pane made by a split starts closed. A pane that goes away takes its state with it. The state of
  the old single sidebar carries over to the focused pane once.
- **The toggle.** The open/close button sits at the trailing end of each pane's tab strip, after
  whatever else is there (the pop-out window's "Back to the main window"). The title bar no longer
  has one. With a single pane the window looks as before, with the button in the strip. In a
  narrow pane the strip's new-tab buttons give way first, so the pane's own buttons stay in reach.
- **Shortcuts and commands.** `sidebar.right.toggle` and the panel shortcuts (`sidebar.explorer.toggle`
  and the rest), and the places that open a panel (`setRightSidebar`: the status bar, a card's checks
  badge, the explorer's search), act on the focused pane of the window. A press inside a pane's
  sidebar focuses that pane.
- **Width.** Dragging a sidebar's edge sets that pane's width; a double-click resets it. A sidebar
  is never wider than half its pane.
- **Dropping a tab on a pane.** A split divides the whole pane, its sidebar included, so the drop
  zones and the hint drawn while dragging are measured on that same rectangle: the left and right
  bands are a fifth of the pane's full width, the top and bottom ones a fifth of its tab body, and
  the hint covers the half of the pane the new split takes. The sidebar counts as the pane's right
  edge: a tab, file or thread dropped anywhere over it opens in a new split on the right (or, where
  that split would change nothing, moves into the pane as a drop on its body does). A target inside
  the sidebar that takes the drop itself, such as the side chat's composer or the file tree, still
  wins over the pane.

# What it does not do

- The floating workspace panel stays without a right sidebar, as before.
- No sidebar spans several panes, and the left sidebar is unchanged.

# Performance

Each pane reads only its own entry of the sidebar store and a string workspace id from the session
store, so opening one pane's sidebar or switching another pane's tab redraws only that pane's
sidebar; the memoised panes stay as they were.

# Acceptance

- One pane: the sidebar opens and closes from the button at the end of the tab strip and from
  `sidebar.right.toggle`; the title bar has no right sidebar button.
- Two or three panes side by side: each has its own button and sidebar, which open, show panels and
  resize independently, and each shows its own front tab's workspace.
- The shortcut toggles the focused pane's sidebar only.
- A pop-out workspace window has the button in its strip and its sidebar works.
- With a pane's sidebar open, dragging a tab to each zone of one pane and of two panes side by
  side shows a hint that covers exactly where the new split appears after the drop.
- `bun run typecheck` and `bun test` in `apps/desktop` pass.
