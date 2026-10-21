import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  HARNESS_METHODS,
  HARNESS_NOTIFICATIONS,
  SETTINGS_NOTIFICATIONS,
  type CreateTerminalParams,
  type HarnessMethod,
  type HarnessRequests,
  type HarnessState,
  type HostSettings,
  type Project,
  type SessionInfo,
  type ShellOption,
  type TerminalInfo,
  type TerminalOutput,
} from "@acp-harness/protocol";
import {
  LOCAL_HOST,
  addSession,
  allProjects,
  appendText,
  findWorkspace,
  getState,
  markLoaded,
  mergeSessions,
  rememberHost,
  removeSession,
  selectTerminal,
  selectWorkspace,
  setHarnessState,
  setTerminals,
  updateSession,
  upsertHost,
  upsertTool,
  type HostId,
} from "./session-store";
import { applyHostSettings } from "./stores/host-settings-store";

interface DaemonInfo {
  url: string;
  token: string;
  protocolPrefix: string;
}

const connections = new Map<HostId, acp.ClientConnection>();
const connecting = new Map<HostId, Promise<void>>();
const pendingPermissions = new Map<string, (optionId: string | null) => void>();
const loading = new Map<string, Promise<void>>();
const terminalOutputListeners = new Map<string, Set<(data: string) => void>>();
const reconnectAttempts = new Map<HostId, number>();
const reconnectTimers = new Map<HostId, ReturnType<typeof setTimeout>>();

/** A daemon restarting (an upgrade, a WSL distro waking up) comes back; keep trying with backoff. */
function scheduleReconnect(hostId: HostId): void {
  if (hostId !== LOCAL_HOST && !getState().rememberedHosts.includes(hostId)) return;
  if (reconnectTimers.has(hostId)) return;
  const attempt = (reconnectAttempts.get(hostId) ?? 0) + 1;
  reconnectAttempts.set(hostId, attempt);
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
  reconnectTimers.set(
    hostId,
    setTimeout(() => {
      reconnectTimers.delete(hostId);
      void connectHost(hostId);
    }, delay),
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof Event !== "undefined" && error instanceof Event) return "Could not reach the daemon";
  return String(error);
}

/** How to reach each kind of host: the local daemon's file, or a daemon the app starts in WSL. */
function daemonInfo(hostId: HostId): Promise<string> {
  if (!isTauri()) {
    // Browser preview (scripts/preview.ts): its own daemon, handed over at build time; no WSL.
    const preview = import.meta.env.VITE_HARNESS_DAEMON as string | undefined;
    if (hostId === LOCAL_HOST && preview) return Promise.resolve(preview);
    return Promise.reject(new Error(`${hostId} needs the desktop app`));
  }
  if (hostId === LOCAL_HOST) return invoke<string>("ensure_local_daemon");
  if (hostId.startsWith("wsl:")) return invoke<string>("start_wsl_daemon", { distro: hostId.slice(4) });
  return Promise.reject(new Error(`Unknown host kind: ${hostId}`));
}

/** Idempotent per host: StrictMode runs effects twice, and Retry may be clicked while connecting. */
export function connectHost(hostId: HostId): Promise<void> {
  if (connections.has(hostId)) return Promise.resolve();
  let pending = connecting.get(hostId);
  if (!pending) {
    pending = openConnection(hostId).finally(() => connecting.delete(hostId));
    connecting.set(hostId, pending);
  }
  return pending;
}

/** Connects this computer and every WSL distro the user connected before. */
export function connectAllHosts(): void {
  void connectHost(LOCAL_HOST);
  for (const hostId of getState().rememberedHosts) void connectHost(hostId);
}

export function disconnectHost(hostId: HostId): void {
  rememberHost(hostId, false);
  clearTimeout(reconnectTimers.get(hostId));
  reconnectTimers.delete(hostId);
  connections.get(hostId)?.close();
}

