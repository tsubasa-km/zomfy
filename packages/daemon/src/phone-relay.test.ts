import { afterEach, describe, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodePairingOffer,
  phoneDeviceProofMessage,
  SCOPE_REFUSED_CODE,
  toBase64Url,
  type DeviceScope,
  type PhoneChannelAnswer,
  type RemoteDevicesSnapshot,
} from "@zomfy/protocol";
import { limits, relayDeviceId } from "@zomfy/relay-contract";
import { ConnectorClient } from "./connector-client";
import { ReceiptStore, receiptsPath } from "./connector-receipts";
import { DeviceStore } from "./device-store.ts";
import { PhoneRelay } from "./phone-relay.ts";
import { RelayChannels } from "./relay-channels.ts";
import { eventually } from "./relay-fake-hub.fixture";
import { deviceKeys, TestPhone } from "./phone-relay-phone.fixture";
import { FakePhoneHub } from "./relay-fake-phone-hub.fixture";
import { loadOrCreateHostKey, pairWithRelay, readRelayConfig } from "./relay-pairing";
import { RemoteGateway } from "./remote-gateway.ts";

// The daemon's side of the phone relay against an in-process fake relay: device keys reach the Hub
// through the host, the end-to-end handshake, ACP through the channel with the device's scopes,
// replays, revoke, pairing through the relay, and the link dropping (docs/specs/mobile/relay.md).

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function setup(options: { scopes?: DeviceScope[] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "zomfy-phone-relay-"));
  const hub = new FakePhoneHub();
  cleanups.push(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }), () => hub.stop());
  const keys = await deviceKeys();
  const deviceId = "0b6f7a52-3d0c-4a43-9a57-4f6f1b1c2d3e";
  writeFileSync(
    join(home, "devices.json"),
    JSON.stringify({
      version: 1,
      hostId: "host-1",
      listener: { enabled: false, port: 0 },
      devices: [{ id: deviceId, name: "Pixel", model: null, publicKey: keys.publicKey, boxPublicKey: keys.publicKey, scopes: options.scopes ?? ["chats:read", "chats:operate"], createdAt: 0, lastSeenAt: null }],
    }),
  );
  const store = new DeviceStore(join(home, "devices.json"), join(home, "box-key.json"));
  const prompts: string[] = [];
  const agent = acp
    .agent({ name: "test" })
    .onRequest("initialize", () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
    .onRequest("_harness/sessions/list", (raw: unknown) => raw, () => [{ id: "s1" }])
    .onRequest("_harness/terminals/list", (raw: unknown) => raw, () => [])
    .onRequest("session/prompt", (ctx) => {
      prompts.push(ctx.params.prompt.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
      return { stopReason: "end_turn" as const };
    })
    .onRequest("_harness/state/get", (raw: unknown) => raw, () => ({ big: "x".repeat(limits.maxMessageBytes) }));
  const snapshots: RemoteDevicesSnapshot[] = [];
  const channels = new RelayChannels();
  let relay: PhoneRelay | null = null;
  const gateway = new RemoteGateway({
    store,
    connect: (stream) => agent.connect(stream),
    onChange: (s) => {
      snapshots.push(s);
      relay?.devicesChanged();
    },
    relayRoute: () => relay?.route() ?? null,
    interfaces: () => ({}),
  });
  relay = new PhoneRelay({ gateway, store, relayConfig: () => readRelayConfig(home), handshakeTimeoutMs: 2000 });
  relay.attach(channels);
  await gateway.load(false);
  cleanups.push(() => gateway.stop());

  const config = await pairWithRelay(home, { relayUrl: hub.url, setupCode: hub.setupCode, hostName: "Desk" });
  const receipts = new ReceiptStore(receiptsPath(home));
  cleanups.push(() => receipts.close());
  const client = new ConnectorClient({
    config,
    key: loadOrCreateHostKey(home),
    host: { id: config.hostId, name: "Desk", kind: "desktop" },
    receipts,
    bots: () => [],
    channels,
    link: { backoff: { minMs: 20, maxMs: 50 } },
  });
  client.start();
  cleanups.push(() => client.stop());
  await eventually(() => hub.linked && hub.devices.size === 1, 5000, "the link and the device sync");
  return { hub, store, gateway, relay, keys, deviceId, relayId: relayDeviceId(deviceId), config, client, prompts, snapshots, home };
}

async function phoneFor(s: Awaited<ReturnType<typeof setup>>, relayId = s.relayId, keys = s.keys) {
  const phone = new TestPhone(s.hub.url, s.config.hostId, s.store.hostBoxPublicKey, relayId, keys);
  cleanups.push(() => phone.close());
  return phone;
}

describe("phone relay", () => {
  test("registers the host's devices with the Hub after the link authenticates", async () => {
    const s = await setup();
    expect(s.hub.devices.get(s.relayId)).toBe(s.keys.publicKeyStd);
    expect(s.hub.fromHost.find((m) => m.type === "device-sync")).toMatchObject({ devices: [{ deviceId: s.relayId }] });
  });

  test("a paired phone speaks ACP through the end-to-end channel, and a prompt runs a turn", async () => {
    const s = await setup();
    const phone = await phoneFor(s);
    await phone.connect();
    expect(await phone.auth(s.deviceId)).toEqual({ type: "ready", scopes: ["chats:read", "chats:operate"] });
    const init = await phone.request("initialize", { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
    expect(init.result).toMatchObject({ protocolVersion: acp.PROTOCOL_VERSION });
    expect((await phone.request("_harness/sessions/list")).result).toEqual([{ id: "s1" }]);
    const turn = await phone.request("session/prompt", { sessionId: "s1", prompt: [{ type: "text", text: "marker-through-the-relay" }] });
    expect(turn).toMatchObject({ result: { stopReason: "end_turn" } });
    expect(s.prompts).toEqual(["marker-through-the-relay"]);
    // The relay only ever saw ciphertext.
    expect(JSON.stringify(s.hub.fromPhones)).not.toContain("marker-through-the-relay");
    expect(JSON.stringify(s.hub.fromHost)).not.toContain("marker-through-the-relay");
    // Settings → Devices shows the phone on the relay.
    await eventually(() => s.snapshots.at(-1)?.devices[0]?.route === "relay", 2000, "the route in the snapshot");
    expect(s.snapshots.at(-1)?.devices[0]).toMatchObject({ connected: true, route: "relay" });
  });

  test("the device's scopes hold through the relay", async () => {
    const s = await setup({ scopes: ["chats:read"] });
    const phone = await phoneFor(s);
    await phone.connect();
    await phone.auth(s.deviceId);
    const refused = await phone.request("_harness/terminals/list");
    expect((refused.error as { code: number }).code).toBe(SCOPE_REFUSED_CODE);
    const prompt = await phone.request("session/prompt", { sessionId: "s1", prompt: [] });
    expect((prompt.error as { code: number }).code).toBe(SCOPE_REFUSED_CODE);
    const botChat = await phone.request("_harness/bots/chatCreate", { id: "bot-1", text: "hi" });
    expect((botChat.error as { code: number }).code).toBe(SCOPE_REFUSED_CODE);
  });

  test("a replayed ciphertext frame closes the channel on the daemon side", async () => {
    const s = await setup();
    const phone = await phoneFor(s);
    await phone.connect();
    await phone.auth(s.deviceId);
    await phone.request("_harness/sessions/list");
    s.hub.inject(s.relayId, phone.lastSent!);
    expect((await phone.waitClosed()).code).toBe(limits.closeChannelBroken);
    await eventually(() => s.snapshots.at(-1)?.devices[0]?.connected === false, 2000, "the connection to end");
  });

  test("a proof by another key is refused and closed with 4401", async () => {
    const s = await setup();
    const other = await deviceKeys();
    // The Hub knows the device (its key is right on the socket), but the proof inside is by another key.
    const phone = new TestPhone(s.hub.url, s.config.hostId, s.store.hostBoxPublicKey, s.relayId, s.keys);
    cleanups.push(() => phone.close());
    await phone.connect();
    await phone.waitChannel();
    const proof = toBase64Url(await other.sign(phoneDeviceProofMessage("auth", phone.channel!.transcriptHash)));
    phone.send(JSON.stringify({ type: "auth", deviceId: s.deviceId, proof }));
    expect((await phone.waitClosed()).code).toBe(limits.closeUnauthorized);
  });

  test("a hello for another host's key gets no channel", async () => {
    const s = await setup();
    const phone = new TestPhone(s.hub.url, s.config.hostId, toBase64Url(random(32)), s.relayId, s.keys);
    cleanups.push(() => phone.close());
    await phone.connect();
    // The host's ready names its real key, which this phone did not pin: accept() refuses it.
    await eventually(() => phone.refused, 2000, "the ready to be refused");
    expect(phone.channel).toBeNull();
  });

  test("revoking closes the relay connection within 1 s and the next connect fails", async () => {
    const s = await setup();
    const phone = await phoneFor(s);
    await phone.connect();
    await phone.auth(s.deviceId);
    const started = Date.now();
    await s.gateway.revoke(s.deviceId);
    expect((await phone.waitClosed(1000)).code).toBe(limits.closeRevoked);
    expect(Date.now() - started).toBeLessThan(1000);
    await eventually(() => !s.hub.devices.has(s.relayId), 1000, "the Hub to drop the device");
    const again = await phoneFor(s);
    await expect(again.connect()).rejects.toThrow();
    expect(again.closed?.code).toBe(limits.closeUnauthorized);
  });

  test("a phone pairs through the relay with a grant, then connects as a device", async () => {
    const s = await setup();
    const { link } = s.gateway.offer();
    const offer = decodePairingOffer(link);
    expect(offer.routes.at(-1)).toEqual({ kind: "relay", url: s.hub.url, relayHostId: s.config.hostId });
    expect(offer.relayUrl).toBe(s.hub.url);

    const keys = await deviceKeys();
    const relayId = "d_" + toBase64Url(random(16));
    const phone = await phoneFor(s, relayId, keys);
    await phone.connect(true);
    await phone.waitChannel();
    const request = { grant: offer.grant, name: "New phone", model: null, publicKey: keys.publicKey, boxPublicKey: keys.publicKey };
    const proof = toBase64Url(await keys.sign(phoneDeviceProofMessage("pair", phone.channel!.transcriptHash)));
    phone.send(JSON.stringify({ type: "pair", request, proof }));
    await eventually(() => phone.answers.length > 0, 3000, "the pairing answer");
    const answer = phone.answers[0] as Extract<PhoneChannelAnswer, { type: "paired" }>;
    expect(answer.type).toBe("paired");
    expect(answer.response.deviceId).toBe(relayId.slice(2));
    await eventually(() => s.hub.devices.has(relayId), 2000, "the new device at the Hub");
    phone.close();

    const device = await phoneFor(s, relayId, keys);
    await device.connect();
    expect((await device.auth(answer.response.deviceId)).type).toBe("ready");

    // The grant was burnt.
    const late = await phoneFor(s, "d_" + toBase64Url(random(16)), keys);
    await late.connect(true);
    await late.waitChannel();
    const lateProof = toBase64Url(await keys.sign(phoneDeviceProofMessage("pair", late.channel!.transcriptHash)));
    late.send(JSON.stringify({ type: "pair", request, proof: lateProof }));
    await eventually(() => late.answers.length > 0, 3000, "the refusal");
    expect(late.answers[0]).toMatchObject({ type: "refused" });
  });

  test("when the link drops the phone's connection ends; after it returns a new channel starts", async () => {
    const s = await setup();
    const phone = await phoneFor(s);
    await phone.connect();
    await phone.auth(s.deviceId);
    s.hub.dropLink();
    await eventually(() => phone.presence.includes("host-offline"), 2000, "host-offline");
    await eventually(() => s.snapshots.at(-1)?.devices[0]?.connected === false, 2000, "the connection to end");
    // The client reconnects on its own; the phone hears host-online on the same socket.
    await eventually(() => phone.presence.filter((p) => p === "host-online").length === 2, 5000, "host-online again");
    expect(phone.closed).toBeNull();
    expect((await phone.auth(s.deviceId)).type).toBe("ready");
    expect((await phone.request("_harness/sessions/list")).result).toEqual([{ id: "s1" }]);
  });

  test("a reply too large for one relay frame comes back as an error, not a hang", async () => {
    const s = await setup();
    const phone = await phoneFor(s);
    await phone.connect();
    await phone.auth(s.deviceId);
    const answer = await phone.request("_harness/state/get");
    expect((answer.error as { code: number }).code).toBe(-32002);
    // The channel is still in step after the dropped message.
    expect((await phone.request("_harness/sessions/list")).result).toEqual([{ id: "s1" }]);
    expect(phone.broken).toBe(false);
  });

  test("the snapshot names the relay route while the host is linked", async () => {
    const s = await setup();
    expect(s.gateway.snapshot().relay).toEqual({ kind: "relay", url: s.hub.url, relayHostId: s.config.hostId, online: true });
  });
});
