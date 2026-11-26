---
type: Spec
title: Zomfy Relay settings, its features, and setting it up with an agent
description: A top-level Settings page for the one Zomfy Relay Worker that shows its pairing and health, lets the person tick the features they want (phone, Discord, Slack, GitHub, Linear, webhooks) and says what each needs, and starts a chat that deploys and configures it with an agent.
status: stable
x-zomfy-implementation: done
tags: [relay, cloudflare, settings, desktop, bots, mobile, mcp]
sources:
  - id: person
    resource: "the person's request of 2026-11-26"
    title: One Cloudflare server with features chosen in settings, set up with an agent
  - id: cf-plugin
    resource: https://github.com/cloudflare/skills
    title: Cloudflare's agent plugin (skills and the Cloudflare MCP server)
  - id: cf-mcp
    resource: https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/
    title: Cloudflare's MCP servers; https://mcp.cloudflare.com/mcp covers the whole Cloudflare API
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

Zomfy Relay is one Worker that carries both the bots' sources and the phone relay
([decision](../decisions/one-relay-worker.md)). Its settings live under Settings → Bots, so a
person who only wants the phone app finds them in the wrong place, and nothing tells them which
secrets the features they want need, or what the deployed relay actually has. Setting it up means
reading the README and pasting secrets into Cloudflare by hand.[^person]

# Who it is for

Anyone using Zomfy Relay: for the phone app away from home, for bots asked from Discord, Slack,
GitHub, Linear or webhooks, or both.

# The Worker

## Features

The relay's features are `phone`, `discord`, `slack`, `github`, `linear` and `webhooks`.

- **Without `FEATURES`** (as before): every source whose secrets are all set is on, and `phone` and
  `webhooks`, which need no secrets of the deployment, are always on.
- **`FEATURES`**, a new optional plain-text variable: a comma- or space-separated list of features.
  When it is set, only the listed features are served; a listed source still needs its secrets.
  Unknown names are ignored. Routes of a feature that is off answer 404 like any unknown route:
  - `phone`: `GET /v1/device/<hostId>/ws` and `POST /v1/hosts/invite` (phone pairing invites);
  - `webhooks`: `POST /hooks/…`;
  - each source: its own routes, as before.
  `GET /health`, `POST /v1/hosts/register` and `GET /v1/host` are always served: a host pairs and
  links whatever the features.
- The Deploy to Cloudflare button lists `FEATURES` with the secrets; `bun run deploy` leaves it as
  it is.

## `/health`

Adds, next to `sources`:

- `features`: the features served now.
- `featuresFrom`: `"FEATURES"` when the variable is set, else `"secrets"`.
- `missing`: for a source that is wanted (listed in `FEATURES`, or with some but not all of its
  secrets set), the **names** of the secrets it still lacks, e.g. `{ "slack": ["SLACK_SIGNING_SECRET"] }`.
  Only names, never values.
- `setupCode`: whether `SETUP_CODE` is set (a boolean).

`/health` answers with `Access-Control-Allow-Origin: *`, so the desktop can check a URL before it is
paired. It held nothing secret before and holds nothing secret now.

# The desktop

## Settings → Zomfy Relay

A new top-level section, **Zomfy Relay** (id `relay`, in the *Remote Hosts* group, first), holds
what was the Relay card of Settings → Bots, and more:

1. **Status.** Not paired: the Worker URL and setup code fields with **Pair**, plus **Check**, which
   reads `<url>/health` and shows the version and the features that relay has, before pairing.
   Paired: the state (Connected, Offline…), the Worker URL, host id, last hello, the relay's
   version, its features, and **Unpair**. The features come from the daemon's last read of
   `/health` (`ConnectorStatus.features`, `missing`, `relayVersion`).
2. **Features.** A checkbox per feature: *Phone app*, *Discord*, *Slack*, *GitHub*, *Linear*,
   *Webhooks*, stored in the window's settings (`relayFeatures`, default `["phone"]`). Each ticked
   feature shows a row with:
   - its state on the relay: *On*, *Needs secrets: NAME, NAME* (from `missing`), *Off on the relay*,
     or *Check the relay* when no health has been read;
   - what it needs: the secret names (with one line each on where to find them), the source's
     own steps in a sentence, and a link to its guide; for a source that is on, the URLs to paste
     into the source (what the Sources card of Bots showed);
   - Phone app: no secrets; pair the relay here, then Settings → Devices → Pair a phone.
   Under the list, the `FEATURES` value for the ticked features (`phone,discord`), labelled only
   `FEATURES`, to set on the Worker when the person wants only those served.
3. **Set up.** *Set up with an agent* (below), *Deploy to Cloudflare*, and *Guide* (the README),
   then the two commands (`bun run deploy`, `bun run relay:local`) behind a terminal icon.

The sections carry no description sentences ([ui-principles.md](ui-principles.md)); the feature
rows' secret names and where to find each stay, since setting up can't be done without them.

Settings → Bots keeps a one-line relay summary (state and sources) with **Relay settings**, which
opens this section, and keeps its bots. Settings → Devices points here (*Zomfy Relay settings*)
where it said "Settings → Bots".

## Set up with an agent

