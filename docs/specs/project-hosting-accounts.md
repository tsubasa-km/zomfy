---
type: Spec
title: A GitHub or GitLab account per project
description: Each project can pick which GitHub or GitLab account Zomfy, its agents and git use for its remote, without switching the CLI's global account; GitLab tokens Zomfy holds itself live in the OS credential store.
status: draft
x-zomfy-implementation: planned
tags: [projects, hosting, github, gitlab, git, daemon, desktop]
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

People often have more than one account on the same host: a work GitHub login and a personal one,
both on github.com. `gh` keeps several accounts per host but only one is active, so today the person
runs `gh auth switch` by hand before pushing to the "other" project, and forgets now and then.
Zomfy's review panel, work items and Create PR use whichever account is active, and so do agents
running `gh` or `git push` in their turns.

# What it does

## The choice

A git project gains an optional **account**: `hostingAccount: { provider, host, login }`. Unset (the
default) is today's behaviour: the CLI's active account. The account is only used when its
`provider` and `host` match the project's remote (`origin`, else the first remote); a project whose
remote moved to another host falls back to the active account and the field says so.

## Which accounts there are

The daemon lists the accounts on its own host (`_harness/hosting/accounts`):

- **GitHub**: every account `gh auth status --json hosts` reports, active or not, per host. Older
  `gh` without `--json` falls back to reading its text output.
- **GitLab**: the one account `glab auth status --all --output json` reports per host (older glab:
  the text output), plus the **tokens Zomfy holds** (below). `glab` keeps one account per host and
  cannot switch, so a second account on the same host is a personal access token held by Zomfy.

Listing never changes anything and never prints a token. A CLI that is missing lists nothing for
its provider.

## Adding an account

- **GitHub**: "Sign in to another GitHub account…" opens a terminal tab on the host running
  `gh auth login --hostname <host> --web` (as [Signing in to Claude](claude-sign-in.md) opens one
  for `claude auth login`). gh makes the account it signs in active; the projects that picked an
  account keep theirs, so switching back is optional and left to the person.
- **GitLab**: "Add a GitLab token…" takes a host and a personal access token (scopes `api`,
  `read_repository`, `write_repository`; the field links to the host's token page). The daemon
  checks it against `https://<host>/api/v4/user`, takes the login from the answer, and stores it.
  When glab has no account on that host yet, "Sign in with glab…" opens a terminal running
  `glab auth login --hostname <host>` instead.
- A token Zomfy holds can be removed from the same list.

### Where tokens live

Tokens of the CLIs stay where the CLIs keep them (their keyring); Zomfy asks for one when it runs a
command (`gh auth token --hostname <host> --user <login>`) and keeps it in memory for five minutes.

GitLab tokens Zomfy holds go to the **OS credential store** through `Bun.secrets` (Windows
Credential Manager, macOS Keychain, libsecret), service `zomfy-hosting`, name
`gitlab:<host>:<login>`. Only the list of accounts (provider, host, login, where the token is) is
written to `~/.zomfy/hosting-accounts.json`. A host without a credential store (a headless Linux
server, a WSL distro without libsecret) keeps the token in that file instead, readable by its owner
only (mode 0600), and the account list says "Stored in Zomfy's file". `state.json`, settings
broadcasts, logs and transcripts never carry a token.

## How the account is applied

1. **Zomfy's own gh/glab calls** (review panel, checks, comments, work items, Create PR, review
   checkout) run with the account in their environment, never by switching:
   - github.com (and `*.ghe.com`): `GH_TOKEN=<token>`.
   - GitHub Enterprise Server: `GH_HOST=<host>`, `GH_ENTERPRISE_TOKEN=<token>`.
   - GitLab: `GITLAB_TOKEN=<token>`, `GITLAB_HOST=<host>`; nothing for glab's own account on that
     host, which glab already uses.
2. **Agents**: a chat in the project (its main checkout or a worktree) starts its agent with the
   same variables, so `gh pr create` or `glab mr create` in a turn acts as the project's account.
   Claude gets them on every turn; an external agent's server gets them when it starts (a changed
   account applies when it restarts). The values are never written to the transcript; an agent that
   prints its environment would show them, as with any variable in Settings › Agents.
3. **git push and fetch over HTTPS**: when the person picks an account, Zomfy writes a credential
   helper for `https://<host>` into the repository's own config (`.git/config`, shared by all its
   worktrees) — first an empty helper, which sets aside the global ones for that URL, then
   Zomfy's:
   - GitHub: a helper that answers `get` with the login and
     `gh auth token --hostname <host> --user <login>`. It works in any terminal, inside Zomfy or not.
   - GitLab with glab's own account: no helper (git already authenticates as that account).
   - GitLab with a token Zomfy holds: a helper that answers with `oauth2` and `$GITLAB_TOKEN`, which
     Zomfy's agents have. Outside Zomfy that variable is unset and git asks as usual.

   Clearing the account (or picking another) removes exactly those entries. SSH remotes are left
   alone: the SSH key decides who pushes. `credential.<url>.username` alone was not enough here:
   gh's own credential helper answers only for its active account (checked with gh 2.102).

## Protocol

- `HostingAccountRef { provider, host, login }`; `Project.hostingAccount?`, in `ProjectPatch`
  (null clears it).
- `HostingAccount` = `HostingAccountRef` + `active` (the CLI's active account for its host),
  `source` (`'gh' | 'glab' | 'zomfy'`), optional `storage` (`'keyring' | 'file'`, Zomfy's tokens),
  optional `problem` (the CLI reported this account failing).
- `_harness/hosting/accounts {}` → `{ accounts, cli: { gh, glab } }` (whether each CLI was found).
- `_harness/hosting/accountAddToken { provider: 'gitlab', host, token }` → `HostingAccount`.
- `_harness/hosting/accountRemove { provider, host, login }` → `{}` (Zomfy's tokens only).
- `_harness/hosting/accountLogin { provider, host, workspaceId? }` → `TerminalInfo`, the login
  terminal in that workspace (else the floating one).
- `_harness/hosting/remoteOf { path? , url? }` → `{ provider, host, repo } | null`: what a folder's
  remote or a clone URL points at, for the account field.

Older daemons refuse the new methods as unknown, and the desktop then hides the account field.

# In the desktop

Project Settings gets an **Account** field for git projects, beside Default base branch:

- A select: "The CLI's active account (<login>)" first, then each account for the remote's host
  (login, with "active" or "Zomfy token" beside it), then "Add account…".
- "Add account…" opens the add step inline under the field (sign-in terminal for GitHub, token form
  for GitLab); the list refreshes afterwards.
- Without a GitHub or GitLab remote the field reads "No GitHub or GitLab remote" and is disabled.
- A saved account that no longer exists on the host shows as "<login> (not signed in here)".

The Add a project dialog uses the same field ([its spec](add-project-dialog.md)).

# Out of scope

- An account per workspace or per chat; one per project is enough.
- Signing in without a terminal (an OAuth flow of Zomfy's own) and GitHub tokens held by Zomfy.
- Zomfy's terminals getting the account's variables (agents only, for now).
- Other providers (Bitbucket, Gitea, Azure DevOps).

# Acceptance

- `bun test` in `packages/daemon` covers: parsing `gh auth status` (JSON and text, active and
  inactive accounts), parsing `glab auth status` (JSON and text, a failing host), the environment
  for github.com, GHES and GitLab, the credential helper's config entries and their removal, the
  account matching the remote, and the token store with a fake keyring that fails over to the file.
- Hosting calls for a project with an account run with its env (a fake runner sees `GH_TOKEN`).
- In the preview, Project Settings shows the Account field with this host's accounts.
