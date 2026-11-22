import { afterEach, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATEWAY_CLOSE,
  GATEWAY_PATHS,
  PAIRING_GRANT_TTL_MS,
  SCOPE_REFUSED_CODE,
  decodePairingOffer,
  deviceAuthPayload,
  toBase64Url,
  type DeviceScope,
  type PairResponse,
  type RemoteDevicesSnapshot,
} from "@zomfy/protocol";
import { DeviceStore } from "./device-store.ts";
import { RemoteGateway, isAllowedPeer, localRoutes } from "./remote-gateway.ts";

// The phone's side of the gateway, driven by a test client against a small ACP agent: pairing,
// the challenge, the scope allowlist and revoke (docs/specs/mobile/pairing.md, acceptance).

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function setup(options: { now?: () => number; devices?: unknown[] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "gateway-"));
  const path = join(dir, "devices.json");
  await writeFile(path, JSON.stringify({ version: 1, hostId: "host-1", listener: { enabled: true, port: 0 }, devices: options.devices ?? [] }));
  const store = new DeviceStore(path, join(dir, "box-key.json"), options.now);
  const clients: acp.AgentContext[] = [];
  const agent = acp
    .agent({ name: "test" })
    .onConnect((c) => void clients.push(c.client))
    .onRequest("initialize", () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
    .onRequest("_harness/sessions/list", (raw: unknown) => raw, () => [{ id: "s1" }])
    .onRequest("_harness/terminals/list", (raw: unknown) => raw, () => [])
    .onRequest("_harness/settings/get", (raw: unknown) => raw, () => ({}));
  const snapshots: RemoteDevicesSnapshot[] = [];
  const gateway = new RemoteGateway({
    store,
    connect: (stream) => agent.connect(stream),
    onChange: (s) => void snapshots.push(s),
    bindHostname: "127.0.0.1",
    interfaces: () => ({}),
    authTimeoutMs: 500,
  });
  await gateway.load();
  cleanups.push(() => gateway.stop(), () => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  const base = `http://127.0.0.1:${gateway.port}`;
  return { store, gateway, base, clients, snapshots };
}

async function deviceKeys() {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const sign = async (text: string) => toBase64Url(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(text))));
  return { publicKey, sign };
}

async function pair(base: string, grant: string, keys: { publicKey: string }): Promise<Response> {
  return fetch(base + GATEWAY_PATHS.pair, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant, name: "Pixel", model: "Pixel 9", publicKey: keys.publicKey, boxPublicKey: toBase64Url(new Uint8Array(32).fill(7)) }),
  });
}

/** A device socket: answers the challenge, then speaks JSON-RPC. */
async function connect(base: string, deviceId: string, sign: (text: string) => Promise<string>) {
  const ws = new WebSocket(base.replace("http", "ws") + GATEWAY_PATHS.device);
  const inbox: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  ws.addEventListener("message", async (e) => {
    const frame = JSON.parse(String(e.data));
    if (frame.type === "challenge") {
      ws.send(JSON.stringify({ type: "auth", deviceId, signature: await sign(deviceAuthPayload(frame.hostId, deviceId, frame.nonce)) }));
      return;
    }
    inbox.push(frame);
    for (const w of waiters.splice(0)) w();
  });
  const next = async (match: (m: Record<string, unknown>) => boolean, ms = 2000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = inbox.find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  let id = 0;
  const call = async (method: string, params: unknown = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }));
    return next((m) => m.id === n);
  };
  cleanups.push(() => ws.close());
  return { ws, inbox, next, call, closed };
}

async function paired(setupResult: Awaited<ReturnType<typeof setup>>, scopes?: DeviceScope[]) {
  const keys = await deviceKeys();
  const { offer } = setupResult.gateway.offer(scopes);
  const response = (await (await pair(setupResult.base, offer.grant, keys)).json()) as PairResponse;
  const device = await connect(setupResult.base, response.deviceId, keys.sign);
  await device.next((m) => m.type === "ready");
  await device.call("initialize", { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
  return { ...device, deviceId: response.deviceId, keys };
}

test("hello names the host, and the pairing link decodes to the offer", async () => {
  const s = await setup();
  const hello = (await (await fetch(s.base + GATEWAY_PATHS.hello)).json()) as { hostId: string };
  expect(hello.hostId).toBe("host-1");
  const { offer, link } = s.gateway.offer();
  expect(decodePairingOffer(link)).toEqual(offer);
  expect(offer.hostBoxPublicKey).toHaveLength(43);
  expect(offer.scopes).toContain("terminals:operate");
});

test("a pairing grant works once", async () => {
  const s = await setup();
  const keys = await deviceKeys();
  const { offer } = s.gateway.offer();
  const first = await pair(s.base, offer.grant, keys);
  expect(first.status).toBe(200);
  const body = (await first.json()) as PairResponse;
  expect(body.hostId).toBe("host-1");
  expect(s.store.get(body.deviceId)?.name).toBe("Pixel");
  const second = await pair(s.base, offer.grant, keys);
  expect(second.status).toBe(400);
  expect(s.store.list()).toHaveLength(1);
});

test("a pairing grant is refused after 10 minutes", async () => {
  let now = 1_000_000;
  const s = await setup({ now: () => now });
  const { offer } = s.gateway.offer();
  now += PAIRING_GRANT_TTL_MS + 1;
  const response = await pair(s.base, offer.grant, await deviceKeys());
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: string }).error).toContain("expired");
});

