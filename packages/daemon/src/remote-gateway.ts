import type * as acp from "@agentclientprotocol/sdk";
import type { Server, ServerWebSocket } from "bun";
import { networkInterfaces } from "node:os";
import {
  GATEWAY_CLOSE,
  GATEWAY_PATHS,
  PAIRING_LINK_PREFIX,
  REMOTE_CLIENT_REQUEST_SCOPES,
  REMOTE_METHOD_SCOPES,
  REMOTE_NOTIFICATION_SCOPES,
  SCOPE_REFUSED_CODE,
  deviceAuthPayload,
  scopeAllows,
  encodePairingOffer,
  fromBase64Url,
  toBase64Url,
  type DeviceScope,
  type GatewayFrame,
  type GatewayHello,
  type PairRequest,
  type PairResponse,
  type PairingOffer,
  type RemoteDevicesSnapshot,
  type RemoteListenerStatus,
  type RemoteRoute,
} from "@zomfy/protocol";
import { PairingError, type DeviceStore } from "./device-store.ts";
import { log } from "./log.ts";
import { MAX_INCOMING_FRAME_BYTES } from "./websocket-server.ts";

// The remote gateway (docs/specs/mobile/pairing.md, phase M1): an opt-in listener that phones reach
// on the LAN or a tailnet. Like T3 Code's server it listens on every interface but answers only
// loopback, private and tailnet peers. A phone pairs once with a one-time grant, then proves its
// device key on every connect; after that its socket is an ACP connection to the same agent the
// windows use, with every message checked against the scope allowlist in `remote-devices.ts`.

type Message = Record<string, unknown>;
type WireStream = acp.Stream;

export interface RemoteGatewayDeps {
  store: DeviceStore;
  /** Serves one authenticated phone's ACP connection, as a window's would be. */
  connect: (stream: WireStream) => { closed: Promise<void> };
  /** Settings → Devices hears every change (devices, connections, listener). */
  onChange: (snapshot: RemoteDevicesSnapshot) => void;
  /** Interface addresses to bind to and offer; tests pass loopback. */
  bindHostname?: string;
  interfaces?: () => ReturnType<typeof networkInterfaces>;
  /** How long a socket may take to answer its challenge. */
  authTimeoutMs?: number;
}

