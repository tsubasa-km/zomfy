---
type: Spec
title: Zomfy's own skills, and worktrees that do not fill the disk
description: Settings turns Zomfy's bundled skills (the worktree skill first) on or off per agent and scope and keeps them updated; worktrees show their size, merged and idle ones are cleaned up by prompt or policy, idle ones lose their build output, dependencies are shared, and low disk space is warned about.
status: stable
x-zomfy-implementation: in-progress
tags: [worktrees, skills, storage, settings, daemon, desktop]
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

Background: [research](../research/worktree-skills-and-storage.md).

1. The worktree skill the person has is **Orca's** `orca-cli` (with `orchestration` and
   `computer-use`), installed into `~/.agents/skills` by `npx skills add`. It drives the `orca`
   executable, which Zomfy does not provide, and tells agents to prefer it over anything else. Zomfy
   ships no skill of its own and its Skills page can only list, read, trash and copy skills already
   on the host.
2. Worktrees fill the disk. Each one gets its own `node_modules` (and Expo's, and a Rust `target/`
   after a desktop build), 1–6 GB apiece; 28 of this repo's had to be removed by hand. Clean Up
   Merged Workspaces missed most of them because "merged" is judged against `main` (the fallback
   base, as the remote is `github`, not `origin`) while work is merged into `development`. Failed
   long-path deletes left folder skeletons behind.

# Who it is for

The person running many agent chats in parallel worktrees on one Windows machine, and the agents in
them, whichever agent (Claude Code, Codex, others) and however they were started.

# What it does

## A. Zomfy's bundled skills

### A1. The skills

Zomfy ships skills in `resources/skills/<name>/SKILL.md` (packaged with the app, read by the daemon).
The first is **`zomfy-worktrees`**: when to work in a worktree of one's own, and how, through the
harness MCP tools (`create_workspace` and `create_session` to hand work off, `split_work` for parallel
parts, `send_prompt` / `wait_for_session`, `claim_worktree`, `finish_worktree`); that nothing should
use raw `git worktree add` or Orca's `orca worktree` in a Zomfy project; that a worktree is not
deleted by the agent; and the storage rules of part B an agent can act on (do not `bun install` into
a worktree the setup script already prepared; leave build output to the cleanup). It names no CLI, so
it needs no PATH entry and no version-matched guide: the tools describe themselves.

Later skills follow the same mechanism (candidates: `zomfy-workflows`, `zomfy-bots`); this spec
builds only the mechanism and `zomfy-worktrees`.

### A2. Install, enable, disable

Settings → Skills gains a **Zomfy skills** section listing each bundled skill with, per host:

- a switch per agent Zomfy knows a skill folder for (Claude Code, Codex / `.agents`, and the other
  providers in `skill-discovery.ts` that the host has), and
- a scope: **Everywhere** (the home folders) or **This project only** (the project's folders, for
  the projects picked).

Turning one on writes the canonical copy to `<scope>/.agents/skills/<name>` and links each chosen
agent's folder to it — a junction on Windows, a relative symlink elsewhere, a copy where neither
works — as Orca does. Turning it off removes the link (and the canonical copy when nothing links to
it any more), only when the folder still holds an unedited Zomfy version (A3); an edited one is left
and the row says so.

New installs default to **off**: nothing is written into the person's agent folders until they turn
it on, except that the first run after this ships shows a one-time prompt in Settings → Skills
offering `zomfy-worktrees` for Claude Code and Codex everywhere.

### A3. Updates

Each release carries the sha256 (LF-normalised) of every version of each bundled `SKILL.md` it ever
shipped. On start the daemon classes every installed copy: **current**, **older Zomfy** (overwritten
in place, silently), **edited** or **other** (left alone; the row shows "Edited — Replace", which
first moves the folder to `~/.zomfy/skill-backups/<name>-<time>`). No version file is written.

### A4. Orca's stubs

When a host has Orca's `orca-cli`, `orchestration` or `computer-use` stub and no `orca` executable on
PATH, the Skills page marks them "Needs the Orca CLI, which is not installed" and offers to move them
to the trash (the existing `skills/trash`). Zomfy never removes them on its own.

## B. Worktrees that do not fill the disk

### B1. "Merged" means merged where the work goes

