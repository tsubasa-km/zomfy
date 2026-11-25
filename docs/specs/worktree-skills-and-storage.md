---
type: Spec
title: Zomfy's own skills, and worktrees that do not fill the disk
description: Project Settings turns Zomfy's bundled skills (the worktree skill first) on or off per agent and keeps them updated; worktrees show their size, merged ones are judged against the main checkout's branch and cleaned up by dialog or by an hourly policy, idle ones can lose their dependencies and build output, and deletes survive long Windows paths.
status: stable
x-zomfy-implementation: done
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

Project Settings gains a **Zomfy's skills** section (decision 1): each bundled skill with a switch
per agent, **Claude Code** (`.claude/skills`) and **Codex** (`.agents/skills`). A switch applies at
once to every workspace of the project, its main checkout and worktrees, and to each worktree made
later (as `createWorkspace` makes it, `split_work`'s included).

The host keeps one shared copy of each skill under `<harness home>/skills/<name>`. Turning a skill
on for an agent puts a link to that copy in the agent's folder of each workspace — a junction on
Windows, a relative symlink elsewhere, a copy where neither works — and adds the links to the
repository's `info/exclude`, so a worktree with them still counts as clean (B1). Turning it off
removes the link; the shared copy stays. A folder of the person's own by that name is never touched:
the row counts the workspaces where one blocks the link. Before a worktree is deleted its links are
removed as links, so no removal can reach the shared copy.

New projects have every bundled skill **off**; there is no global default and no first-run prompt.

### A3. Updates

Each release carries the sha256 (LF-normalised) of every version of each bundled `SKILL.md` it ever
shipped. On start the daemon classes the shared copy: **current**, **older** (an earlier Zomfy version,
overwritten in place, silently), **edited** (left alone; the section says so and offers "Replace with
Zomfy's version", which first moves the folder to `<harness home>/skill-backups/<name>-<time>`) or
**missing**. No version file is written. A test fails when `SKILL.md` changes without its digest
being added to the shipped list.

### A4. Orca's stubs

Not built: the person removed Orca's three stubs by hand (decision 6), so there is nothing left to
mark. The Skills page's existing trash still removes any that come back.

## B. Worktrees that do not fill the disk

### B1. "Merged" means merged where the work goes

A worktree counts as merged when its branch is an ancestor of the branch its work is finished into,
not of the project's default base: the project's **finish branch**, which is the main checkout's
current branch (what `finish_worktree` merges into), else `defaultBaseRef`. For this repo that is
`development`. A project may name another branch in Project Settings (**Work is merged into**). A
worktree with uncommitted or untracked changes is never merged. The sidebar badges, B4 and B5 all
use this.

### B2. Size per worktree

The daemon measures each worktree's size on disk in the background (one at a time, low priority,
files with more than one link counted apart as **shared**, since deleting them frees nothing; see the
measurement below) and splits it into **dependencies** (`node_modules`), **build output** (`target/`,
`dist/`, `.turbo`, `.expo`, `.next`, `.svelte-kit`, `.parcel-cache`), and **the rest**. The sidebar's
workspace card shows the size on hover, the cleanup dialog per row, and the project's context menu
the project total beside Clean Up. Sizes older than a day are re-measured when asked for; the
measurements are kept in `<harness home>/worktree-sizes.json`.

### B3. Low disk space

Left out (decision 5): no free-space checks, notices or refusals.

### B4. Clean up — the dialog

Clean Up Merged Workspaces becomes **Clean up workspaces**: every non-primary worktree of the
project, with its state (merged, idle for N days, has changes), last activity, and size, sorted by
size. Leftover folders (B7) follow the worktrees. Two actions per row:

- **Delete** (merged ones checked by default): the worktree and, if merged, its branch.
- **Free Up Space**: keep the worktree and its changes, delete its dependencies and build output.

Kept always, as Orca does: the main checkout, a worktree with a running turn or terminal, and one
with uncommitted, untracked or unpushed work (offered only for Free Up Space). When bun's cache is on
another drive than the worktrees, the dialog says so (B8).

### B5. Clean up — the policy

Settings → Hosts gains, per connected host:

- **Delete merged worktrees** after N days (default **on**, 1 day; decision 3);
- **Free space in idle worktrees** after N days without a turn or terminal (default off, 3 days);
- **Keep pinned worktrees** (default on).

Project Settings can turn deletion on or off for one project (**Delete merged worktrees
automatically**: as the host, on, off). The days count from when the daemon first saw the worktree
merged, and the worktree must also have been idle that long. The policy runs 2 minutes after the
daemon starts and hourly; its last run ("deleted 2, freed 0") shows under the setting.

What the person called "a chat is open in" is read as: a turn running or waiting on the person, a
running terminal, or a running `split_work` keeps the worktree. Idle chats in it move to the main
checkout with a notice, as `finish_worktree` does; a chat that cannot move (another agent than
Claude) keeps it. Right before deleting, the daemon checks again for uncommitted, untracked and
unpushed work.

### B6. Free space, and putting it back

Freeing a worktree deletes the folders B2 counts as dependencies and build output that git ignores
(a tracked `dist/` is source and stays), using B7's deletion. The next turn in that worktree starts with a note to the agent ("Zomfy removed this
worktree's `node_modules` and build output to save space; run the setup script or `bun install`
before building"), and when the project has a setup script Zomfy runs it before that turn instead.

### B7. Deleting on Windows

Every removal — worktree delete, Free Up Space, the leftover folders below — goes through one
routine (`safe-remove.ts`). git's own removal (with `core.longpaths`) still comes first for a
worktree; when git refuses because of changes or a lock, that error stands, and when it fails to
delete, the routine takes over. It removes everything but `.git` first, then the rest, retrying an
EBUSY / EPERM / ENOTEMPTY a few times after closing the workspace's terminals, falls back to `rd /s
/q` on the `\\?\` path on Windows, and names the first file that will not go. Terminals close
before any worktree removal. Bun's `fs` handles long absolute paths itself, but not `\\?\`
paths (see the measurement).

The cleanup dialog lists folders under the project's worktree root that are no workspace, no git
worktree and hold no `.git` as **Leftover folder**; only a folder so listed can be deleted.

### B8. Sharing dependencies

bun already hardlinks packages from its cache (measured below), so a new worktree's
`node_modules` costs about 1 MB of its own. What was built: the cleanup dialog warns when bun's
cache sits on another volume than the worktrees, where it would copy instead.

Not built:

- An install-on-create setting: the project's setup script already runs `bun install` where wanted.
- **Rust**'s shared `CARGO_TARGET_DIR`: one target folder shared by worktrees makes parallel
  builds wait on cargo's lock, which split_work's helpers would hit at once. Free Up Space and the
  idle policy remove `target/` instead. Worth a spec of its own if Rust builds become frequent.
- Linking the main checkout's `node_modules` into worktrees breaks as soon as a branch changes
  dependencies.

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
| Skill install | copy per agent; canonical + links (Orca); hand roots to the launch only | One shared copy per host + links per workspace, copy as fallback |
| Cleanup | prompt only; policy only; both | Both; deleting merged worktrees on by default (decision 3) |
| Dependencies | per-worktree install (today); package-manager store with hardlinks; link the checkout's `node_modules` | Store with hardlinks: bun already does it (measured) |

# Acceptance checks

- With `zomfy-worktrees` turned on for Claude Code and Codex in a project, every workspace has
  `.claude/skills/zomfy-worktrees` and `.agents/skills/zomfy-worktrees` linked to the shared copy,
  `git status` stays clean, a worktree made later is linked too; turning Claude off removes only its
  links. (Tested; checked in the preview.)
- A copy edited by hand is not overwritten by an update; Replace backs it up first. (Tested.)
- A release that changes the skill updates an unedited installed copy on the next daemon start.
  (Tested through the classification; not through a real release.)
- A worktree of this repo whose branch is merged into `development` but not `main` is offered as
  merged. (Tested with a repository of its own.)
- The cleanup dialog shows each worktree's size, and Free space on a worktree with `node_modules`
  and `apps/desktop/src-tauri/target` leaves its files and git state intact and its size under 100 MB.
  (Tested; checked in the preview.)
- A worktree whose `node_modules` has paths over 260 characters is deleted in full. (Tested.) A file
  held open by another program is named in the error. (Not tested: Bun opens files shareable for
  delete, so a test cannot hold one.)
- With automatic cleanup on, a merged, idle worktree with no running chat is deleted within an hour
  of the threshold, and one with uncommitted changes is not. (Tested with a faked clock.)
- Tests (all written): digest classification, merged-against-finish-branch, the long-path delete (a fixture of
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
