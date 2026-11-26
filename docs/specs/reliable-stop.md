---
type: Spec
title: Stop ends a chat's turn at once, and the Send and Stop buttons stay true
description: Stop ends a Claude turn the moment it is pressed whatever its process does, says "Stopping…" while an agent winds down, and a prompt just sent keeps the chat working until the host reports its turn.
status: stable
x-zomfy-implementation: done
tags: [chat, composer, claude, daemon]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

Stopping a running turn was unreliable. Sometimes the chat kept saying it worked after Stop;
sometimes the round button turned back into Send while the agent was only starting, and a second
press (or the follow-up queue) sent another prompt that replaced the first.

- The daemon killed a stopped Claude turn's process, then waited for the process's message stream
  to end before ending the turn. A CLI slow to exit (ending its tools, a slow process exit on
  Windows) kept the chat working, and Stop seemed to do nothing.
- A turn joining a process kept for its background tasks first sent the process a control request;
  a process that did not answer held the turn where Stop could not reach it.
- A Stop that answered an open permission ask marked the chat working again for a moment.
- The window marks a chat working when it sends a prompt, but any session list the host sent before
  it took the prompt said idle and replaced that. The button turned back into Send, and the queue
  read the change as the end of a turn and sent its next message, which replaced the one just sent.
- An ACP agent is given up to 10 s to wind down after a cancel; meanwhile the Stop button looked as
  if it had done nothing.

# What it does

## Daemon (packages/daemon/src/claude-turn.ts)

- Stop ends a Claude turn when it is pressed: the process is killed, and the turn settles as
  cancelled without waiting for it to exit. What the dying process still sends belongs to no turn
  and is not shown.
- The next turn waits for a stopped process to exit, at most 5 s, before starting another, so two
  processes never write one conversation.
- A Stop before the process is started starts none. A Stop while a turn is joining a kept process
  ends the turn without waiting on the process (at most 5 s for its control request in any case),
  and leaves the process and its background tasks as they were.
- A Stop that answers a permission ask or a question leaves the chat ending its turn, not working.

Stop still ends the chat's process and its background tasks
([background-task-wake.md](background-task-wake.md)); ACP and Codex agents still get their cancel and
up to 10 s to wind down.

## Window

- A prompt the window sent keeps its chat working until the host reports that turn (working or
  needs you). Host reports that say otherwise meanwhile are held back; when the prompt's request
  settles, the last of them applies, as a status change, so a turn that ended before any report
  showed it running still ends in the window and the queue still moves on
  (`apps/desktop/src/lib/sends-in-flight.ts`).
- After Stop the button shows a spinner, "Stopping…", until the turn ends. If it has not ended after
  12 s, Stop is offered again.

# Acceptance

- `claude-turn-stop.test.ts`: a stopped turn ends within 200 ms though its process takes 1.5 s to
  exit, and the process's later output is not shown; a Stop before start spawns nothing; the next
  turn starts its process only after the stopped one exited; a Stop while joining a kept process
  that does not answer ends the turn and keeps the process.
- `tests/sends-in-flight.test.ts`: an idle report from before the host took the prompt shows
  working; the host's working report takes over; a held report applies when the request settles; a
  replaced send leaves the later one in flight.