A worktree counts as merged when its branch is an ancestor of the branch its work is finished into,
not of the project's default base: the project's **finish branch**, which is the main checkout's
current branch (what `finish_worktree` merges into), else `defaultBaseRef`. For this repo that is
`development`. A worktree with uncommitted or untracked changes is never merged. Clean Up Merged
Workspaces, B4 and B5 all use this.

### B2. Size per worktree

The daemon measures each worktree's size on disk in the background (one at a time, low priority,
hardlinked files counted once per volume where the OS tells us) and splits it into **dependencies**
(`node_modules`), **build output** (`target/`, `dist/`, `.turbo`, `.expo`, and what the project
lists), and **the rest**. The sidebar's workspace card shows the total on hover, the delete and
cleanup dialogs show it per row, and the project's context menu shows the project total. Sizes older
than a day are re-measured when shown.

### B3. Low disk space

Before creating a worktree and every 30 minutes, the daemon checks free space on the volume holding
the worktree root. Under **10 GB** (a setting), Zomfy shows a notice with the space each project's
worktrees use and a **Clean up…** button that opens B4's dialog. Under **2 GB** a new worktree is
refused with that reason (an agent's `create_workspace` / `split_work` gets it as its error, so it
can tell the person).

### B4. Clean up — the dialog

Clean Up Merged Workspaces becomes **Clean up workspaces**: every non-primary worktree of the
project, with its state (merged, idle for N days, has changes), last activity, and size, sorted by
size. Two actions per row:

- **Delete** (merged ones checked by default): the worktree and, if merged, its branch.
- **Free space**: keep the worktree and its changes, delete its dependencies and build output.

Kept always, as Orca does: the main checkout, a worktree with a running turn or terminal, and one
with uncommitted, untracked or unpushed work (offered only for Free space).

### B5. Clean up — the policy

Settings → Worktrees (per host, with a per-project override) adds **Automatic cleanup**, off by
default, with:

- **Delete merged worktrees** after N days merged (default 1);
- **Free space in idle worktrees** after N days without a turn or terminal (default 3);
- keep pinned worktrees.

The policy runs 2 minutes after the daemon starts and hourly, and its last run ("freed 12.3 GB") is
shown under the setting. A worktree a chat still works in is never deleted; its chat gets a notice
and moves as `finish_worktree` already does.

### B6. Free space, and putting it back

