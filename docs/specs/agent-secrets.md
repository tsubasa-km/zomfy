---
type: Spec
title: Secrets agents can use but not see
description: Settings keeps API keys in the OS credential store; an agent's processes get a placeholder and a base URL into a local tunnel in the daemon that puts the real key on requests to the bound host, and the value is redacted from everything Zomfy records or shows.
status: stable
x-zomfy-implementation: done
tags: [secrets, security, agents, environment, daemon, desktop, settings]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T00:00:00Z" }
---

# Problem

The person wants tools their agents run to use an API key (xAI, OpenAI, a company API) without the
model ever reading the key. Settings › Agents can already set environment variables for an agent,
but those are plain environment values: the agent reads them with `env` or `echo $XAI_API_KEY`,
and the value then sits in the model's context, in Zomfy's transcript and on every client.

# Options considered

1. **Plain environment injection.** What the Agents environment does today. Every program the
   agent runs inherits the value, and so can print it. Not secret.
2. **A tunnel in the daemon (chosen for HTTP APIs).** The secret is bound to an upstream URL
   (`https://api.x.ai/v1`). The agent's processes get a **placeholder** in the variable
   (`XAI_API_KEY=zomfy-secret://XAI_API_KEY`) and a **base URL** pointing into the daemon
   (`XAI_BASE_URL=http://127.0.0.1:<port>/t/<route token>`). SDKs and CLIs that honour a base URL
   variable send their request, with the placeholder as the key, to the daemon; the daemon
   replaces the placeholder with the real value in the request's headers and query and forwards it
   to the bound upstream only. The real value never enters the agent's process tree.
   - A forward proxy (`HTTPS_PROXY`) was rejected for now: HTTPS through a proxy is an end-to-end
     TLS tunnel (`CONNECT`), so adding a header needs a local certificate authority every tool must
     trust (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`…), and it would route the
     agent's own model traffic through Zomfy. A base URL needs neither.
3. **A command wrapper** (`zomfy run-with-secrets -- cmd`) that puts the real value into one child
   process and redacts its output. Rejected: the agent chooses the command, so
   `run-with-secrets -- sh -c 'echo $KEY | base64'` reads the key in any encoding redaction cannot
   recognise. It protects against accidents only, which option 4 already does.
4. **Redaction (always on, a safety net).** Every saved value is replaced by `[secret NAME]` in
   what Zomfy records, shows and logs.

**Choice: 2 for HTTP APIs, plus 4 always.** For a tool that cannot take a base URL there is an
explicit **Environment** exposure (option 1 with 4 on top), marked as the weaker one.

# What it does

## A secret

Kept by each host's daemon, like the agents' environment, and listed per host in Settings:

- **Name**: the environment variable name (`XAI_API_KEY`), unique per host.
- **Value**: written once, never read back. After saving the desktop shows `••••••••`; the value
  can be replaced or the secret deleted, nothing else.
- **Exposure**:
  - **Tunnel** (default): an **upstream URL** (`https` only, or `http` to `localhost`) and an
    optional **base URL variable** (`XAI_BASE_URL`, `OPENAI_BASE_URL`…) the agent gets the tunnel
    address in. The agent sees the placeholder `zomfy-secret://NAME` in `NAME`.
  - **Environment**: the agent's processes get the real value in `NAME`.
- **Agents**: the chat agents that get it (Claude, Codex, Grok…); none picked means all.
- **Projects**: the projects whose chats get it; none picked means every chat, quick chats
  included. A chat outside a project only gets secrets with no projects picked.

## Where values live

The value goes to the **OS credential store** through `Bun.secrets` (Windows Credential Manager,
macOS Keychain, libsecret), service `zomfy-secrets`, name `secret:<id>`, using the same store as
[project hosting accounts](project-hosting-accounts.md). `~/.zomfy/secrets.json` (owner-only)
holds the list without values. On a host without a credential store the value goes into that file,
and the list says so (`storage: "file"`), as the GitLab tokens do.

The daemon reads the values into memory at start and when one changes: it needs them to forward
requests and to redact. Values never go to a client, `state.json`, a log line, or a transcript.

## The tunnel

- A local HTTP server in the daemon, bound to `127.0.0.1` on a free port, started when the first
  tunnel secret exists.
- Each tunnel secret has a **route token**: 32 random bytes, new each time the daemon starts. A
  request to `/t/<token>/<path>?<query>` goes to `<upstream>/<path>?<query>`. An unknown token is
  `404`; nothing else is served. Any local process that knows the token can use the route, as the
  agent can: the token stands for "allowed to use this key", not for the key.
- On the way out: hop-by-hop headers and `Host` are dropped, `Accept-Encoding: identity` is asked
  for, and every `zomfy-secret://NAME` of **this** secret in a header value or the query becomes
  the real value. Other secrets' placeholders are left as they are, so a route cannot carry
  another key to its host. Redirects are returned to the caller, not followed.
- On the way back: the value is redacted from the response headers and body (streamed, matches
  that straddle chunks included), so an upstream that echoes the key does not hand it over.
- Deleting a secret closes its route at once; replacing its value takes effect on the next request.

## Redaction

Every value of at least 6 characters is replaced by `[secret NAME]` in:

- each session update before it is recorded and sent (transcripts, replays, phones, bots);
- what `terminal_read` returns to an agent;
- the daemon's log.

## Which processes get secrets

Processes the daemon starts for a chat's turns: Claude turns and the external agents' ACP or App
Server processes, with the agent and the chat's project deciding which secrets apply. A secret
changed while an agent's process runs applies when that process next starts (a new chat, a
restarted agent, a daemon restart). Terminals, project hooks and language servers get none.

