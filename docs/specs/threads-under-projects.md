---
type: Spec
title: The thread list is a stack of project cards
description: The left sidebar is a stack of cards, one per project in its own order and one for threads of no project, each holding its threads (pinned first, then most recent activity); rows keep their turn-taking marks, a thread that needs the person glows under the same rule as its composer, and a folded card glows when one of its threads does.
status: stable
x-zomfy-implementation: in-progress
tags: [desktop, sidebar, chat]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T15:00:00Z" }
---

# Problem

The sidebar's thread list was one flat list cut by whose turn it is
([turn-taking-states](turn-taking-states.md)): Needs your answer, Your turn, Working, Quiet. With
several projects open the person looks for "the billing thread" by its project first, and a flat
list mixed every project in every group. A first version grouped the threads under plain project
header rows with an indented list; read on screen, the projects did not separate well, and a
thread waiting for the person was only a small mark among many.

# What it does

The list is a stack of **project cards**, each holding its threads. There is no grouping or
ordering by turn-taking state anywhere in the list, and no Group by in View options.

From top to bottom:

1. One card per **project**, in the project order the sidebar already keeps (the person's drag
   order, `projectOrder`, else the hosts' order). The order does not change with activity, so each
   project stays where the person last saw it.
2. A **No project** card for quick threads and other threads of no project, after the projects,
   shown only when it has threads.
3. **Archived**, at the bottom, as before (its own shelf, not a card).

## A card

- A contained region: a subtle surface (`--card`), a 1px border, rounded corners; cards stacked
  with a small gap, compact padding.
- Its top row: the fold chevron, the project's colour badge (its initials on the colour every row
  of that project used to carry; a hollow dashed square for No project), the project's name, its
  thread count, and on hover `+` (new thread in the project) and the project's actions.
- Inside, its threads (of all its workspaces, worktrees included): **pinned threads first**, in pin
  order, **then the rest by most recent activity** (when a turn last started or ended). Helpers and
  workflow steps stay folded under the thread they work for, as before. Pinning no longer moves a
  thread out of its card; the pin shows on the row.
- Each row keeps its turn-taking mark in its corner: the question bubble (Needs your answer, a red
  alert for a failed turn), the green dot with a halo (Your turn), the spinner (Working), the yellow
  Activity mark (Background work running), nothing on a Quiet row, which stays one grey line. No
  state is named in words; the name is the mark's tooltip.
- Rows do not repeat their project's name; a worktree's branch stays on its row.
- A worktree no thread works in keeps its "no threads yet" row, and a project with no thread one
  quiet line.

## The thread that needs the person glows

A row glows exactly when its thread's composer or waiting card would
([composer-waiting-glow](composer-waiting-glow.md), one predicate for both): when a question, an
approval or a split confirmation waits in it (its own or a helper's under it), or when it is the
person's turn. The glow is the composer's (`data-waiting-glow`, the `chatWaitingGlow` setting:
Rainbow by default, Accent pulse, Static outline, Off), still under reduced motion. A failed turn
keeps its red alert and does not glow, as in the thread.

The two kinds stay told apart by the row's own mark, which the glow does not replace: the orange
question bubble for a waiting answer, the green dot for Your turn.

A **folded card** glows the same way when one of its threads glows, and its colour badge shows the
mark of its most pressing thread in the turn order (Needs your answer, Your turn, Working,
Background work running), the badge itself when every thread is quiet. Unfolded, the card does not
glow; its rows do.

## Search, pinning, archive

- **Search** keeps only the cards with a matching thread (by title, project name or branch),
  unfolded, with the matching threads inside; a match under another thread shows beneath it,
  quieter, as before.
- A **pinned** thread sits at the top of its own card; an **archived** one only under Archived.

# What it does not do

- No sorting of projects by activity, and no moving of a card when a thread in it changes state.
- No groups or order by state inside a card.

# Acceptance

- With threads in several projects, each project is a card holding its threads, pinned first, then
  newest activity first, each with its turn mark; quick threads sit in their own card below.
- A thread with a waiting question, and a Your turn thread, glow in the pattern Settings picks
  (none with Off), each keeping its own mark; a failed or quiet thread does not glow.
- Folding a card that holds a waiting thread makes the card glow, with the question bubble on its
  badge; a card whose most pressing thread is the person's turn glows with the green dot.
- Search narrows the cards to those with a match; pinning puts a thread at the top of its card;
  archiving moves it to Archived.
- `bun run typecheck` and the tests pass; the card grouping, its ordering and the glow rule have
  unit tests.
