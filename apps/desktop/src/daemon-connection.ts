import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { invoke } from "@tauri-apps/api/core";
import {
  addSession,
  appendText,
  getState,
  setConnection,
  updateSession,
  upsertTool,
} from "./session-store";

interface DaemonInfo {
  url: string;
  token: string;
  protocolPrefix: string;
}

let connection: acp.ClientConnection | null = null;
const pendingPermissions = new Map<string, (optionId: string | null) => void>();

let connecting: Promise<void> | null = null;

/** Idempotent: StrictMode runs effects twice, and Retry may be clicked while connecting. */
export function connectLocalDaemon(): Promise<void> {
  if (connection) return Promise.resolve();
  connecting ??= openConnection().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function openConnection(): Promise<void> {
  setConnection({ kind: "connecting" });
  let info: DaemonInfo;
  try {
    info = JSON.parse(await invoke<string>("local_daemon_info"));
  } catch (error) {
    setConnection({ kind: "offline", reason: `Daemon not running (${String(error)})` });
    return;
  }

  const stream = createWebSocketStream(info.url, { protocols: [info.protocolPrefix + info.token] });
  const opened = acp
    .client({ name: "acp-harness-desktop" })
    .onRequest("session/request_permission", (ctx) => requestPermission(ctx.params))
    .onNotification("session/update", (ctx) => applyUpdate(ctx.params))
    .connect(stream);
  opened.closed.finally(() => {
    // A stale connection closing late must not tear down its replacement.
    if (connection !== opened) return;
    connection = null;
    setConnection({ kind: "offline", reason: "Disconnected from daemon" });
  });

  try {
    await opened.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    connection = opened;
    setConnection({ kind: "connected", url: info.url });
  } catch (error) {
    opened.close();
    setConnection({ kind: "offline", reason: String(error) });
  }
}

async function requireConnection(): Promise<acp.ClientConnection> {
  await connectLocalDaemon();
  if (!connection) throw new Error("Not connected to the daemon");
  return connection;
}

// Dev-only hook so scripts/cdp.ts can drive what a native folder dialog would otherwise block.
if (import.meta.env.DEV) {
  Object.assign(window, { __harness: { createSession } });
}

// Vite HMR re-runs this module with `connection` reset; close the old socket instead of leaking it.
import.meta.hot?.dispose(() => {
  connection?.close();
  connection = null;
});

export async function createSession(cwd: string): Promise<void> {
  const conn = await requireConnection();
  const { sessionId } = await conn.agent.request(acp.methods.agent.session.new, {
    cwd,
    mcpServers: [],
  });
  const title = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
  addSession({ id: sessionId, cwd, title, status: "idle", items: [] });
}

export async function sendPrompt(sessionId: string, text: string): Promise<void> {
  updateSession(sessionId, (s) => ({
    ...s,
    status: "working",
    items: [...s.items, { kind: "user", text }],
  }));
  try {
    const conn = await requireConnection();
    const { stopReason } = await conn.agent.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    updateSession(sessionId, (s) => ({
      ...s,
      status: "idle",
      items: stopReason === "cancelled" ? [...s.items, { kind: "notice", text: "Stopped" }] : s.items,
    }));
  } catch (error) {
    updateSession(sessionId, (s) => ({
      ...s,
      status: "error",
      items: [...s.items, { kind: "agent", text: `\n[error] ${String(error)}` }],
    }));
  }
}

export function cancelTurn(sessionId: string): void {
  void connection?.agent.notify(acp.methods.agent.session.cancel, { sessionId });
}

export function answerPermission(requestId: string, optionId: string | null): void {
  pendingPermissions.get(requestId)?.(optionId);
}

function requestPermission(
  params: acp.RequestPermissionRequest,
): Promise<acp.RequestPermissionResponse> {
  const requestId = crypto.randomUUID();
  updateSession(params.sessionId, (s) => ({
    ...s,
    status: "needs-you",
    items: [
      ...s.items,
      {
        kind: "permission",
        requestId,
        title: params.toolCall.title ?? "Tool call",
        options: params.options,
        chosen: null,
      },
    ],
  }));
  return new Promise((resolve) => {
    pendingPermissions.set(requestId, (optionId) => {
      pendingPermissions.delete(requestId);
      updateSession(params.sessionId, (s) => ({
        ...s,
        status: "working",
        items: s.items.map((item) =>
          item.kind === "permission" && item.requestId === requestId
            ? { ...item, chosen: optionId ?? "cancelled" }
            : item,
        ),
      }));
      resolve({
        outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
      });
    });
  });
}

function applyUpdate({ sessionId, update }: acp.SessionNotification): void {
  if (!getState().sessions.some((s) => s.id === sessionId)) return;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      if (update.content.type === "text") appendText(sessionId, "agent", update.content.text);
      break;
    case "agent_thought_chunk":
      if (update.content.type === "text") appendText(sessionId, "thought", update.content.text);
      break;
    case "tool_call":
      upsertTool(sessionId, update.toolCallId, {
        title: update.title,
        status: update.status ?? "pending",
      });
      break;
    case "tool_call_update":
      upsertTool(sessionId, update.toolCallId, {
        ...(update.title ? { title: update.title } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...(update.content ? { output: toolOutputText(update.content) } : {}),
      });
      break;
  }
}

function toolOutputText(content: acp.ToolCallContent[]): string {
  return content
    .map((part) =>
      part.type === "content" && part.content.type === "text" ? part.content.text : "",
    )
    .join("\n");
}