test("a paired device connects, calls what its scopes allow and is refused the rest", async () => {
  const s = await setup();
  const phone = await paired(s, ["chats:read", "chats:operate"]);
  expect((await phone.call("_harness/sessions/list")).result).toEqual([{ id: "s1" }]);
  const terminal = await phone.call("_harness/terminals/list");
  expect((terminal.error as { code: number }).code).toBe(SCOPE_REFUSED_CODE);
  const unlisted = await phone.call("_harness/settings/get");
  expect((unlisted.error as { code: number }).code).toBe(SCOPE_REFUSED_CODE);
  expect(s.snapshots.at(-1)?.devices[0]?.connected).toBe(true);
});

test("notifications and requests a device's scopes do not cover never reach it", async () => {
  const s = await setup();
  const phone = await paired(s, ["chats:read"]);
  const client = s.clients.at(-1)!;
  await client.notify("_harness/terminals/output", { terminalId: "t", data: "secret" });
  await client.notify("session/update", { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } });
  await phone.next((m) => m.method === "session/update");
  expect(phone.inbox.some((m) => m.method === "_harness/terminals/output")).toBe(false);
  // Without chats:operate it cannot answer a permission ask: the gateway refuses it for the phone.
  const ask = client.request("session/request_permission", { sessionId: "s1", toolCall: { toolCallId: "t" }, options: [] });
  await expect(ask).rejects.toThrow();
  expect(phone.inbox.some((m) => m.method === "session/request_permission")).toBe(false);
});

test("a permission ask reaches a device with chats:operate, and its answer goes back", async () => {
  const s = await setup();
  const phone = await paired(s);
  const client = s.clients.at(-1)!;
  const ask = client.request("session/request_permission", {
    sessionId: "s1",
    toolCall: { toolCallId: "t" },
    options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
  });
  const request = await phone.next((m) => m.method === "session/request_permission");
  phone.ws.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { outcome: { outcome: "selected", optionId: "allow" } } }));
  expect(await ask).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
});

test("a bad signature is closed with 4401", async () => {
  const s = await setup();
  const keys = await deviceKeys();
  const { offer } = s.gateway.offer();
  const { deviceId } = (await (await pair(s.base, offer.grant, keys)).json()) as PairResponse;
  const other = await deviceKeys();
  const device = await connect(s.base, deviceId, other.sign);
  expect(await device.closed).toBe(GATEWAY_CLOSE.unauthorized);
});

test("a socket that never answers its challenge is closed", async () => {
  const s = await setup();
  const ws = new WebSocket(s.base.replace("http", "ws") + GATEWAY_PATHS.device);
  const code = await new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  expect(code).toBe(GATEWAY_CLOSE.unauthorized);
});

test("revoking a device closes its connection within 1 s and its next connect fails", async () => {
  const s = await setup();
  const phone = await paired(s);
  const started = Date.now();
  await s.gateway.revoke(phone.deviceId);
  expect(await phone.closed).toBe(GATEWAY_CLOSE.revoked);
  expect(Date.now() - started).toBeLessThan(1000);
  const again = await connect(s.base, phone.deviceId, phone.keys.sign);
  expect(await again.closed).toBe(GATEWAY_CLOSE.unauthorized);
  expect(s.store.list()).toHaveLength(0);
});

test("a device paired 60 days ago still connects", async () => {
  const keys = await deviceKeys();
  const old = Date.now() - 60 * 24 * 3600_000;
  const s = await setup({
    devices: [{ id: "d-old", name: "Old phone", model: null, publicKey: keys.publicKey, boxPublicKey: toBase64Url(new Uint8Array(32)), scopes: ["chats:read"], createdAt: old, lastSeenAt: old }],
  });
  const phone = await connect(s.base, "d-old", keys.sign);
  expect((await phone.next((m) => m.type === "ready")).scopes).toEqual(["chats:read"]);
});

test("turning the listener off closes it; the store keeps the choice", async () => {
  const s = await setup();
  const snapshot = await s.gateway.setListener(false);
  expect(snapshot.listener).toMatchObject({ enabled: false, running: false });
  expect(s.store.listener.enabled).toBe(false);
  await expect(fetch(s.base + GATEWAY_PATHS.hello)).rejects.toThrow();
});

test("only loopback, private and tailnet peers are answered", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.9", "100.101.102.103", "::1", "::ffff:192.168.0.2", "fd7a:115c:a1e0::1", "fe80::1"]) {
    expect(isAllowedPeer(ip)).toBe(true);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860::8888", "::ffff:1.1.1.1", ""]) expect(isAllowedPeer(ip)).toBe(false);
});

test("routes list the LAN, then the tailnet, and skip public and internal addresses", () => {
  const iface = (address: string, internal = false) => ({ address, family: "IPv4" as const, internal, netmask: "", mac: "", cidr: null });
  const routes = localRoutes(7802, {
    lo: [iface("127.0.0.1", true)],
    ts: [iface("100.90.1.2")],
    wifi: [iface("192.168.1.20")],
    wan: [iface("203.0.113.5")],
  });
  expect(routes).toEqual([
    { kind: "lan", url: "http://192.168.1.20:7802" },
    { kind: "tailnet", url: "http://100.90.1.2:7802" },
  ]);
});
