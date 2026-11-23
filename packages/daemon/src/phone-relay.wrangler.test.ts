import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePairingOffer, phoneDeviceProofMessage, toBase64Url, type PhoneChannelAnswer } from "@zomfy/protocol";
import { limits, relayDeviceId } from "@zomfy/relay-contract";
import { ConnectorClient } from "./connector-client";
import { ReceiptStore, receiptsPath } from "./connector-receipts";
import { DeviceStore } from "./device-store.ts";
import { deviceKeys, TestPhone } from "./phone-relay-phone.fixture";
import { PhoneRelay } from "./phone-relay.ts";
import { RelayChannels } from "./relay-channels.ts";
import { eventually } from "./relay-fake-hub.fixture";
import { loadOrCreateHostKey, pairWithRelay, readRelayConfig, type RelayConfig } from "./relay-pairing";
import { RemoteGateway } from "./remote-gateway.ts";

// End to end against a running Zomfy Relay (docs/specs/mobile/relay.md#acceptance): the real Worker
// and Hub under `wrangler dev`, this daemon's phone relay, and a test phone. Skipped unless
// ZOMFY_RELAY_DEV_URL and ZOMFY_RELAY_DEV_SETUP_CODE are set; never point it at a deployment:
//
//   cd apps/relay && bunx wrangler dev --port 8799 --persist-to <empty dir> --var SETUP_CODE:<made up>
//   ZOMFY_RELAY_DEV_URL=http://127.0.0.1:8799 ZOMFY_RELAY_DEV_SETUP_CODE=<made up> bun test src/phone-relay.wrangler.test.ts

const RELAY = process.env.ZOMFY_RELAY_DEV_URL;
const SETUP = process.env.ZOMFY_RELAY_DEV_SETUP_CODE;
const run = RELAY && SETUP ? describe : describe.skip;

