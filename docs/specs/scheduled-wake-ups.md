---
type: Spec
title: Scheduled wake-ups fire in a Zomfy chat
description: A Claude chat that ends its turn with a ScheduleWakeup, CronCreate or /loop keeps its Claude process until the wake-up fires; if the process goes anyway, the daemon fires one-shot wake-ups itself, also after a restart.
status: stable
x-zomfy-implementation: in-progress
tags: [claude, chat, background-tasks, daemon]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

Claude can schedule its own return: `ScheduleWakeup` (60 s to 1 h ahead, used by `/loop`),
`CronCreate` (a cron expression, one-shot or recurring) and `/loop`. These schedules live in the
Claude process. The daemon kept a process after its turn only for background tasks
([background-task-wake.md](background-task-wake.md)); with none it let the process go within 15 s,
and the wake-up was lost.

Checked on 2026-11-26 with Agent SDK 0.3.305 and a real Claude run in a temporary folder: a
ScheduleWakeup of 60 s reported `session_crons: [{ schedule: "33 16 * * *", recurring: false }]` to
the Stop hook. With the prompt stream kept open, the CLI started a turn of its own at 16:33
(`system/init`, then the assistant) and the Stop hook then reported no crons. With the stream closed
15 s after the result, the process exited at once and nothing fired.

# What it does

## Knowing what is scheduled

- The Stop hook the daemon already registers reads `session_crons` at every turn end. Each becomes a
  `SessionWakeUp { id, at, recurring, prompt }`, `at` being the cron expression's next match in local
  time (null if it has none within a year). The chat's `SessionInfo.background.wakeUps` carries
  them (see [turn-taking-states.md](turn-taking-states.md)).
- A one-shot whose time has passed by more than a minute is dropped from the list; the CLI's next
  Stop hook replaces the whole list.

## Keeping the process

- A process with pending wake-ups is kept between turns like one with background tasks: a new prompt
  joins it (so the CLI's own CronList and CronDelete keep working) and the CLI fires the wake-up.
- It is kept until two minutes after the next wake-up is due, re-armed at every turn end, for at
  most 24 hours. A wake-up further away than that is left to the daemon (below).
- A woken turn with no task notification that starts while a wake-up is due shows its prompt as a
  "Scheduled wake-up" note in the transcript.

## When the process goes anyway

The process can go before its wake-up: a Stop kills it, a turn with different launch options
replaces it, the 24-hour cap passes, or the daemon restarts. Then the daemon keeps the one-shot
wake-ups itself:

- At the wake-up's time it starts a turn in the chat with the wake-up's prompt, shown as a
  "Scheduled wake-up" note. A turn already running defers it until that turn ends.
- A wake-up that came due while the daemon was down fires when it starts, if it is less than an hour
  late; an older one is dropped with a notice in the chat.
- A recurring wake-up cannot be kept without its process: the chat gets a notice
  ("Stopped the scheduled task …") and it leaves the list.
- Archiving, deleting or moving a chat (which end its process on purpose) drops its wake-ups.

# Out of scope

- Durable crons (`CronCreate` with `durable: true`), which the CLI keeps in
  `.claude/scheduled_tasks.json` and fires on its own next run.
- Cancelling a wake-up from the UI.

# Acceptance

- Fake-SDK tests: a turn ending with `session_crons` keeps the process past 15 s and reports the
  wake-up's time; the CLI's own wake turn is taken by the chat; a process stopped before the time
  leaves the daemon to start the turn at that time.
- A real run (above) confirms the CLI fires a kept process's wake-up.