Freeing a worktree deletes the folders B2 counts as dependencies and build output, using B7's
deletion. The next turn in that worktree starts with a note to the agent ("Zomfy removed this
worktree's `node_modules` and build output to save space; run the setup script or `bun install`
before building"), and when the project has a setup script Zomfy runs it before that turn instead.

### B7. Deleting on Windows

Every removal — worktree delete, Free space, the leftover folders below — goes through one routine:
paths are passed as `\\?\` (namespaced) paths so length does not matter, an EBUSY / EPERM /
ENOTEMPTY retries the whole removal a few times after closing the workspace's terminals, `.git` goes
last, and a file another program holds open is named in the error. On start the daemon also lists
folders under the worktree root that are no worktree and no workspace (the six skeletons found
today) and offers them in B4's dialog as **Leftover folder**.

### B8. Sharing dependencies

So a new worktree costs little in the first place:

- **Recommended (this spec):** a project setting **Install dependencies when a worktree is created**
  (with a default command per lockfile: `bun install` for `bun.lock`), run as the setup hook, relying
  on the package manager's global store with hardlinks or clones (bun's cache, pnpm's store) so
  packages are not copied per worktree; Zomfy checks the cache and worktree root are on one volume
  and says so when they are not, since hardlinks cannot cross volumes.
- **Rust**: the setup sets `CARGO_TARGET_DIR` for the worktree's terminals and agents to one shared
  folder per project under `~/.zomfy/cache/<project>/target`, so builds share artefacts (an option,
  on by default for projects with a `Cargo.toml`).
- **Not now:** linking the main checkout's `node_modules` into worktrees (Orca's shared directories)
  breaks as soon as a branch changes dependencies; offered later as an opt-in per directory if wanted.

# What it does not do

- No `zomfy` CLI, and no skill that needs one.
- No quotas, no archive state for worktrees (Orca has none that works either).
- No automatic deletion of anything with uncommitted, untracked or unpushed work, and no automatic
  removal of Orca's skills.
- No cleanup across hosts from one place; each host cleans its own.

# Options weighed

| Question | Options | Recommendation |
| --- | --- | --- |
| How agents learn Zomfy's tools | chat instructions only; a skill; both | Both: instructions for Zomfy's chats, the skill for agents started elsewhere |
| Skill install | copy per agent; canonical + links (Orca); hand roots to the launch only | Canonical + links, copy as fallback |
| Cleanup | prompt only; policy only; both | Both, policy off by default |
| Dependencies | per-worktree install (today); package-manager store with hardlinks; link the checkout's `node_modules` | Store with hardlinks, verified first (open question 4) |

# Acceptance checks

- With `zomfy-worktrees` turned on for Claude Code and Codex everywhere, `~/.agents/skills/zomfy-worktrees/SKILL.md`
  exists, `~/.claude/skills/zomfy-worktrees` is a junction to it, and the Skills page lists it once
  for both agents; turning it off removes both.
- A copy edited by hand is not overwritten by an update; Replace backs it up first.
- A release that changes the skill updates an unedited installed copy on the next daemon start.
- A worktree of this repo whose branch is merged into `development` but not `main` is offered as
  merged.
- The cleanup dialog shows each worktree's size, and Free space on a worktree with `node_modules`
  and `apps/desktop/src-tauri/target` leaves its files and git state intact and its size under 100 MB.
- A worktree whose `node_modules` has paths over 260 characters is deleted in full; a folder held
  open by another program is named in the error.
- With free space faked under 2 GB, `create_workspace` fails with the reason; under 10 GB the notice
  appears.
- With automatic cleanup on, a merged, idle worktree with no running chat is deleted within an hour
  of the threshold, and one with uncommitted changes is not.
- Tests: digest classification, merged-against-finish-branch, the long-path delete (a fixture of
  nested folders past 260 characters), size splitting, the policy's keep rules.

# Decisions (2026-11-25)

The person's answers to the open questions:

1. **Bundled skills are set per project.** Whether `zomfy-worktrees` (and later bundled skills) is
   enabled is a project setting (beside the agent-tool settings in Project Settings), per agent; a
   project's setting installs or removes the skill in that project's scope. There is no global
   default prompt.
2. **"Merged into" is the main checkout's current branch**, as proposed, with a per-project
   override.
3. **Automatic cleanup of merged worktrees starts on** (Orca's starts off). It still never touches a
   worktree with uncommitted or unpushed work, or one a chat is open in.
4. **bun already hardlinks** (measured 2026-11-25, below), so B8's dependency part is reduced to
   the same-volume check; the Rust part stays.
5. **No free-space thresholds**: B3's notice and refusal are left out; sizes (B2) and cleanup (B4–B6)
   stay.
6. **Orca's three stubs were removed** from `~/.agents/skills` by hand on 2026-11-25, with 15 empty
   worktree folders left behind by earlier removals.

# Measurement: bun's hardlinks (2026-11-25)

A fresh `bun install` (bun 1.4.4, default isolated linker, no `bunfig.toml`) in a new worktree of
this repo took 53 s and wrote 71,709 files (1,282 MB apparent) under `node_modules`. Of these, 71,355
files (1,280 MB) have a link count above one: `fsutil hardlink list` shows each as the same file in
`~/.bun/install/cache`, in the main checkout and in the worktree. Only about 1 MB (the `.bin`
shims and bun's own metadata) belongs to the worktree alone. Cache and worktree root are both on
`C:`.

What follows from it:

- **B8**: no per-project install setting is needed for space; bun's store already shares packages.
  What remains is the same-volume check (a cache on another volume would copy) and the Rust shared
  target.
- **B2**: a worktree's `node_modules` counts almost nothing once hardlinked files are counted once
  per volume; the size shown splits **own** bytes (files with one link) from **shared** bytes, so
  the person is not told a worktree costs 1.3 GB when deleting it frees 1 MB.
- **B6**: Free space mainly removes build output (`target/`, `dist/`); deleting `node_modules`
  frees little and is kept only because it also drops stale per-worktree installs.
- Bun's `readdirSync` returns nothing for a `\\?\` path, while plain absolute paths past 260
  characters work in Bun on this machine, so B7 does not rely on namespaced paths through Bun's
  `fs`; it keeps git's `core.longpaths` for the worktree and removes what is left with Bun's
  recursive `rm`, falling back to the OS (`cmd /c rd /s /q` on the namespaced path).

# Open questions

None.
