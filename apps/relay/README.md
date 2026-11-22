# Zomfy Relay

The Cloudflare Worker each person deploys to their own account: the bots connector and the phone
relay in one Worker with one Durable Object, `Hub`
([decision](../../docs/decisions/one-relay-worker.md), [connector spec](../../docs/specs/bots/connector.md)).

It builds on its own: the contract is vendored into `src/contract/` by `bun run relay:vendor` at the
repository root, so there is no `workspace:*` dependency.

```sh
bun run test        # Worker tests in workerd (@cloudflare/vitest-plugin)
cp .dev.vars.example .dev.vars   # put a made-up SETUP_CODE in it
bun run dev         # wrangler dev
bun scripts/fake-daemon.ts http://127.0.0.1:8787 <that setup code>
```

Routes so far: `GET /health`, `POST /v1/hosts/register`, `POST /v1/hosts/invite`, and the daemon's
link `GET /v1/host`. Source routes, the phone routes and the deploy flow follow in later phases.
