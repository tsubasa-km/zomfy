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
// Phase M2 adds the relay: a phone whose end-to-end channel opened in `phone-relay.ts` is served
// here the same way, through `attachRelay`, so both routes share one connection path.

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
  /** The relay route offers list, while this host is linked to Zomfy Relay. */
  relayRoute?: () => (RemoteRoute & { online: boolean }) | null;
}

interface SocketData {
  nonce: string;
  deviceId: string | null;
  scopes: DeviceScope[];
  inbox: ReadableStreamDefaultController<Message> | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** The route this connection came in on: the peer's kind of address, or the relay. */
  route: RemoteRoute["kind"];
}

/** One phone connection: a socket of the listener, or an end-to-end channel through the relay. */
interface PhoneConn {
  data: SocketData;
  readonly readyState: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

/** What `attachRelay` hands back: the decrypted stream goes in here. */
export interface RelayConnection {
  receive(text: string): void;
  /** The channel closed (the phone left, the link dropped, or it broke). */
  closed(): void;
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
  private readonly sockets = new Map<string, Set<PhoneConn>>();

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
      devices: store.list().map((d) => {
        const open = [...(this.sockets.get(d.id) ?? [])];
        return { ...store.toPublic(d, open.length > 0), route: open.at(-1)?.data.route ?? null };
      }),
      listener: this.listenerStatus(),
      relay: this.deps.relayRoute?.() ?? null,
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
    const relay = this.deps.relayRoute?.() ?? null;
    const offer: PairingOffer = {
      v: 1,
      hostId: store.hostId,
      hostName: store.hostName,
      // LAN, then tailnet, then the relay: the phone prefers the first that answers.
      routes: [
        ...(this.server ? this.listenerStatus().routes : []),
        ...(relay ? [{ kind: relay.kind, url: relay.url, ...(relay.relayHostId ? { relayHostId: relay.relayHostId } : {}) }] : []),
      ],
      ...(relay ? { relayUrl: relay.url } : {}),
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

  /** Settings → Devices hears that something it shows changed (the relay link came or went). */
  notifyChanged(): void {
    this.changed();
  }

  /** Pairs a phone that presented its grant inside a relay channel; throws PairingError. */
  async pairDevice(request: PairRequest, id?: string): Promise<PairResponse> {
    const record = await this.deps.store.pair(request, id);
    this.changed();
    log(`paired device ${record.id} (${record.name}) through the relay`);
    const { store } = this.deps;
    return { deviceId: record.id, hostId: store.hostId, hostName: store.hostName, scopes: record.scopes };
  }

  /**
   * Serves a phone whose relay channel proved its device key: from here its decrypted messages go
   * through the same scope checks and ACP connection as a direct socket's. Null for an unknown device.
   */
  attachRelay(
    deviceId: string,
    sink: { send(text: string): void; close(code: number, reason: string): void },
  ): { scopes: DeviceScope[]; connection: RelayConnection } | null {
    const device = this.deps.store.get(deviceId);
    if (!device) return null;
    let open = true;
    const conn: PhoneConn = {
      data: { nonce: "", deviceId: null, scopes: [], inbox: null, timer: null, route: "relay" },
      get readyState() {
        return open ? 1 : 3;
      },
      send: (text) => {
        if (open) sink.send(text);
      },
      close: (code = 1000, reason = "") => {
        if (!open) return;
        open = false;
        sink.close(code, reason);
        this.closed(conn);
      },
    };
    this.authenticated(conn, device.id, device.scopes);
    return {
      scopes: [...device.scopes],
      connection: {
        receive: (text) => {
          if (open) void this.received(conn, text);
        },
        closed: () => {
          if (!open) return;
          open = false;
          this.closed(conn);
        },
      },
    };
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
    // Only the listener's own sockets: phones on the relay stay.
    for (const [id, set] of this.sockets) {
      for (const ws of set) {
        if (ws.data.route === "relay") continue;
        ws.close(1001, "The listener was turned off");
        set.delete(ws);
      }
      if (set.size === 0) this.sockets.delete(id);
    }
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
      const [first, second] = peer.replace(/^::ffff:/, "").split(".").map(Number);
      const route: RemoteRoute["kind"] = first === 100 && second! >= 64 && second! <= 127 ? "tailnet" : "lan";
      const data: SocketData = { nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(32))), deviceId: null, scopes: [], inbox: null, timer: null, route };
      if (srv.upgrade(req, { data })) return undefined;
      return new Response("upgrade failed", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  }

  private opened(ws: ServerWebSocket<SocketData>): void {
    ws.send(JSON.stringify({ type: "challenge", hostId: this.deps.store.hostId, nonce: ws.data.nonce } satisfies GatewayFrame));
    ws.data.timer = setTimeout(() => ws.close(GATEWAY_CLOSE.unauthorized, "No answer to the challenge"), this.deps.authTimeoutMs ?? 10_000);
  }

  private async received(ws: PhoneConn, text: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (ws.data.deviceId === null) return this.authenticate(ws as ServerWebSocket<SocketData>, message as GatewayFrame);
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
    this.authenticated(ws, device.id, device.scopes, () => ws.send(JSON.stringify({ type: "ready", scopes: ws.data.scopes } satisfies GatewayFrame)));
  }

  /** The connection proved its device: it joins the device's connections and becomes an ACP client. */
  private authenticated(ws: PhoneConn, deviceId: string, scopes: DeviceScope[], ready?: () => void): void {
    ws.data.deviceId = deviceId;
    ws.data.scopes = [...scopes];
    const set = this.sockets.get(deviceId) ?? new Set();
    set.add(ws);
    this.sockets.set(deviceId, set);
    ready?.();
    void this.deps.store.seen(deviceId);
    this.deps.connect(this.streamOf(ws));
    this.changed();
  }

  /** The ACP stream of an authenticated socket; what the daemon sends the phone is checked here. */
  private streamOf(ws: PhoneConn): WireStream {
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

  private fromPhone(ws: PhoneConn, message: Message): void {
    const method = typeof message.method === "string" ? message.method : null;
    if (method && !scopeAllows(REMOTE_METHOD_SCOPES, method, ws.data.scopes)) {
      if (message.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: SCOPE_REFUSED_CODE, message: `This phone may not call ${method}` } }));
      }
      return;
    }
    ws.data.inbox?.enqueue(message);
  }

  private toPhone(ws: PhoneConn, message: Message): void {
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

  private closed(ws: PhoneConn): void {
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
