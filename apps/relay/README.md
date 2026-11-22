# Zomfy Relay

The Cloudflare Worker each person deploys to their own account: the bots connector and the phone
relay in one Worker with one Durable Object, `Hub`, plus `DiscordGateway`, which holds Discord's
Gateway connection ([decision](../../docs/decisions/one-relay-worker.md),
[connector spec](../../docs/specs/bots/connector.md), [Discord spec](../../docs/specs/bots/sources/discord.md)).

It builds on its own: the contract is vendored into `src/contract/` by `bun run relay:vendor` at the
repository root, so there is no `workspace:*` dependency.

## Deploy

Either way works on the Workers Free plan for one person. Holding the Discord Gateway all day uses
about 11,000 of the free 13,000 GB-s of Durable Object time a day; if Cloudflare reports going over,
move the account to Workers Paid (5 USD a month). `GET /health` shows the Gateway's uptime.

### Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tsubasa-km/zomfy/tree/main/apps/relay)

Cloudflare copies this directory into a repository of yours, creates the Worker and its Durable
Objects, and asks for the secrets in [`.dev.vars.example`](.dev.vars.example). Fill in
`SETUP_CODE` (make one with `openssl rand -hex 16`) and the three `DISCORD_*` values from the steps
below; leave the rest empty. Then continue at step 2 of [Discord](#discord).

### `bun run deploy`

From a clone of the repository:

```sh
cd apps/relay
npx wrangler login     # once
bun run deploy         # or npm run deploy
```

It checks that wrangler is signed in, runs `wrangler deploy`, makes a new single-use `SETUP_CODE`
(the first time, or when you ask), asks for the Discord secrets if you want Discord, and prints the
Worker URL, the setup code, the Interactions Endpoint URL and the link that adds the app to your
server. `bun run deploy -- --dry-run` prints the steps without running them.

## Discord

1. At [discord.com/developers/applications](https://discord.com/developers/applications) →
   **New Application** ("Zomfy"). Copy **Application ID** and **Public Key** from General
   Information. On **Bot**: **Reset Token** and copy it, and turn on **Message Content Intent**
   (free for bots in fewer than 100 servers). Give these to `bun run deploy` (or the button).
2. **General Information → Interactions Endpoint URL**: `<worker URL>/discord/interactions`, then
   **Save** (Discord checks it with a signed PING the Worker answers).
3. Add the app to your server with the link `bun run deploy` printed, or **OAuth2 → URL Generator**:
   scopes `bot` and `applications.commands`; permissions View Channels, Send Messages, Send Messages
   in Threads, Create Public Threads, Read Message History, Add Reactions, Embed Links, Attach Files.
4. Open `<worker URL>/health` once: `discordGateway.state` should be `ready`. The Worker registers
   `/ask` and the message command **Ask bot** when the Gateway first connects.
5. In Zomfy: **Settings → Bots → Relay**, paste the Worker URL and the setup code, **Pair**. For each
   bot, **Who can ask → Discord**: your own user id (Discord **Settings → Advanced → Developer
   Mode**, then right-click yourself → **Copy User ID**) as owner, and members the same way.

Then `@Zomfy fix the typo in README` in a channel opens a thread with a status and a Stop button;
`@Zomfy reviewer …` names a bot by handle, otherwise the default bot answers. A DM to the app is a
conversation of its own until you write `new`.

## Develop

```sh
bun run test        # Worker tests in workerd (@cloudflare/vitest-plugin), with a fake Discord
cp .dev.vars.example .dev.vars   # put a made-up SETUP_CODE in it; leave Discord empty
bun run dev         # wrangler dev
bun scripts/fake-daemon.ts http://127.0.0.1:8787 <that setup code>
```

Routes: `GET /health`, `POST /v1/hosts/register`, `POST /v1/hosts/invite`, the daemon's link
`GET /v1/host`, and `POST /discord/interactions` (404 until the Discord secrets are set). Slack,
GitHub, Linear, webhooks and the phone routes follow in later phases.
