# Directory Update Log

## 2026-11-22
* **Update**: Built the daemon part of phase B1 of [Zomfy Bots](specs/bots/overview.md): bot records and homes, the `_harness/bots/*` handlers and `chatCreate`, deliveries to chats and turns, replies through a durable outbox, and the connector started with the daemon ([daemon](specs/bots/daemon.md#built-so-far)); bot chats in the protocol for the [desktop](specs/bots/desktop.md).
* **Update**: Built phase B0 of [Zomfy Bots](specs/bots/overview.md): the [contract](specs/bots/contract.md) is done; the [connector](specs/bots/connector.md), [daemon](specs/bots/daemon.md) and [pairing](specs/mobile/pairing.md) specs are in progress, each with a "Built so far" section and the details that changed while building (link channel, `hello-bots` pages, `helloRev` on every later message, `@cloudflare/vitest-plugin`).
* **Update**: Folded the person's answers into the [bots](specs/bots/overview.md) and [phone](specs/mobile/overview.md) specs: Discord Gateway on the Cloudflare side, Deploy button on the public repo, APK on EAS cloud, Expo and Firebase accounts, one Discord and one Slack app per deployment, bot homes, approval by default, Bots in the sidebar navigation.
* **Creation**: Specs for [Zomfy Bots](specs/bots/overview.md) (connector, contract, daemon, desktop, and the Discord, Slack, GitHub, Linear and webhook sources) and the [Android app](specs/mobile/overview.md) (pairing, relay, app, push), all planned; the decision on [one Cloudflare Worker for bots and the phone relay](decisions/one-relay-worker.md).
* **Initialization**: Made `docs/` an OKF v0.3 bundle: [index](index.md), [specs](specs/), [decisions](decisions/), and front matter on the [research](research/) notes.
* **Creation**: [Documentation-driven development](specs/documentation-driven-development.md) and the decision to [adopt OKF](decisions/adopt-okf.md).
* **Creation**: [One right sidebar per split pane](specs/pane-sidebars.md).
* **Update**: [One right sidebar per split pane](specs/pane-sidebars.md) is implemented.
* **Creation**: [Usage limits by the context ring, and connector icons](specs/usage-limits-and-connector-icons.md).
* **Update**: [Usage limits by the context ring, and connector icons](specs/usage-limits-and-connector-icons.md) is implemented.
* **Creation**: [Retire the acp-harness home and executable name](specs/retire-legacy-home.md), in progress.
