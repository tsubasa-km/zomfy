---
type: Spec
title: New terminals and agents get the current user environment
description: The daemon re-reads the person's environment (Windows registry, or a login-shell snapshot on macOS and Linux) for each new terminal and agent process, so `setx` or a profile edit applies without restarting Zomfy; Reload environment forces it.
status: stable
x-zomfy-implementation: in-progress
tags: [environment, daemon, terminals, agents, windows, desktop, settings]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T00:00:00Z" }
---

# Problem

A process gets its environment once, from its parent, when it starts. Zomfy's daemon starts with
the app, so a variable the person sets afterwards (`setx FOO bar`, Windows' "Edit environment
variables", a line added to `~/.zshrc`) never reaches the terminals and agents it starts: they
inherit the daemon's environment from app start. The person has to quit and reopen Zomfy, which
ends every chat's process.

# What it does

## The environment a new process gets

`spawnEnvironment()` in the daemon returns the environment for a new terminal or agent process.
It is the daemon's own launch environment brought up to date with the person's current one:

- **Windows**: `reg query` of `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`
  (machine) and `HKCU\Environment` (user), as Explorer builds a new process's environment:
  - user values override machine values, names compared case-insensitively;
  - `REG_EXPAND_SZ` values have their `%NAME%` references expanded, machine values against the
    machine values, user values against machine and user values, unknown names left as written;
  - `PATH` is the machine `Path` followed by the user `Path`.
- **macOS and Linux** (and WSL hosts): a snapshot of the login shell's environment,
  `$SHELL -ilc 'env -0'` between markers, with a 10 s limit. Shell bookkeeping (`PWD`, `OLDPWD`,
  `SHLVL`, `_`, `TERM`, `TERM_PROGRAM*`, `COLUMNS`, `LINES`) is ignored.

Merged into the launch environment so that what only the launcher set (`ZOMFY_*`, variables of the
shell `bun run` was started from) stays:

- a variable from the person's environment is set to its current value;
- a variable that was in the person's environment when the daemon started, still has that value in
  the daemon, and is gone from the person's environment now, is removed;
- `PATH` keeps the launch order; directories the person removed since the daemon started are
  dropped, and new ones are appended, so which `node` is found does not change behind their back.

## When it is read

- **Windows**: on each spawn when the last read is older than 2 s (two `reg export` calls, about
  0.1 s); spawns close together share one read.
- **macOS and Linux**: a login shell can take seconds, so the snapshot is cached. A spawn uses the
  cache and, when it is older than 5 minutes, starts a fresh snapshot in the background for the
  next one. The first spawn after the daemon starts waits for the first snapshot.
- **Reload environment** reads it now, whatever the cache, and also looks for agent CLIs on the new
  `PATH` again (a CLI installed after the app started shows up in Settings › Agents).

## Reload environment

A button per host in Settings › Secrets & environment ([agent secrets](agent-secrets.md)), calling
`_harness/environment/reload`. It answers with the names of the variables that changed; the button
shows the count for a moment (`3`), or a check mark when nothing changed. Values are not sent.

## What is picked up and what is not

| Picked up | Not picked up |
| --- | --- |
| New terminal tabs | Terminals already open (their shell keeps its environment) |
| A chat's agent process when it starts: a new chat, a restarted agent, the first turn after the process ended | A chat whose agent process is still running between turns |
| Agent detection on `PATH` after Reload environment | The daemon's own `process.env` (it stays as launched; only children get the new one) |
| Project setup and archive hooks, language servers | `git` and `gh` the daemon runs itself (they keep the launch environment) |
| | Processes the agent itself already started |

# Acceptance

- Unit tests with fake readers: registry parsing (`REG_SZ`, `REG_EXPAND_SZ`, empty values),
  expansion order, `PATH` merge (machine then user; launch order kept; removed dropped; new
  appended), removal of a deleted variable, launcher-only variables kept, posix snapshot parsing
  and the ignored names, the Windows TTL and the posix stale-while-revalidate cache, and Reload's
  changed names.
- New terminals and agents start with `spawnEnvironment()`.
- Reload environment in Settings shows the changed count.
