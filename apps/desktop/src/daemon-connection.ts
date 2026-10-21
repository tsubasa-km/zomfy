import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { invoke } from "@tauri-apps/api/core";
import {
  HARNESS_METHODS,
  HARNESS_NOTIFICATIONS,
  type HarnessMethod,
  type HarnessRequests,
  type HarnessState,
  type SessionInfo,
  type ShellOption,
  type TerminalInfo,
  type TerminalOutput,
} from "@acp-harness/protocol";
import {
  addSession,
  appendText,
  getState,
  markLoaded,
  mergeSessions,
  removeSession,
  selectTerminal,
  setConnection,
  setHarnessState,
  setShells,
  setTerminals,
  updateSession,
  upsertTool,
} from "./session-store";

interface DaemonInfo {
  url: string;
  token: string;
  protocolPrefix: string;
}

let connection: acp.ClientConnection | null = null;
let connecting: Promise<void> | null = null;
const pendingPermissions = new Map<string, (optionId: string | null) => void>();
const loading = new Map<string, Promise<void>>();
const terminalOutputListeners = new Map<string, Set<(data: string) => void>>();

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
    .onNotification(
      HARNESS_NOTIFICATIONS.stateChanged,
      (raw: unknown) => raw as HarnessState,
      (ctx) => setHarnessState(ctx.params),
    )
    .onNotification(
      HARNESS_NOTIFICATIONS.sessionsChanged,
      (raw: unknown) => raw as SessionInfo[],
      (ctx) => mergeSessions(ctx.params),
    )
    .onNotification(
      HARNESS_NOTIFICATIONS.terminalsChanged,
      (raw: unknown) => raw as TerminalInfo[],
      (ctx) => setTerminals(ctx.params),
    )
    .onNotification(
      HARNESS_NOTIFICATIONS.terminalOutput,
      (raw: unknown) => raw as TerminalOutput,
      (ctx) => {
        for (const listener of terminalOutputListeners.get(ctx.params.terminalId) ?? []) {
          listener(ctx.params.data);
        }
      },
    )
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
    setHarnessState(await opened.agent.request<HarnessState>(HARNESS_METHODS.stateGet, {}));
    mergeSessions(await opened.agent.request<SessionInfo[]>(HARNESS_METHODS.sessionsList, {}));
    setTerminals(await opened.agent.request<TerminalInfo[]>(HARNESS_METHODS.terminalsList, {}));
    setShells(await opened.agent.request<ShellOption[]>(HARNESS_METHODS.shellsList, {}));
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

export async function harnessRequest<M extends HarnessMethod>(
  method: M,
  params: HarnessRequests[M]["params"],
): Promise<HarnessRequests[M]["result"]> {
  const conn = await requireConnection();
  return conn.agent.request<HarnessRequests[M]["result"]>(method, params);
}

/** Opens a new Claude tab in a workspace and makes it the workspace's active tab. */
export async function createSession(workspaceId: string): Promise<string> {
  const info = await harnessRequest(HARNESS_METHODS.sessionCreate, { workspaceId });
  addSession({ ...info, workspaceId, items: [], loaded: true });
  return info.id;
}

/** Replays a restored session's transcript the first time its tab is shown. */
export function ensureSessionLoaded(sessionId: string): Promise<void> {
  const session = getState().sessions.find((s) => s.id === sessionId);
  if (!session || session.loaded) return Promise.resolve();
  let pending = loading.get(sessionId);
  if (!pending) {
    markLoaded(sessionId);
    pending = requireConnection()
      .then((conn) =>
        conn.agent.request(acp.methods.agent.session.load, {
          sessionId,
          cwd: session.cwd,
          mcpServers: [],
        }),
      )
      .then(() => undefined)
      .finally(() => loading.delete(sessionId));
    loading.set(sessionId, pending);
  }
  return pending;
}

/** Starts a shell in a workspace and makes it the active tab. */
export async function createTerminal(workspaceId: string, shellId?: string): Promise<string> {
  const info = await harnessRequest(HARNESS_METHODS.terminalCreate, {
    workspaceId,
    ...(shellId ? { shellId } : {}),
    cols: 120,
    rows: 30,
  });
  setTerminals([...getState().terminals.filter((t) => t.id !== info.id), info]);
  selectTerminal(info.id);
  return info.id;
}

/** Live output for one terminal; returns the unsubscribe function. */
export function subscribeTerminalOutput(terminalId: string, listener: (data: string) => void): () => void {
  const set = terminalOutputListeners.get(terminalId) ?? new Set();
  set.add(listener);
  terminalOutputListeners.set(terminalId, set);
  return () => set.delete(listener);
}

export function closeTerminal(terminalId: string): void {
  setTerminals(getState().terminals.filter((t) => t.id !== terminalId));
  void harnessRequest(HARNESS_METHODS.terminalClose, { terminalId }).catch(() => undefined);
}

export function closeSession(sessionId: string): void {
  removeSession(sessionId);
  void harnessRequest(HARNESS_METHODS.sessionClose, { sessionId }).catch(() => undefined);
}

// Dev-only hook so scripts/cdp.ts can drive what a native folder dialog would otherwise block.
if (import.meta.env.DEV) {
  Object.assign(window, { __harness: { createSession, createTerminal, harnessRequest, state: getState } });
}

// Vite HMR re-runs this module with `connection` reset; close the old socket instead of leaking it.
import.meta.hot?.dispose(() => {
  connection?.close();
  connection = null;
});

export async function sendPrompt(sessionId: string, text: string): Promise<void> {
  // The daemon echoes the prompt back as a user_message_chunk and owns the status from here.
  updateSession(sessionId, (s) => ({ ...s, status: "working", turnStartedAt: Date.now() }));
  try {
    const conn = await requireConnection();
    const { stopReason } = await conn.agent.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    if (stopReason === "cancelled") {
      updateSession(sessionId, (s) => ({
        ...s,
        turnStartedAt: null,
        items: [...s.items, { kind: "notice", text: "Stopped" }],
      }));
    }
  } catch (error) {
    updateSession(sessionId, (s) => ({
      ...s,
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
  // A tab that has not replayed its transcript would get a fragment; load fills it in later.
  if (!getState().sessions.some((s) => s.id === sessionId && s.loaded)) return;
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      if (update.content.type === "text") appendText(sessionId, "user", update.content.text);
      break;
    case "agent_message_chunk":
      if (update.content.type === "text") appendText(sessionId, "agent", update.content.text);
      break;
    case "agent_thought_chunk":
      if (update.content.type === "text") appendText(sessionId, "thought", update.content.text);
      break;
    case "tool_call":
      upsertTool(sessionId, update.toolCallId, {
        title: update.title,
        toolKind: update.kind ?? "other",
        status: update.status ?? "pending",
        input: update.rawInput ?? null,
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
