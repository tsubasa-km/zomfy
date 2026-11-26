---
type: Spec
title: Signing in to Claude from a chat
description: When a Claude turn fails because the host's Claude Code is signed out or its sign-in expired, the chat says so and offers "Sign in to Claude" (a terminal tab running `claude auth login` on the chat's host) and "Try again"; the usage limits show the same state.
status: stable
x-zomfy-implementation: done
tags: [chat, desktop, daemon, claude, auth]
generated: { by: "claude-code/opus-5.5", at: "2026-11-25T00:00:00Z" }
---

# Problem

When Claude Code's sign-in on a host has expired, a Claude chat's turn ends with
`Failed to authenticate: OAuth session expired and could not be refreshed` and nothing else. The
person does not learn that signing in again fixes it, where to do it, or how to get the turn back.

# What it does

## Detecting it

A Claude turn is **signed out** when the Agent SDK says so: an assistant message carries the error
`authentication_failed`, or the turn's error text reads as a sign-in failure (`Failed to
authenticate`, `OAuth session expired`, `not logged in`, `Please run /login`, `Invalid API key`,
`authentication_error`, `401 Unauthorized`). The same check applies to a turn that throws before
Claude answers.

The notice that ends such a turn says what to do ("Claude Code is not signed in on this host, or
its sign-in expired. Sign in to Claude, then try again."), keeps Claude's own words on a second
line, and carries `{ reason: 'error', signIn: 'claude' }` as its turn end. A client that predates
`signIn` reads it as an ordinary error and offers Retry.

## In the chat

The notice row of a signed-out turn shows two buttons:

- **Sign in to Claude** opens a terminal tab in the chat's workspace on the chat's host running
  `claude auth login` with the environment the chat's turns get (its config folder, say), so the
  login lands on the account the chat uses. The CLI opens the browser and finishes there; the tab
  keeps its output after the command exits. A failure (Claude Code not found, an older daemon)
  shows as an error notice in the chat.
- **Try again** sends the turn's prompt again (the Retry recovery).

## In the usage limits

The session panel's and the context ring's usage limits already read Claude's account. When that
read fails as signed out, Claude's entry says "Claude's sign-in has expired or is missing on this
host" (as Codex's says its saved sign-in expired) and, wherever a chat is known (its session panel, its context card), offers
**Sign in to Claude**, opening the same terminal.

## Protocol

- `TurnEndMeta` `{ reason: 'error' }` gains an optional `signIn: 'claude'`.
- `ProviderUsageLimits` gains an optional `signedOut: true`.
- A new request `_harness/sessions/claudeSignIn` `{ sessionId }` answers the new `TerminalInfo`;
  older daemons refuse it as an unknown method.

# Out of scope

- Signing in inside Zomfy without a terminal (an OAuth flow of Zomfy's own).
- Codex's and other agents' sign-in.
- Retrying on its own once the login finishes.

# Acceptance

- `bun test` in `packages/daemon` covers the detection: the OAuth-expired text, the
  `authentication_failed` assistant error, and an unrelated failure that stays a plain error.
- `bun test` in `apps/desktop` covers reading `signIn` from a turn end.
- In the preview, an injected signed-out notice shows the message with "Sign in to Claude" and
  "Try again".