run("phone relay against wrangler dev", () => {
  const home = mkdtempSync(join(tmpdir(), "zomfy-phone-e2e-"));
  const deviceId = "4d1f2a8e-6b7c-4e3d-9a10-2b3c4d5e6f70";
  const prompts: string[] = [];
  let keys: Awaited<ReturnType<typeof deviceKeys>>;
  let store: DeviceStore;
  let gateway: RemoteGateway;
  let config: RelayConfig;
  let client: ConnectorClient;
  let receipts: ReceiptStore;
  const channels = new RelayChannels();
  const phones: TestPhone[] = [];

  const startClient = () => {
    client = new ConnectorClient({
      config,
      key: loadOrCreateHostKey(home),
      host: { id: config.hostId, name: "E2E", kind: "desktop" },
      receipts,
      bots: () => [],
      channels,
      link: { backoff: { minMs: 50, maxMs: 200 } },
    });
    client.start();
  };
  const phone = () => {
    const p = new TestPhone(RELAY!, config.hostId, store.hostBoxPublicKey, relayDeviceId(deviceId), keys);
    phones.push(p);
    return p;
  };

  beforeAll(async () => {
    keys = await deviceKeys();
    writeFileSync(
      join(home, "devices.json"),
      JSON.stringify({
        version: 1,
        hostId: "host-e2e",
        listener: { enabled: false, port: 0 },
        devices: [{ id: deviceId, name: "E2E phone", model: null, publicKey: keys.publicKey, boxPublicKey: keys.publicKey, scopes: ["chats:read", "chats:operate"], createdAt: 0, lastSeenAt: null }],
      }),
    );
    store = new DeviceStore(join(home, "devices.json"), join(home, "box-key.json"));
    const agent = acp
      .agent({ name: "e2e" })
      .onRequest("initialize", () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
      .onRequest("_harness/sessions/list", (raw: unknown) => raw, () => [{ id: "s1" }])
      .onRequest("session/prompt", (ctx) => {
        prompts.push(ctx.params.prompt.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
        return { stopReason: "end_turn" as const };
      });
    let relay: PhoneRelay | null = null;
    gateway = new RemoteGateway({
      store,
      connect: (stream) => agent.connect(stream),
      onChange: () => relay?.devicesChanged(),
      relayRoute: () => relay?.route() ?? null,
      interfaces: () => ({}),
    });
    relay = new PhoneRelay({ gateway, store, relayConfig: () => readRelayConfig(home), handshakeTimeoutMs: 5000 });
    relay.attach(channels);
    await gateway.load(false);
    config = await pairWithRelay(home, { relayUrl: RELAY!, setupCode: SETUP!, hostName: "E2E" });
    receipts = new ReceiptStore(receiptsPath(home));
    startClient();
    await eventually(() => channels.online, 10_000, "the link");
  });

  afterAll(() => {
    for (const p of phones) p.close();
    client?.stop();
    gateway?.stop();
    receipts?.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });

  test("a paired phone's prompt runs a turn through the relay", async () => {
    const p = phone();
    await p.connect();
    expect(await p.auth(deviceId)).toEqual({ type: "ready", scopes: ["chats:read", "chats:operate"] });
    expect((await p.request("initialize", { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })).result).toMatchObject({ protocolVersion: acp.PROTOCOL_VERSION });
    expect((await p.request("session/prompt", { sessionId: "s1", prompt: [{ type: "text", text: "through wrangler dev" }] })).result).toEqual({ stopReason: "end_turn" });
    expect(prompts).toEqual(["through wrangler dev"]);
    p.close();
  });

  test("the host going away and coming back keeps the phone's socket; a new channel works", async () => {
    const p = phone();
    await p.connect();
    await p.auth(deviceId);
    client.stop();
    await eventually(() => p.presence.includes("host-offline"), 5000, "host-offline");
    startClient();
    await eventually(() => p.presence.filter((x) => x === "host-online").length === 2, 10_000, "host-online again");
    expect(p.closed).toBeNull();
    expect((await p.auth(deviceId)).type).toBe("ready");
    expect((await p.request("_harness/sessions/list")).result).toEqual([{ id: "s1" }]);
    p.close();
  });

  test("a replayed ciphertext frame closes the channel", async () => {
    const p = phone();
    await p.connect();
    await p.auth(deviceId);
    await p.request("_harness/sessions/list");
    p.sendRaw(p.lastSent!);
    expect((await p.waitClosed(5000)).code).toBe(limits.closeChannelBroken);
  });

  test("a phone pairs through the relay, then connects as a device", async () => {
    const { link } = gateway.offer();
    const offer = decodePairingOffer(link);
    expect(offer.routes).toEqual([{ kind: "relay", url: RELAY!.replace(/\/$/, ""), relayHostId: config.hostId }]);
    const newKeys = await deviceKeys();
    const relayId = "d_" + toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
    const p = new TestPhone(RELAY!, config.hostId, store.hostBoxPublicKey, relayId, newKeys);
    phones.push(p);
    await p.connect(true);
    await p.waitChannel();
    const request = { grant: offer.grant, name: "Paired over the relay", model: null, publicKey: newKeys.publicKey, boxPublicKey: newKeys.publicKey };
    p.send(JSON.stringify({ type: "pair", request, proof: toBase64Url(await newKeys.sign(phoneDeviceProofMessage("pair", p.channel!.transcriptHash))) }));
    await eventually(() => p.answers.length > 0, 5000, "the pairing answer");
    const answer = p.answers[0] as Extract<PhoneChannelAnswer, { type: "paired" }>;
    expect(answer.type).toBe("paired");
    p.close();
    const device = new TestPhone(RELAY!, config.hostId, store.hostBoxPublicKey, relayId, newKeys);
    phones.push(device);
    await eventually(async () => {
      try {
        await device.connect();
        return true;
      } catch {
        return false;
      }
    }, 5000, "the new device to connect");
    expect((await device.auth(answer.response.deviceId)).type).toBe("ready");
    device.close();
  });

  test("revoking closes the phone within 1 s, and its next connect is refused", async () => {
    const p = phone();
    await p.connect();
    await p.auth(deviceId);
    const started = Date.now();
    await gateway.revoke(deviceId);
    expect((await p.waitClosed(1000)).code).toBe(limits.closeRevoked);
    expect(Date.now() - started).toBeLessThan(1000);
    const again = phone();
    await expect(again.connect()).rejects.toThrow();
    expect(again.closed?.code).toBe(limits.closeUnauthorized);
  });
});
