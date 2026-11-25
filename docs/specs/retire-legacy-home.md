---
type: Spec
title: Retire the acp-harness home and executable name
description: Rewrites paths stored under the legacy ~/.acp-harness home to ~/.zomfy, removes the link left at the old path, and renames the installed executable to Zomfy.
status: stable
x-zomfy-implementation: done
tags: [rename, migration, installer]
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Problem

v0.2.51 renamed acp-harness to Zomfy. The daemon moved `~/.acp-harness` to `~/.zomfy` and left a
link (a junction on Windows, a symlink elsewhere) at the old path, because records written before
still hold absolute paths under the old home: a quick chat's `cwd`, a scratch or floating
workspace's `path`, an inline terminal's folder, attachment paths in prompts and titles, workflow
run commands. As long as those exist, the old path cannot be deleted. The installed executable also
kept its old name, `acp-harness-desktop.exe`, so shortcuts and the updater kept finding it.

# What it does

## Stored paths (every host)

On its first start with this build, each host's daemon (local, WSL, SSH: they run the same code)
rewrites every stored absolute path under the legacy home to the same path under the new home, then
removes the link. It runs before any store loads, once:

- **Which files.** The stores' own files only: every `*.json` directly in the home, and `*.json` /
  `*.jsonl` directly in `sessions/`, `automations/` and `inline-terminals/`. Never attachments,
  plugins, scratch folders, worktrees or backups: those hold the person's files, not records.
- **Which strings.** Every string value and object key whose text contains the legacy home's full
  path (`C:\Users\me\.acp-harness`, either slash, any letter case on Windows; `/home/me/.acp-harness`
  elsewhere) as a whole path segment, followed by a separator or the end of the path. The match is
  replaced by the new home, in the slash style the match used. A `.acp-harness-old` folder or the
  worktree root `~/acp-harness/workspaces` (no dot) is not matched.
- **Safely.** A file is parsed before it is changed (a JSONL file line by line, lines that do not
  mention the old home kept byte for byte); one that does not parse is left alone. The original of
  every changed file is copied first to `backup-legacy-home-<time>/` in the home, and the new text
  replaces it through a temporary file and a rename.
- **Claude conversations.** Claude Code files a conversation under its folder's name
  (`~/.claude/projects/<cwd as a name>/`) and resumes only from there. For each chat whose `cwd` is
  now under the new home, a conversation still filed under the old folder's name is moved to the new
  one, as moving a chat between workspaces already does.
- **Once.** When everything above succeeded, `legacy-home-retired.json` is written in the home and
  later starts skip the rewrite. A failure (a file that could not be written, a conversation that
  could not be moved) is logged and leaves no marker, so the next start tries again; it is safe to
  repeat, since rewritten text no longer matches.
- **The link.** After that, the old path is removed only when it is a link (symlink or junction) that
  resolves to the new home: the link the migration made. A real folder at the old path (a home that
  was copied rather than moved, marked `MOVED-TO-ZOMFY.txt`) or a link to anywhere else is left as
  it is. Removing the link never touches what it points to. A link that could not be removed is
  tried again on the next start.
- Only the default home takes part: a daemon given its own home (`ZOMFY_HOME`, previews, tests) or
  still running from the legacy home (another daemon held it) skips all of this.

## Window storage

The app's window storage (layout, open tabs, drafts) may hold paths under any host's old home. On
start, every value is rewritten from `<sep>.acp-harness<sep>` to `<sep>.zomfy<sep>` (the folder name
is the same on every host), once, after the legacy key rename.

## Other legacy folders

- `%LOCALAPPDATA%\acp-harness` held only per-build copies of the daemon (in `bin`); the app removes
  `bin`, then the folder once empty, whenever it exists, not just before the first move.
- The worktree root `~/acp-harness/workspaces` is not part of the home: worktrees there keep their
  recorded paths and keep working, and nothing reads the old home to find them.

## The executable

`mainBinaryName` becomes `zomfy`, so the app installs as `zomfy.exe`. Tauri's NSIS installer already
handles a renamed main binary: it records the name in the uninstall key (`MainBinaryName`), deletes
the old one after copying the new one, and points the Start menu and desktop shortcuts that targeted
the old executable at the new one. An installer hook adds what it does not do:

- **Before installing**, it closes a running `acp-harness-desktop.exe` the same way the installer
  closes the app under its current name (silently during an update, after asking otherwise), so the
  old file is not locked when it is deleted. During an update the updater has already exited it.
- **After installing**, it deletes `acp-harness-desktop.exe` if it is still there and points a
  taskbar pin that targeted it at `zomfy.exe`.

After an update the installer starts the app by its new name (`/R`). The single-instance lock and
the webview's data are keyed by the identifier (`io.github.tsubasa-km.zomfy`), which does not change.

# Not in scope

- Paths inside the person's own files (scratch folders, worktrees, attachments) and inside agents'
  own stores other than Claude's conversation folders (Codex resumes by id; `~/.claude.json`
  per-folder settings start fresh for a scratch folder's new path).
- Moving worktrees out of `~/acp-harness/workspaces`.

# Acceptance

- Unit tests: paths in session records, workspace state, terminals and JSONL transcripts are
  rewritten; unrelated strings and lookalike folders are not; originals are backed up; a second run
  changes nothing; a Claude conversation filed under the old folder moves to the new one; the link
  is removed only when it points to the new home, and a real folder is never removed.
- Window storage values are rewritten once; lookalikes are kept.
- `bun run typecheck`, `bun test` in `packages/daemon` and `apps/desktop`, `cargo check` pass.
- A locally built installer installs as `zomfy.exe` over a throwaway install of the current version:
  the old executable is gone and the shortcuts point at the new one.

# Verified

- `legacy-home-retire.test.ts` (daemon) and `legacy-storage.test.ts` (desktop) cover the checks above,
  junctions included on Windows.
- A dry run on a copy of a real home's store files rewrote 6 files with no failures. What still
  mentions the old name there is prose and code inside transcripts and `~/.acp-harness` typed in old
  commands, not stored absolute paths, and it stays as written.
- Two installers were built locally under a throwaway product name, the first with the old
  executable name and no hooks, the second with `zomfy` and the hooks. Installing the second over
  the first in update mode (`/P /UPDATE`), with a process running from `acp-harness-desktop.exe` and
  a taskbar pin pointing at it, closed the process, left only `zomfy.exe`, pointed the Start menu,
  desktop and taskbar shortcuts at it, and recorded `MainBinaryName` as `zomfy.exe`.
