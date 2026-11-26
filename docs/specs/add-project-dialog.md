---
type: Spec
title: The Add a project dialog
description: One compact dialog with three tabs (Open folder, Clone, New repository), the host as a light inline choice shown only when there is more than one, the project's display name and GitHub or GitLab account picked as it is added, and a clone's folder name.
status: stable
x-zomfy-implementation: in-progress
tags: [projects, desktop, onboarding, hosting]
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

The Add a project dialog is a port of Orca's: a start screen with a Host combobox, a big Browse
button and "Other ways to add", then a separate screen per way in with Back. The host combobox
reads oddly (it is the first thing asked, even with only one machine), each way in costs a click
and a screen, and nothing asks which GitHub or GitLab account the project uses
([per-project accounts](project-hosting-accounts.md)).

# The dialog

One dialog, `sm:max-w-xl`, the same look as Project Settings (shadcn inputs, selects, labels in
`text-xs text-muted-foreground`, hints in `text-[11px]`).

```
Add a project                                              [x]
Where  (●This computer) (●WSL) (○devbox) (+)
[ Open folder | Clone | New repository ]
  …the tab's fields…
  Display name  [ placeholder: the folder's name ]
  Account  [ tsubasa-km ▾ ]          (when there is a GitHub/GitLab remote)
error line
Import…                                         [Cancel] [Add project]
```

## Where: the host row

- Shown only when more than one host is known (this computer plus a WSL distro, an SSH or remote
  host). With one host nothing about hosts is shown, and the footer offers "On another machine…",
  which opens Connect SSH host.
- Each host is a small pill with a dot: green connected, a spinner while connecting, hollow not
  connected (its tooltip says "click to connect"). Clicking a connected host selects it; clicking a
  not-connected one connects it and selects it once connected. The round "+" opens Connect SSH
  host; the new host is selected when it connects. WSL distros the app has not started are listed as not connected.
- Default: the host the request names, else the active workspace's host when connected, else the
  Default host setting (`lib/default-host.ts`).
- Changing host keeps what was typed; paths and accounts are read again on the new host.

## The tabs

Three tabs, opened on the one the caller asks (`start` → Open folder, `clone`, `create`); arrow
keys move between tabs (Radix), the first field of a tab takes focus, Enter in any field submits.

### Open folder (default)

- **Folder**: a path on the host, with **Browse…** where a native picker reaches it (this computer,
  WSL). On SSH and remote hosts the path is typed (`~` works). Browse picking a folder of another
  host (a `\\wsl.localhost\` path) switches the host row to it.
- Under the field, what the daemon found there (asked 300 ms after typing stops):
  "Git repository · github.com/owner/repo", "Git repository with no GitHub or GitLab remote",
  "Not a Git repository: it opens as a folder, without worktrees" (amber), or
  "No folder at this path on <host>" (red).
- **Display name** (below).
- Submit: **Add project**, or **Open as folder** for a folder outside git (no second confirmation:
  the line above already said what it lacks). A folder already added says "Project already added"
  and selects it, as today.

### Clone

- **Repository URL** (https or ssh), focused.
- **Account** once the URL's host is GitHub or GitLab (below); the clone runs with it, so a private
  repository of a non-active account clones without switching.
- **Folder name** and **Display name**, side by side. The folder name follows the URL's repository
  name until it is edited (after that it stays as typed). It must not be empty, must
  not hold a path separator or a character Windows refuses in names (`<>:"/\|?*`, control
  characters), must not end in a dot or space, and must not be `.`, `..` or a reserved device name
  (`CON`, `NUL`, `COM1`…); the reason shows under the field and Clone stays disabled. Spaces and
  other characters the daemon's name rule replaces show as the folder it really makes.
- **Clone into**: a one-line summary of the full target (`<parent>/<folder name>`) with **Change**,
  which reveals the parent folder field (and Browse where possible). Defaults to `~/zomfy` on the
  host. The daemon is asked (300 ms after typing stops) whether the target exists; when it does the
  line says "<path> already exists" in red and Clone stays disabled.
- Submit: **Clone**; while cloning the button reads "Cloning…" and the dialog cannot be closed.

### New repository

- **Name**, focused; the folder name it makes is shown under it. **Display name** beside it,
  defaulting to the name as typed (so "My Project" shows as that while its folder is `My-Project`).
- **Create in**: summary and **Change**, as Clone's; defaults to `~/zomfy/projects`.
- **Publish to GitHub** (a switch, off; shown when the host has a GitHub account): reveals
  **Account**, **Owner** (defaults to the account's login; an organisation can be typed) and
  **Visibility** (Private, the default, or Public). Zomfy creates the local repository with its first
  commit, then runs `gh repo create <owner>/<name> --source <folder> --remote origin --push
  --private|--public` as that account. A failed publish keeps the local project and says why.
- Publishing to GitLab is left for later: create the project on GitLab and add its remote then.
- Submit: **Create project**, or **Create and publish**.

## The display name

The same field as Project Settings' Display name (`Project.displayName`), set as the project is
added: `projectAdd`, `projectClone` and `projectCreateRepo` take an optional `displayName`.

- Empty means the default, shown as the placeholder: the folder's name (Open folder), the folder
  name (Clone), the name as typed (New repository).
- Sent only when it differs from the folder's name, so an untouched field leaves `displayName`
  unset as before. A folder already added keeps its own display name.
- An older daemon ignores the parameter; the project is added under its folder's name.

## The account field

The same field as Project Settings' Account ([per-project accounts](project-hosting-accounts.md)):

- Shown only when the folder's remote or the URL points at GitHub or GitLab, and the host's daemon
  can list accounts. With exactly one account for that host it is shown read-only ("as
  `zenk-t-suzuki`"), so it never asks a question with one answer.
- Defaults to the CLI's active account for that host; picking another sets the project's
  `hostingAccount` as it is added. "Add account…" closes nothing for GitLab tokens (inline form);
  for a GitHub sign-in it opens the terminal and closes the dialog, saying so in a toast, since the
  login finishes there.

## Errors

The error line sits above the footer, in `text-destructive`, and clears as soon as a field
changes: the daemon's message (folder exists, git missing, author identity missing, clone failed).
Git missing on the host disables Clone and New repository with "Git is required…" under the
summary.

## Kept from before

"Add a workspace to <project>" (Add Workspace on Another Host) opens the same dialog with that title
and files the result under the project. The footer's **Import…** opens the
[Import dialog](import-dialog.md) on the chosen host, Orca first when it is there. Worktree location,
setup scripts and the rest stay in Project Settings, reached from the project's menu after adding.

# Out of scope

- Publishing to GitLab, templates (`.gitignore`, README) and choosing the default branch name.
- Browsing an SSH host's folders.

# Acceptance

- `bun test` in `apps/desktop` covers the tab a request opens, when the host row and the account
  field show, the target path previews, the account defaults, the clone folder name's checks and
  default, and which display name is sent.
- `bun test` in `packages/daemon` covers a display name given to a new project and not to one
  already added.
- `bun test` in `packages/daemon` covers the publish command line.
- Preview screenshots of each tab, with one and with several hosts, in light and dark.
