import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { createHarnessAgent } from "./harness-agent.ts";
import { serveWebSocket } from "./websocket-server.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import { SessionRegistry } from "./session-registry.ts";
import { TerminalManager } from "./terminal-manager.ts";
import { log } from "./log.ts";
import { runManagerMcpBridge } from "./manager-mcp-bridge.ts";

const DEFAULT_PORT = 7801;
const bridgeIndex = process.argv.indexOf("--mcp-bridge");
if (bridgeIndex !== -1) {
  // An agent's stdio MCP server, not a daemon: relay and exit with stdin.
  await runManagerMcpBridge(process.argv[bridgeIndex + 1] ?? "");
  process.exit(0);
}
const workspaces = new WorkspaceManager();
await workspaces.load();
const sessions = new SessionRegistry();
await sessions.load();
const agent = createHarnessAgent(workspaces, sessions, new TerminalManager());

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
  await serveWebSocket(agent, portArg ? Number(portArg.slice(7)) : DEFAULT_PORT, {
    printConnection: process.argv.includes("--print-connection"),
  });
}
