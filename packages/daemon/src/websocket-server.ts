import type * as acp from "@agentclientprotocol/sdk";
import {
  AcpServer,
  type PreparedWebSocketUpgrade,
} from "@agentclientprotocol/sdk/experimental/server";
import type { ServerWebSocket } from "bun";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "./log.ts";

// Browsers do not apply CORS to WebSockets, so any page could reach a localhost port.
// The token travels as a subprotocol because browser WebSockets cannot set headers.
const TOKEN_PROTOCOL_PREFIX = "acp-harness.token.";
const ALLOWED_ORIGINS = new Set([
  "http://localhost:1420", // Vite dev server
  "http://tauri.localhost", // Tauri on Windows
  "tauri://localhost", // Tauri on macOS/Linux
]);

export const DAEMON_INFO_PATH = join(homedir(), ".acp-harness", "daemon.json");

type WebSocketServerSocket = Parameters<PreparedWebSocketUpgrade["accept"]>[0];

interface SocketData {
  upgrade: PreparedWebSocketUpgrade;
  bridge: BunSocketBridge;
}

/** Gives a Bun server socket the listener API the ACP transport expects. */
class BunSocketBridge implements WebSocketServerSocket {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  constructor(private socket: ServerWebSocket<SocketData> | null = null) {}

  attach(socket: ServerWebSocket<SocketData>): void {
    this.socket = socket;
  }
  get readyState(): number {
    return this.socket?.readyState ?? 0;
  }
  send(data: string): void {
    this.socket?.send(data);
  }
  close(code?: number, reason?: string): void {
    this.socket?.close(code, reason);
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

export async function serveWebSocket(
  agent: acp.AgentApp,
  port: number,
  options: { printConnection?: boolean } = {},
): Promise<void> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex");
  const acpServer = new AcpServer({ agent });

  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname !== "/acp") return new Response("not found", { status: 404 });
      const origin = req.headers.get("origin");
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        log(`rejected origin ${origin}`);
        return new Response("forbidden", { status: 403 });
      }
      const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((p) => p.trim());
      const tokenProtocol = protocols.find((p) => p === TOKEN_PROTOCOL_PREFIX + token);
      if (!tokenProtocol) return new Response("unauthorized", { status: 401 });

      const upgrade = acpServer.prepareWebSocketUpgrade();
      const ok = srv.upgrade(req, {
        data: { upgrade, bridge: new BunSocketBridge() },
        headers: {
          "Sec-WebSocket-Protocol": tokenProtocol,
          "Acp-Connection-Id": upgrade.connectionId,
        },
      });
      if (ok) return undefined;
      upgrade.reject();
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.data.bridge.attach(ws);
        ws.data.upgrade.accept(ws.data.bridge);
      },
      message(ws, message) {
        const data = typeof message === "string" ? message : new TextDecoder().decode(message);
        ws.data.bridge.emit("message", { data });
      },
      close(ws, code, reason) {
        ws.data.bridge.emit("close", { code, reason });
      },
    },
  });

  const url = `ws://127.0.0.1:${server.port}/acp`;
  await mkdir(join(homedir(), ".acp-harness"), { recursive: true });
  await writeFile(
    DAEMON_INFO_PATH,
    JSON.stringify({ url, token, protocolPrefix: TOKEN_PROTOCOL_PREFIX, pid: process.pid }),
    { mode: 0o600 },
  );
  log(`listening on ${url} (connection info in ${DAEMON_INFO_PATH})`);
  // A launcher on another OS (the desktop starting a WSL daemon) reads this line instead of the file.
  if (options.printConnection) {
    process.stdout.write(`${JSON.stringify({ url, token, protocolPrefix: TOKEN_PROTOCOL_PREFIX })}
`);
  }

  const shutdown = async () => {
    await rm(DAEMON_INFO_PATH, { force: true });
    await acpServer.close();
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