async function openConnection(hostId: HostId): Promise<void> {
  upsertHost(hostId, { connection: { kind: "connecting" } });
  let info: DaemonInfo;
  try {
    info = JSON.parse(await daemonInfo(hostId));
  } catch (error) {
    const reason = describeError(error);
    upsertHost(hostId, { connection: { kind: "offline", reason } });
    scheduleReconnect(hostId);
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
      (ctx) => setHarnessState(hostId, ctx.params),
    )
    .onNotification(
      HARNESS_NOTIFICATIONS.sessionsChanged,
      (raw: unknown) => raw as SessionInfo[],
      (ctx) => mergeSessions(hostId, ctx.params),
    )
    .onNotification(
      HARNESS_NOTIFICATIONS.terminalsChanged,
      (raw: unknown) => raw as TerminalInfo[],
      (ctx) => setTerminals(hostId, ctx.params),
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
    .onNotification(
      SETTINGS_NOTIFICATIONS.settingsChanged,
      (raw: unknown) => raw as HostSettings,
      (ctx) => applyHostSettings(hostId, ctx.params),
    )
    .connect(stream);
  opened.closed.finally(() => {
    // A stale connection closing late must not tear down its replacement.
    if (connections.get(hostId) !== opened) return;
    connections.delete(hostId);
    upsertHost(hostId, { connection: { kind: "offline", reason: "Disconnected from daemon" } });
    scheduleReconnect(hostId);
  });

  try {
    await opened.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    connections.set(hostId, opened);
    upsertHost(hostId, {});
    setHarnessState(hostId, await opened.agent.request<HarnessState>(HARNESS_METHODS.stateGet, {}));
    mergeSessions(hostId, await opened.agent.request<SessionInfo[]>(HARNESS_METHODS.sessionsList, {}));
    setTerminals(hostId, await opened.agent.request<TerminalInfo[]>(HARNESS_METHODS.terminalsList, {}));
    upsertHost(hostId, {
      shells: await opened.agent.request<ShellOption[]>(HARNESS_METHODS.shellsList, {}),
      connection: { kind: "connected", url: info.url },
    });
    if (hostId !== LOCAL_HOST) rememberHost(hostId, true);
    reconnectAttempts.delete(hostId);
  } catch (error) {
    opened.close();
    upsertHost(hostId, { connection: { kind: "offline", reason: describeError(error) } });
    scheduleReconnect(hostId);
  }
}

async function requireConnection(hostId: HostId): Promise<acp.ClientConnection> {
  await connectHost(hostId);
  // A WSL daemon that was still starting fails the first attempt; one retry covers that window.
  if (!connections.has(hostId)) await connectHost(hostId);
  const conn = connections.get(hostId);
  if (!conn) throw new Error(`Not connected to ${hostId}`);
  return conn;
}

/** The host that owns whatever a request's params point at. */
function hostOf(params: unknown): HostId {
  if (typeof params !== "object" || params === null) return LOCAL_HOST;
  const p = params as Record<string, unknown>;
  const state = getState();
  if (typeof p.workspaceId === "string") return findWorkspace(p.workspaceId)?.hostId ?? LOCAL_HOST;
  if (typeof p.sessionId === "string") return state.sessions.find((s) => s.id === p.sessionId)?.hostId ?? LOCAL_HOST;
  if (typeof p.terminalId === "string") return state.terminals.find((t) => t.id === p.terminalId)?.hostId ?? LOCAL_HOST;
  if (typeof p.projectId === "string") return allProjects().find((x) => x.id === p.projectId)?.hostId ?? LOCAL_HOST;
  return LOCAL_HOST;
}

export async function harnessRequest<M extends HarnessMethod>(
  method: M,
  params: HarnessRequests[M]["params"],
  hostId: HostId = hostOf(params),
): Promise<HarnessRequests[M]["result"]> {
  const conn = await requireConnection(hostId);
  return conn.agent.request<HarnessRequests[M]["result"]>(method, params);
}

/**
 * WSL folders picked through Windows (`\\wsl.localhost\<distro>\...` or `\\wsl$\...`) belong to that
 * distro's daemon, under their Linux path; everything else belongs to this computer.
 */
export function hostForPath(path: string): { hostId: HostId; path: string } {
  const match = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i.exec(path);
  if (!match) return { hostId: LOCAL_HOST, path };
  return { hostId: `wsl:${match[1]}`, path: (match[2] ?? "\\").replaceAll("\\", "/") };
}

/** Adds a project on whichever host the path lives on, starting that host's daemon if needed. */
export async function addProject(pickedPath: string): Promise<Project> {
  const { hostId, path } = hostForPath(pickedPath);
  return harnessRequest(HARNESS_METHODS.projectAdd, { path }, hostId);
}

/** Opens a new Claude tab in a workspace and makes it the workspace's active tab. */
export async function createSession(workspaceId: string): Promise<string> {
  const hostId = hostOf({ workspaceId });
  const info = await harnessRequest(HARNESS_METHODS.sessionCreate, { workspaceId }, hostId);
  addSession({ ...info, hostId, workspaceId, items: [], loaded: true });
  return info.id;
}

/** Replays a restored session's transcript the first time its tab is shown. */
export function ensureSessionLoaded(sessionId: string): Promise<void> {
  const session = getState().sessions.find((s) => s.id === sessionId);
  if (!session || session.loaded) return Promise.resolve();
  let pending = loading.get(sessionId);
  if (!pending) {
    markLoaded(sessionId);
    pending = requireConnection(session.hostId)
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
export async function createTerminal(
  workspaceId: string,
  shellId?: string,
  launch?: Pick<CreateTerminalParams, "agent" | "prompt" | "command">,
): Promise<string> {
  const hostId = hostOf({ workspaceId });
  const info = await harnessRequest(
    HARNESS_METHODS.terminalCreate,
    { workspaceId, ...(shellId ? { shellId } : {}), ...launch, cols: 120, rows: 30 },
    hostId,
  );
  const others = getState().terminals.filter((t) => t.hostId === hostId && t.id !== info.id);
  setTerminals(hostId, [...others, info]);
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
  const terminal = getState().terminals.find((t) => t.id === terminalId);
  if (!terminal) return;
  setTerminals(
    terminal.hostId,
    getState().terminals.filter((t) => t.hostId === terminal.hostId && t.id !== terminalId),
  );
  void harnessRequest(HARNESS_METHODS.terminalClose, { terminalId }, terminal.hostId).catch(() => undefined);
}

export function closeSession(sessionId: string): void {
  const session = getState().sessions.find((s) => s.id === sessionId);
  if (!session) return;
  removeSession(sessionId);
  void harnessRequest(HARNESS_METHODS.sessionClose, { sessionId }, session.hostId).catch(() => undefined);
}

// Dev-only hook so scripts/cdp.ts can drive what a native folder dialog would otherwise block.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __harness: { addProject, createSession, createTerminal, connectHost, harnessRequest, selectWorkspace, state: getState },
  });
}

// Vite HMR re-runs this module with `connections` reset; close the old sockets instead of leaking them.
import.meta.hot?.dispose(() => {
  for (const conn of connections.values()) conn.close();
  connections.clear();
});

export async function sendPrompt(sessionId: string, text: string): Promise<void> {
  const session = getState().sessions.find((s) => s.id === sessionId);
  if (!session) return;
  // The daemon echoes the prompt back as a user_message_chunk and owns the status from here.
  updateSession(sessionId, (s) => ({ ...s, status: "working", turnStartedAt: Date.now() }));
  try {
    const conn = await requireConnection(session.hostId);
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
  const session = getState().sessions.find((s) => s.id === sessionId);
  if (!session) return;
  void connections.get(session.hostId)?.agent.notify(acp.methods.agent.session.cancel, { sessionId });
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
