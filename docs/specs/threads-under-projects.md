---
type: Spec
title: The thread list is grouped by project
description: The left sidebar lists projects in their own order, each with its threads inside (most recent activity first) that keep their turn-taking marks; a folded project shows its most pressing thread's mark, and threads of no project have their own group.
status: stable
x-zomfy-implementation: done
tags: [desktop, sidebar, chat]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T12:00:00Z" }
---

# Problem

The sidebar's thread list was one flat list cut by whose turn it is
([turn-taking-states](turn-taking-states.md)): Needs your answer, Your turn, Working, Quiet. With
several projects open the person looks for "the billing thread" by its project first, and a flat
list mixed every project in every group; the folders per project were an option in View options
that few found.

# What it does

The list is a list of projects, each holding its threads. Group by is gone from View options: this
is the only layout.

From top to bottom:

1. **Pinned** threads, in pin order, as before (pin mark, count, fold).
2. **Projects**, in the project order the sidebar already keeps (the person's drag order,
   `projectOrder`, else the hosts' order). The order does not change with activity, so each project
   stays where the person last saw it; what needs them is shown on the project's row instead.
3. **No project**: quick threads and other threads of no project, as one group after the projects,
   headed like a project with a hollow dashed square for its folder. Shown only when it has threads.
4. **Archived**, at the bottom, as before.

## A project's group

- The header row: fold chevron, the folder icon, the project's name, its thread count, and on hover
  `+` (new thread in the project) and the project's actions, as the project folders had.
- Inside it, its threads (the threads of all its workspaces, worktrees included), **most recent
  activity first** (when a turn last started or ended). Helpers and workflow steps stay folded under
  the thread they work for, as before.
- Each row keeps its turn-taking mark in its corner: the question bubble (Needs your answer, a red
  alert for a failed turn), the green dot with a halo (Your turn), the spinner (Working), the yellow
  Activity mark (Background work running), nothing on a Quiet row, which stays one grey line. No
  state is named in words; the name is the mark's tooltip.
- Rows do not repeat their project's name; a worktree's branch stays on its row.
- A worktree no thread works in keeps its "no threads yet" row, and a project with no thread at all
  one quiet line, as the project folders had.

## A folded project shows what needs the person

A project is folded and unfolded by its header (kept per project, across restarts). Folded, its
folder icon is replaced, in the same place, by the mark of its most pressing thread: the question
bubble (or red alert) when any thread needs an answer, else the green dot when any is the person's
turn, else the spinner or Activity mark when any works, else the folder icon. The order is the turn
order: Needs your answer, Your turn, Working, Background work running. Unfolded, the rows show their
own marks, and the folder icon comes back.

## Search, pinning, archive

- **Search** keeps only the projects with a matching thread (by title, project name or branch),
  unfolded, with the matching threads inside; a match under another thread shows beneath it,
  quieter, as before. The No project group the same.
- A **pinned** thread shows only under Pinned; an **archived** one only under Archived.

# What it does not do

- No sorting of projects by activity, and no moving of a project when a thread in it changes state.
- No per-project state groups inside a project.

# Acceptance

- With threads in several projects, the sidebar shows each project's threads under it, newest
  activity first, each with its turn mark; quick threads sit in their own group below the projects.
- Folding a project that holds a thread needing an answer shows the question bubble where its
  folder icon was; a project whose most pressing thread is the person's turn shows the green dot.
- Search narrows the projects to those with a match; pinning moves a thread to Pinned; archiving to
  Archived.
- View options has no Group by.
- `bun run typecheck` and the tests pass; the project grouping and its ordering have unit tests.