interface SocketData {
  nonce: string;
  deviceId: string | null;
  scopes: DeviceScope[];
  inbox: ReadableStreamDefaultController<Message> | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Loopback, RFC 1918, link-local, CGNAT/Tailscale (100.64/10) and IPv6 ULA/link-local peers. */
export function isAllowedPeer(address: string): boolean {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return ip === "::1" || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

/** The addresses a phone can reach this host on: tailnet first, then the LAN. */
export function localRoutes(port: number, interfaces: ReturnType<typeof networkInterfaces>): RemoteRoute[] {
  const tailnet: RemoteRoute[] = [];
  const lan: RemoteRoute[] = [];
  for (const addresses of Object.values(interfaces)) {
    for (const a of addresses ?? []) {
      if (a.internal || a.family !== "IPv4" || !isAllowedPeer(a.address) || a.address.startsWith("169.254.")) continue;
      const url = `http://${a.address}:${port}`;
      const [first, second] = a.address.split(".").map(Number);
      if (first === 100 && second! >= 64 && second! <= 127) tailnet.push({ kind: "tailnet", url });
      else lan.push({ kind: "lan", url });
    }
  }
  // The LAN answers fastest at home; the tailnet also works away from it.
  return [...lan, ...tailnet];
}

async function verifySignature(publicKey: string, payload: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(fromBase64Url(publicKey)), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, new Uint8Array(fromBase64Url(signature)), new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

export class RemoteGateway {
  private server: Server<SocketData> | null = null;
  private error: string | null = null;
  private readonly sockets = new Map<string, Set<ServerWebSocket<SocketData>>>();

  constructor(private readonly deps: RemoteGatewayDeps) {}

  /** Reads the device store; opens the listener if Settings left it on and `listen` allows. */
  async load(listen = true): Promise<void> {
    await this.deps.store.load();
    if (listen && this.deps.store.listener.enabled) this.listen();
    this.changed();
  }

  snapshot(): RemoteDevicesSnapshot {
    const { store } = this.deps;
    return {
      hostId: store.hostId,
      hostName: store.hostName,
      devices: store.list().map((d) => store.toPublic(d, (this.sockets.get(d.id)?.size ?? 0) > 0)),
      listener: this.listenerStatus(),
    };
  }

  async setListener(enabled: boolean, port?: number): Promise<RemoteDevicesSnapshot> {
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error("The port must be between 1024 and 65535");
    await this.deps.store.setListener(enabled, port);
    this.close();
    if (enabled) this.listen();
    this.changed();
    return this.snapshot();
  }

  offer(scopes?: DeviceScope[]): { offer: PairingOffer; link: string } {
    const { store } = this.deps;
    const grant = store.createGrant(scopes);
    const offer: PairingOffer = {
      v: 1,
      hostId: store.hostId,
      hostName: store.hostName,
      routes: this.server ? this.listenerStatus().routes : [],
      hostBoxPublicKey: store.hostBoxPublicKey,
      grant: grant.grant,
      expiresAt: grant.expiresAt,
      scopes: grant.scopes,
    };
    const link = encodePairingOffer(offer);
    if (!link.startsWith(PAIRING_LINK_PREFIX)) throw new Error("Bad pairing link");
    return { offer, link };
  }

  /** Deletes the device and closes its open connections at once. */
  async revoke(deviceId: string): Promise<RemoteDevicesSnapshot> {
    await this.deps.store.revoke(deviceId);
    for (const ws of this.sockets.get(deviceId) ?? []) ws.close(GATEWAY_CLOSE.revoked, "This phone was unpaired");
    this.sockets.delete(deviceId);
    this.changed();
    return this.snapshot();
  }

  stop(): void {
    this.close();
  }

  get port(): number | null {
    return this.server?.port ?? null;
  }

  private listenerStatus(): RemoteListenerStatus {
    const { enabled, port } = this.deps.store.listener;
    const bound = this.server?.port ?? port;
    return {
      enabled,
      port,
      running: this.server !== null,
      error: this.error,
      routes: !this.server
        ? []
        : this.deps.bindHostname === "127.0.0.1"
          ? // Loopback only: the Android Emulator reaches this computer's 127.0.0.1 as 10.0.2.2.
            [
              { kind: "lan", url: `http://10.0.2.2:${bound}` },
              { kind: "lan", url: `http://127.0.0.1:${bound}` },
            ]
          : localRoutes(bound, (this.deps.interfaces ?? networkInterfaces)()),
    };
  }

  private changed(): void {
    this.deps.onChange(this.snapshot());
  }

  private close(): void {
    for (const set of this.sockets.values()) for (const ws of set) ws.close(1001, "The listener was turned off");
    this.sockets.clear();
    this.server?.stop(true);
    this.server = null;
  }

  private listen(): void {
    const { port } = this.deps.store.listener;
    try {
      this.server = Bun.serve<SocketData>({
        hostname: this.deps.bindHostname ?? "0.0.0.0",
        port,
        fetch: (req, srv) => this.fetch(req, srv),
        websocket: {
          maxPayloadLength: MAX_INCOMING_FRAME_BYTES,
          open: (ws) => this.opened(ws),
          message: (ws, message) => void this.received(ws, typeof message === "string" ? message : new TextDecoder().decode(message)),
          close: (ws) => this.closed(ws),
        },
      });
      this.error = null;
      log(`remote gateway listening on port ${this.server.port}`);
    } catch (error) {
      this.server = null;
      this.error = error instanceof Error ? error.message : String(error);
      log(`remote gateway could not listen on port ${port}: ${this.error}`);
    }
  }

  private async fetch(req: Request, srv: Server<SocketData>): Promise<Response | undefined> {
    const peer = srv.requestIP(req)?.address ?? "";
    if (!isAllowedPeer(peer)) {
      log(`remote gateway refused ${peer}: not a private or tailnet address`);
      return new Response("forbidden", { status: 403 });
    }
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === GATEWAY_PATHS.hello && req.method === "GET") {
      return json({ hostId: this.deps.store.hostId, hostName: this.deps.store.hostName } satisfies GatewayHello);
    }
    if (url.pathname === GATEWAY_PATHS.pair && req.method === "POST") {
      try {
        const record = await this.deps.store.pair((await req.json()) as PairRequest);
        this.changed();
        log(`paired device ${record.id} (${record.name})`);
        const { store } = this.deps;
        return json({ deviceId: record.id, hostId: store.hostId, hostName: store.hostName, scopes: record.scopes } satisfies PairResponse);
      } catch (error) {
        return json({ error: error instanceof PairingError ? error.message : "Pairing failed" }, 400);
      }
    }
    if (url.pathname === GATEWAY_PATHS.device) {
      const data: SocketData = { nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(32))), deviceId: null, scopes: [], inbox: null, timer: null };
      if (srv.upgrade(req, { data })) return undefined;
      return new Response("upgrade failed", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  }

  private opened(ws: ServerWebSocket<SocketData>): void {
    ws.send(JSON.stringify({ type: "challenge", hostId: this.deps.store.hostId, nonce: ws.data.nonce } satisfies GatewayFrame));
    ws.data.timer = setTimeout(() => ws.close(GATEWAY_CLOSE.unauthorized, "No answer to the challenge"), this.deps.authTimeoutMs ?? 10_000);
  }

  private async received(ws: ServerWebSocket<SocketData>, text: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (ws.data.deviceId === null) return this.authenticate(ws, message as GatewayFrame);
    const device = this.deps.store.get(ws.data.deviceId);
    if (!device) return ws.close(GATEWAY_CLOSE.revoked, "This phone was unpaired");
    void this.deps.store.seen(device.id);
    for (const one of Array.isArray(message) ? message : [message]) this.fromPhone(ws, one as Message);
  }

  private async authenticate(ws: ServerWebSocket<SocketData>, frame: GatewayFrame): Promise<void> {
    if (ws.data.inbox || frame?.type !== "auth" || typeof frame.deviceId !== "string" || typeof frame.signature !== "string") {
      return ws.close(GATEWAY_CLOSE.unauthorized, "Expected auth");
    }
    const { store } = this.deps;
    const device = store.get(frame.deviceId);
    const ok = device && (await verifySignature(device.publicKey, deviceAuthPayload(store.hostId, device.id, ws.data.nonce), frame.signature));
    // Revoked while the signature was being checked.
    if (!ok || !store.get(frame.deviceId)) return ws.close(GATEWAY_CLOSE.unauthorized, "This phone is not paired with this host");
    if (ws.data.timer) clearTimeout(ws.data.timer);
    ws.data.deviceId = device.id;
    ws.data.scopes = [...device.scopes];
    const set = this.sockets.get(device.id) ?? new Set();
    set.add(ws);
    this.sockets.set(device.id, set);
    ws.send(JSON.stringify({ type: "ready", scopes: ws.data.scopes } satisfies GatewayFrame));
    void store.seen(device.id);
    this.deps.connect(this.streamOf(ws));
    this.changed();
  }

  /** The ACP stream of an authenticated socket; what the daemon sends the phone is checked here. */
  private streamOf(ws: ServerWebSocket<SocketData>): WireStream {
    const readable = new ReadableStream<Message>({
      start: (controller) => {
        ws.data.inbox = controller;
      },
    });
    const writable = new WritableStream<Message>({
      write: (message) => {
        for (const one of (Array.isArray(message) ? message : [message]) as Message[]) this.toPhone(ws, one);
      },
      close: () => ws.close(1000),
      abort: () => ws.close(1011),
    });
    return { readable, writable } as unknown as WireStream;
  }

  private fromPhone(ws: ServerWebSocket<SocketData>, message: Message): void {
    const method = typeof message.method === "string" ? message.method : null;
    if (method && !scopeAllows(REMOTE_METHOD_SCOPES, method, ws.data.scopes)) {
      if (message.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: SCOPE_REFUSED_CODE, message: `This phone may not call ${method}` } }));
      }
      return;
    }
    ws.data.inbox?.enqueue(message);
  }

  private toPhone(ws: ServerWebSocket<SocketData>, message: Message): void {
    const method = typeof message.method === "string" ? message.method : null;
    if (method && message.id !== undefined) {
      if (!scopeAllows(REMOTE_CLIENT_REQUEST_SCOPES, method, ws.data.scopes)) {
        // Answered for the phone, so the daemon does not wait on it (a permission ask without chats:operate).
        ws.data.inbox?.enqueue({ jsonrpc: "2.0", id: message.id, error: { code: SCOPE_REFUSED_CODE, message: `A phone does not answer ${method}` } });
        return;
      }
    } else if (method && !scopeAllows(REMOTE_NOTIFICATION_SCOPES, method, ws.data.scopes)) {
      return;
    }
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  private closed(ws: ServerWebSocket<SocketData>): void {
    if (ws.data.timer) clearTimeout(ws.data.timer);
    try {
      ws.data.inbox?.close();
    } catch {
      // Already closed.
    }
    ws.data.inbox = null;
    const { deviceId } = ws.data;
    if (deviceId) {
      const set = this.sockets.get(deviceId);
      set?.delete(ws);
      if (set && set.size === 0) this.sockets.delete(deviceId);
      this.changed();
    }
  }
}
