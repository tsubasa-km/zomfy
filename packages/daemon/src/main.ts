import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { createHarnessAgent } from "./harness-agent.ts";
import { serveWebSocket } from "./websocket-server.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import { SessionRegistry } from "./session-registry.ts";
import { log } from "./log.ts";

const DEFAULT_PORT = 7801;
const workspaces = new WorkspaceManager();
await workspaces.load();
const sessions = new SessionRegistry();
await sessions.load();
const agent = createHarnessAgent(workspaces, sessions);

if (process.argv.includes("--stdio")) {
  // For ACP clients that launch the agent themselves (Zed, Orca).
  agent.connect(
    acp.ndJsonStream(
      Writable.toWeb(process.stdout),
      // process.stdin yields Buffers, which are Uint8Arrays.
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    ),
  );
  log("ready on stdio");
} else {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  await serveWebSocket(agent, portArg ? Number(portArg.slice(7)) : DEFAULT_PORT);
}
