---
type: Spec
title: Wake a Claude chat when its background work finishes
description: A Claude chat whose turn ended with background tasks still running keeps its Claude process, and starts a turn of its own with the task's notification when a task finishes, as Claude Code does.
status: stable
x-zomfy-implementation: in-progress
tags: [claude, chat, background-tasks, daemon]
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

In Claude Code, a Bash command started with `run_in_background`, a Monitor or a background subagent
brings the agent back with a task notification when it finishes, even after the agent ended its
turn. In a Zomfy chat this never happened: the agent said "I'll continue when the build finishes",
its turn ended, and it never resumed. A later prompt sometimes got a near-empty turn of 15–40 s.

The daemon runs one Agent SDK `query()` per turn, with a streaming prompt. It closed that prompt
stream after the turn's `result` (once the prompt suggestion arrived, or after 15 s), so the CLI
exited and took its background tasks with it. The CLI itself, with its input still open, does what
Claude Code's UI does: when a background task settles while the session is idle it emits
`system/task_notification`, then starts a turn of its own (a new `system/init`, the assistant's
messages and a second `result`) whose input is the notification. Nobody was listening any more.

# What it does

## Keeping the process

- The daemon follows `system/background_tasks_changed` (replace semantics) and keeps the set of the
  chat's live background tasks, leaving out `ambient` ones.
- At a turn's `result` with no live tasks, nothing changes: the process waits for the prompt
  suggestion (at most 15 s) and goes.
- With live tasks the prompt stream stays open and the process stays, idle, until every task has
  ended and no turn runs, then goes after the same 15 s. An idle process is kept for at most an hour
  after its last turn; past that it is stopped, its tasks with it, and the chat says so.

## The woken turn

- When the idle process emits a task notification (or starts a turn with none), the chat starts a
  turn of its own: marked working, as any turn is, with the notification as its input. It is shown
  as Claude Code records it, a user message holding `<task-notification>` with the task's status
  and summary, which the chat already draws as a background-task status line.
- Messages that arrive before the turn is set up are held and delivered in order. A woken turn
  that never attaches within a minute is dropped.
- A notification that arrives during a turn already running is shown in that turn.

## A new prompt, Stop, closing, moving

- A prompt from the person while the process is idle with live tasks goes into the same process,
  so its tasks keep running and can still wake the chat. Anything that changes how the process was
  started (the model, effort, the instructions, the tools, a workflow step) starts a new process
  instead, as before.
- Stop ends the turn and the process, as before; its background tasks end with it.
- Closing the chat, moving it, switching its agent or continuing it in a terminal lets the process
  go. When background tasks were still running, the chat says they were stopped.

## Daemon restarts

Background processes die with the daemon. The daemon records, in `background-tasks.json` in its
home, which chats have live background tasks; on its next start each of those chats gets a notice
that the restart stopped them, and the record is cleared.

# Out of scope

- A control to stop one background task, and a list of running tasks in the chat.
- Codex and other ACP agents: they do not report background tasks this way.
