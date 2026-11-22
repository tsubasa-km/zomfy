---
type: Spec
title: Usage limits by the context ring, and connector icons
description: The chat's context-usage card also shows the account's usage limits, and the Session panel's Connectors list shows each MCP server's icon.
status: stable
x-zomfy-implementation: in-progress
tags: [session-panel, chat, mcp, usage-limits]
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Why

Two follow-ups to the Session panel. Whoever is typing in a chat looks at the composer, not the
right sidebar: when a turn is about to hit a 5-hour or weekly limit, the place to learn it is the
context ring they already hover. And the Connectors list is a column of names; the Claude app shows
each connector's logo, which makes a long list quick to scan.

# Usage limits in the context card

- The card that opens from the composer's context ring (hover, click or Enter) shows, under the
  context numbers, the same usage limits as the Session panel's *Usage limits* section: per account
  (Claude; Codex when signed in) each window — 5-hour session, weekly, weekly per model — with its
  percent, a meter and when it resets.
- The data is the chat's host's, from `stores/usage-limits-store.ts`; the card asks for it only
  while it is open, so a closed ring adds no polling.
- While nothing has been read yet it says so; an account with no plan limits or an error reads as
  in the panel.
- A link at the bottom, *Open the Session panel*, opens the right sidebar's Session panel for the
  chat's workspace and closes the card.

# Connector icons

Each row in *Connectors* starts with a 20 px icon, with the status dot on its corner:

- **claude.ai connectors** (`scope: claudeai`) are known by name: a built-in map from service names
  (Gmail, Google Calendar, Google Drive, Google Workspace, Cloudflare, Notion, Excalidraw, Kintone,
  Slack, GitHub, Linear, Atlassian, Asana, Figma, Canva, Box, Sentry, Stripe, Vercel, Zapier,
  HubSpot, Claude…) to the service's domain. A name not in the map falls back to the server URL.
- **Remote servers** (http, sse) use their URL's domain (`mcp.notion.com` → its site's icon).
- **stdio servers** show a terminal icon, **plugin** servers a puzzle piece, Zomfy's own tools server
  the app's icon. A server whose domain is local (localhost, an IP address, a single-label name)
  gets the generic icon of its transport.
- Anything without an icon shows a letter avatar: the server's first letter on a colour picked
  from its name.

## Fetching favicons

- The desktop never loads a remote image straight into the page (the CSP allows only `self` and
  `data:`, and a page load per render would tell the site each time). The local daemon fetches a
  domain's icon once and answers a `data:` URL: `_harness/favicon` with `{ domain }` →
  `{ dataUrl | null }`. Requests always go to the local host's daemon, so a remote host never
  fetches on the desktop's behalf.
- The daemon fetches `https://<domain>/` (no cookies, a plain user agent, 5 s timeout, 512 KB cap),
  takes the best `<link rel="icon">` / `apple-touch-icon` it declares, else `/favicon.ico`, and
  keeps only an `image/*` answer of at most 256 KB. For a subdomain (`mcp.notion.com`) whose page
  has no icon it tries the site's own domain (`notion.com`).
- Only public names are fetched: no IP addresses, `localhost`, single-label or `.local`/`.internal`
  names. Results, hits and misses, are cached on disk in the daemon's home (`favicons/`) — hits for
  30 days, misses for a day — and in memory; concurrent asks for one domain share one fetch.
- The desktop also caches per domain for the app's run, so re-renders and re-reads of the list
  never ask again.

## What the SDK gives

`McpServerStatus` (Claude Agent SDK 0.3.305) carries `name`, `status`, `serverInfo { name, version }`,
`config` (with `url` for http/sse/claudeai-proxy, `id` for a claude.ai connector), `scope`, `source`
and `tools`: no icon URL. For claude.ai connectors the URL is Anthropic's proxy, so its domain says
nothing about the service; that is why those are known by name.

# Not in scope

- Bundled brand artwork: icons come from each service's own site.
- Icons anywhere but the Connectors list.

# Acceptance

- With the card open, the 5-hour and weekly windows (and Codex's, when signed in) appear under the
  context numbers with reset times; *Open the Session panel* opens it.
- In Connectors, Gmail, Google Calendar, Notion and the like show their service's icon; a stdio
  server shows the terminal icon; a server whose icon cannot be fetched shows its letter.
- Opening the panel again or re-reading the list makes no new favicon requests.
- Daemon unit tests cover the domain rules (public-name check, site domain), icon picking from
  HTML, and the cache.
