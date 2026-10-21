// Drives the harness over ACP without a UI: `bun scripts/acp-smoke-client.ts [--ws] "prompt" [cwd]`.
// Default spawns the agent on stdio; --ws connects to a running daemon.
import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { DAEMON_INFO_PATH } from "../src/websocket-server.ts";

const useWebSocket = process.argv.includes("--ws");
const args = process.argv.slice(2).filter((arg) => arg !== "--ws");
const promptText = args[0] ?? "Reply with exactly one word: pong";
const cwd = args[1] ?? process.cwd();

let agentProcess: ReturnType<typeof spawn> | null = null;
let stream: acp.Stream;
if (useWebSocket) {
  const info = await Bun.file(DAEMON_INFO_PATH).json();
  stream = createWebSocketStream(info.url, { protocols: [info.protocolPrefix + info.token] });
} else {
  const child = spawn("bun", [join(import.meta.dir, "..", "src", "main.ts"), "--stdio"], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  agentProcess = child;
  stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    // child stdout yields Buffers, which are Uint8Arrays.
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
}

await acp
  .client({ name: "smoke-client" })
  .onRequest("session/request_permission", (ctx) => {
    console.log(`\n[permission] ${ctx.params.toolCall.title} -> allow`);
    return { outcome: { outcome: "selected", optionId: "allow" } };
  })
  .onNotification("session/update", (ctx) => {
    const u = ctx.params.update;
    if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
      process.stdout.write(u.content.text);
    } else {
      console.log(`\n[${u.sessionUpdate}]`, "title" in u ? u.title : "", "status" in u ? u.status : "");
    }
  })
  .connectWith(stream, async (ctx) => {
    const init = await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    console.log("[initialize]", JSON.stringify(init.agentInfo));
    const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
      cwd,
      mcpServers: [],
    });
    const first = await ctx.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: promptText }],
    });
    console.log(`\n[stop] ${first.stopReason}`);
    // A second turn proves the Claude session is resumed, not restarted.
    const second = await ctx.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: "What exactly did I ask you in my previous message? Answer in one short sentence." }],
    });
    console.log(`\n[stop] ${second.stopReason}`);
  });

agentProcess?.kill();
process.exit(0);