## What it does not protect

- **Environment exposure**: the agent can print the value (`env`, `echo`), and for Claude Code,
  Codex and the other CLIs the tool's output goes from the CLI to the model before Zomfy sees it.
  Redaction keeps it out of Zomfy's screens and records, not out of the model's context. The form
  says so in one line when Environment is picked.
- **Tunnel exposure** keeps the value out of the agent's processes, but the agent can still **use**
  the key through the tunnel: send any request the bound API accepts, with the person's quota.
- A tool that ignores the base URL variable sends the placeholder to the real host and fails
  (`401`); it is not a leak. Such a tool needs Environment exposure, with its weaker protection.
- A value the person pastes into a chat, a file the agent reads (`.env`), or an encoded form of the
  value (base64) is not recognised by redaction.

## Settings › Secrets & environment

A page of its own under AI Capabilities, one block per connected host:

- The host's name and a **Reload environment** button
  ([live environment](live-environment.md)).
- One row per secret: a key mark, the name in monospace, the exposure as a mark (tunnel: a link
  mark in the success green; environment: a variable mark in the warning colour), the upstream's
  host, the agents it is limited to as their icons, the projects as chips, and `••••••••`. Replace
  opens a password field in place; Delete asks once.
- **Add a secret** opens the same row as a form: name, value, a Tunnel/Environment switch, the
  upstream URL and base URL variable for Tunnel, agent toggles and project chips. Save is offered
  only when the form is complete ([save buttons](save-buttons.md)).
- No helper sentences; the risk line under Environment is the only text beyond labels and errors.

# Protocol

`packages/protocol/src/secrets.ts`:

- `_harness/secrets/list` → `SecretInfo[]` (no values).
- `_harness/secrets/save` `{ id?, name, value?, exposure, upstream?, baseUrlVariable?, agents,
  projectIds }` → `SecretInfo[]`. `value` is required for a new secret and optional when editing.
- `_harness/secrets/delete` `{ id }` → `SecretInfo[]`.
- `_harness/environment/reload` → `{ changed: string[] }`, the names (never values) of the
  variables that differ from the previous snapshot.

# Acceptance

- With fake stores and a fake upstream server: the environment an agent gets holds only the
  placeholder and the base URL for a tunnel secret; a request through the tunnel reaches the
  upstream with the real header; the upstream's echo of the key comes back redacted; another
  secret's placeholder is not substituted; a deleted secret's route answers 404.
- The value is redacted from session updates and from `terminal_read`.
- `_harness/secrets/list` never carries a value; `secrets.json` holds none when a store exists.
- Settings › Secrets & environment shows the list, the add form and Replace/Delete in light and
  dark.

# Later

- Header injection for tools that send no key at all (`Authorization: Bearer {value}` set by the
  tunnel).
- Placeholders and the tunnel in terminals the agent drives.
- A per-project page that edits the project's secrets from Project settings.
