---
type: Spec
title: Secrets agents get as environment variables, redacted everywhere Zomfy shows them
description: Settings keeps API keys in the OS credential store and gives them to the chosen agents' processes as environment variables; the agent can read them, and their values are redacted from everything Zomfy records or shows. The page is scoped to one host and one agent at a time.
status: stable
x-zomfy-implementation: in-progress
tags: [secrets, security, agents, environment, daemon, desktop, settings]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T18:00:00Z" }
---

# Problem

The person wants tools their agents run to use an API key (xAI, OpenAI, a company API) without
typing it into each agent's settings or a project's `.env`, and without the key showing up in
Zomfy's transcripts, screens and logs.

# What it does, plainly

A secret is an environment variable the daemon sets for the agent processes it starts. **The agent
can see its value**: any program it runs can print it (`env`, `echo $XAI_API_KEY`), and for Claude
Code, Codex and the other CLIs that output reaches the model before Zomfy sees it. What Zomfy adds:

- the value is kept in the OS credential store, not in a settings file;
- it goes only to the agents and projects picked;
- it is **redacted**, a safety net, from what Zomfy records, shows and logs.

## History

The first version also had a **tunnel**: the agent got a placeholder and a base URL into a local
proxy in the daemon, which put the real key on requests to one bound host. It was removed: it
worked only for tools that honour a base URL variable, it added a server, routes and a second kind
of secret to understand, and the person did not want it. Secrets saved as tunnel secrets become
plain environment secrets when the daemon loads them (their upstream URL and base URL variable are
dropped); the agent then gets the real value in the variable.

# A secret

Kept by each host's daemon and listed per host in Settings:

- **Name**: the environment variable name (`XAI_API_KEY`), unique per host.
- **Value**: written once, never read back. After saving the desktop shows `••••••••`; the value
  can be replaced or the secret deleted, nothing else.
- **Agents**: the chat agents that get it (Claude, Codex, Grok…); none picked means all.
- **Projects**: the projects whose chats get it; none picked means every chat, quick chats
  included. A chat outside a project only gets secrets with no projects picked.

## Where values live

The value goes to the **OS credential store** through `Bun.secrets` (Windows Credential Manager,
macOS Keychain, libsecret), service `zomfy-secrets`, name `secret:<id>`, using the same store as
[project hosting accounts](project-hosting-accounts.md). `~/.zomfy/secrets.json` (owner-only)
holds the list without values. On a host without a credential store the value goes into that file,
and the list says so (`storage: "file"`), as the GitLab tokens do.

The daemon reads the values into memory at start and when one changes, to pass them on and to
redact. Values never go to a client, `state.json`, a log line, or a transcript.

## Redaction

Every value of at least 6 characters is replaced by `[secret NAME]` in:

- each session update before it is recorded and sent (transcripts, replays, phones, bots);
- what `terminal_read` returns to an agent;
- the daemon's log.

It recognises a value as written. A value the person pastes into a chat, a file the agent reads
(`.env`), or an encoded form of the value (base64) is not recognised.

## Which processes get secrets

Processes the daemon starts for a chat's turns: Claude turns and the external agents' ACP or App
Server processes, with the agent and the chat's project deciding which secrets apply. A secret
changed while an agent's process runs applies when that process next starts (a new chat, a
restarted agent, a daemon restart). Terminals, project hooks and language servers get none.

# Settings › Secrets & environment

Secrets are set per **host × agent**, so the page is too
([settings scoped to a host and an agent](settings-host-agent-scope.md)):

- At the top, a **host** picker and an **agent** picker (each agent's icon and name), and the
  host's **Reload environment** button ([live environment](live-environment.md)). The pair picked
  is remembered.
- Below, only the secrets that the picked agent gets on the picked host: those limited to it, and
  those for all agents. Each is a row: a key mark, the name in monospace, the projects it is limited
  to as chips (toggles), whether it is for this agent only or for all agents (the agent's icon
  pressed, or not), a password field showing `••••••••` (typing replaces the value), and Delete.
  Save appears on the row only while something on it differs ([save buttons](save-buttons.md));
  there is no Cancel.
- The last row adds a secret: name and value fields, Save when both are filled. A new secret is for
  the picked agent only; pressing its icon off makes it for all agents.
- No helper sentences.

# Protocol

`packages/protocol/src/secrets.ts`:

- `_harness/secrets/list` → `SecretInfo[]` (no values).
- `_harness/secrets/save` `{ id?, name, value?, agents, projectIds }` → `SecretInfo[]`. `value` is
  required for a new secret and optional when editing. Fields an older client sends (`exposure`,
  `upstream`, `baseUrlVariable`) are ignored.
- `_harness/secrets/delete` `{ id }` → `SecretInfo[]`.
- `_harness/environment/reload` → `{ changed: string[] }`, the names (never values) of the
  variables that differ from the previous snapshot.

# Acceptance

- With fake credential stores: the environment an agent gets holds the secret's value under its
  name, limited by agent and project; a stored tunnel secret loads as an environment secret and
  the file is rewritten without its upstream.
- The value is redacted from session updates and from `terminal_read`.
- `_harness/secrets/list` never carries a value; `secrets.json` holds none when a store exists.
- Settings › Secrets & environment shows the host and agent pickers, that pair's secrets, the add
  row and Delete, in light and dark; the pair picked survives a restart.

# Later

- A per-project page that edits the project's secrets from Project settings.