A dialog opened from the Relay page:

- **Features**: the ticked features, read-only. The button is off with none ticked. The dialog has
  no description line and no hint sentences.
- **Where**: the Zomfy checkouts among this computer's projects (a project whose folder has
  `apps/relay/wrangler.jsonc`), or *Clone Zomfy into a new folder* (the default when there is none),
  which clones `https://github.com/tsubasa-km/zomfy` into the default clone folder (or adds that
  folder when it is already there) and starts the chat in it.
- **Cloudflare MCP server**: a checkbox, off by default: "Give this chat Cloudflare's MCP server",
  with the server's URL under it. It is the server of Cloudflare's own agent plugin
  (`cloudflare@claude-plugins-official`, also `cloudflare/skills`),[^cf-plugin] at
  `https://mcp.cloudflare.com/mcp`, which covers the whole Cloudflare API; the claude.ai
  "Cloudflare Developer Platform" connector is deprecated in its favour.[^cf-mcp] It is added to
  **this chat only** (not to the host's Claude settings), and the chat's Connectors offer
  **Sign in** for it, Cloudflare's OAuth in the browser. Without it the agent uses `wrangler`.
  Installing the whole plugin (its skills too) stays the person's choice in Claude Code
  (`/plugin install cloudflare@claude-plugins-official`); Zomfy does not change `~/.claude`.
- **Language**: English or 日本語, the UI's language by default.
- **Prompt**: an editable text box with the ready-made prompt for the features, place, language
  and MCP choice. Changing a choice rewrites it until the person edits it; *Reset prompt* brings it
  back.
- **Start chat**: makes the place if needed, starts a Claude chat there (with the MCP server when
  ticked) and sends the prompt; the settings close and the chat shows.

### The prompt

Built by `buildRelaySetupPrompt` (`apps/desktop/src/lib/relay-setup-prompt.ts`; the Japanese
text in `apps/desktop/src/i18n/ja/relay-setup-prompt.ts`). It asks the agent to:

1. read `apps/relay/README.md` and this spec first;
2. deploy Zomfy Relay to the person's own Cloudflare account for exactly the chosen features, step
   by step, saying before each step what it will do, and waiting where the person has to act
   (sign in with `npx wrangler login`, make a Discord app, …);
3. **ask the person for every secret** and never invent one: for each, give the person the
   command `npx wrangler secret put NAME` in a fenced block (Zomfy's Run button runs it in a
   terminal), so the value is typed into wrangler's own prompt and the agent never sees it; if the
   person pastes a secret into the chat anyway, pass it only on standard input and never repeat it;
   never echo, print, log or commit a secret, nor write one to a file in the repository;
4. set `FEATURES` to the chosen list; it is not secret, so the agent may set it itself, with
   `wrangler secret put FEATURES` so later deploys keep it (a `vars` entry would be reset by them);
5. have the person make `SETUP_CODE` the same way (`openssl rand -hex 16`, then
   `wrangler secret put SETUP_CODE`) and keep it for pairing;
6. check `GET <worker URL>/health` and that `features` and `missing` match;
7. tell the person to pair in Settings → Zomfy Relay (URL and setup code), then what each source
   still needs (the URLs to paste) and, for the phone, Settings → Devices → Pair a phone;
8. never change anything else in the Cloudflare account, never delete Workers, and stop and ask
   when something is unclear.

With the MCP server it may use it for account lookups and checks; otherwise `wrangler`.

## Protocol

- `ConnectorStatus` gains optional `features`, `missing` and `relayVersion` (absent on older
  daemons).
- `_harness/sessions/create` takes optional `connectors: ChatConnectorPreset[]`; the one preset is
  `cloudflare`. It is kept on the chat (`SessionInfo.connectors`), and its Claude turns and its
  Connectors' control process get `{ cloudflare: { type: "http", url: "https://mcp.cloudflare.com/mcp" } }`
  in `mcpServers`. Other agents ignore it. An older daemon ignores the field.

# Not in scope

- Zomfy deploying the relay itself, or holding Cloudflare credentials.
- Installing Claude Code plugins or editing the host's `~/.claude` settings.
- Turning features on or off on a deployed relay from Zomfy: the person (or the agent) sets
  `FEATURES` and the secrets in Cloudflare.

# Acceptance

- Without `FEATURES`, `/health` lists `phone`, `webhooks` and the sources with all their secrets;
  with `FEATURES=phone,slack` and Slack's secrets set, only `phone` and `slack` are served, and
  `/hooks/…` and Discord's routes answer 404; with `FEATURES=slack` and no Slack secrets, `missing`
  names both Slack secrets. `/health` never contains a secret value, and allows any origin.
- Settings shows **Zomfy Relay**; unpaired it has the pair form and Check; paired, the state and
  the relay's features. Ticking a feature shows what it needs.
- Bots and Devices point to the page.
- *Set up with an agent* shows the prompt in English and Japanese, editable; Start chat starts a
  Claude chat in the checkout with the prompt, and with the box ticked the chat lists `cloudflare`
  in its Connectors.
- Unit tests cover the Worker's features and health, the daemon's preset servers and health
  fields, and the prompt builder.
