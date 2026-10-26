import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AUTOMATION_NOTIFICATIONS,
  HARNESS_METHODS,
  HARNESS_NOTIFICATIONS,
  MANAGER_METHODS,
  MANAGER_ROUTING_CAPABILITY,
  type AutomationSnapshot,
  SETTINGS_NOTIFICATIONS,
  TODO_NOTIFICATIONS,
  PROJECT_LINK_NOTIFICATIONS,
  WORKFLOW_EXPERIMENT_NOTIFICATIONS,
  WORKFLOW_NOTIFICATIONS,
  type WorkflowExperiment,
  type WorkflowRun,
  type ProjectLink,
  TURN_RECOVERY_NOTIFICATIONS,
  type ChatAgentId,
  type CreateTerminalParams,
  type HarnessMethod,
  type HarnessRequests,
  type HarnessState,
  type HostSettings,
  type ManagerCallParams,
  type Project,
  type SessionInfo,
  type SessionRole,
  type ShellOption,
  type TerminalInfo,
  type TerminalOutput,
  type TodoItem,
} from "@acp-harness/protocol";
import { applyChatUpdate, latestTurnEnd } from "./chat-transcript";
import { WINDOW_ROLE } from "./lib/window-role";
import {
  LOCAL_HOST,
  addSession,
  allProjects,
  findWorkspace,
  batchUpdates,
  forgetHost,
  getState,
  whenState,
  hostLabel,
  markLoaded,
  mergeSessions,
  onSessionTransition,
  rememberHost,
  removeSession,
  selectTerminal,
  selectWorkspace,
  setHarnessState,
  setTerminals,
  updateSession,
  upsertHost,
  type ChatImage,
  type DaemonVerdict,
  type HostId,
} from "./session-store";
import { applyHostSettings } from "./stores/host-settings-store";
import { getSetting } from "./stores/settings-store";
import { setTodos } from "./stores/inbox-store";
import { setProjectLinks } from "./stores/project-links-store";
import { upsertWorkflowRun } from "./stores/workflow-runs-store";
import { upsertWorkflowExperiment } from "./stores/workflow-experiments-store";
import { runManagerTool } from "./manager/manager-tool-runner";
import { applyAutomationSnapshot } from "./stores/automation-store";
import { notifyAutoResumed } from "./agent-notifications";

interface DaemonInfo {
  url: string;
  token: string;
  protocolPrefix: string;
  /** SSH: the remote's previous daemon had exited, so this connect started a new one. */
  previousExited?: boolean;
}

const connections = new Map<HostId, acp.ClientConnection>();
const connecting = new Map<HostId, Promise<void>>();
/** Approvals this window was asked, by request id; settled when answered or when the ask is gone. */
const pendingPermissions = new Map<string, { sessionId: string; hostId: HostId; settle: (optionId: string | null) => void }>();

/** The daemon no longer waits on these (the turn ended, or the link carrying them closed). */
function expirePermissions(match: (entry: { sessionId: string; hostId: HostId }) => boolean): void {
  for (const entry of [...pendingPermissions.values()]) if (match(entry)) entry.settle(null);
}

onSessionTransition(({ session, to }) => {
  if (to === "idle" || to === "error") expirePermissions((e) => e.sessionId === session.id);
});
const loading = new Map<string, Promise<void>>();
// Updates of a transcript being replayed, applied together once the load request returns.
const replayBuffers = new Map<string, acp.SessionNotification[]>();
const terminalOutputListeners = new Map<string, Set<(data: string) => void>>();
const reconnectAttempts = new Map<HostId, number>();
const reconnectTimers = new Map<HostId, ReturnType<typeof setTimeout>>();
/** Hosts the user disconnected while a connect was in flight; that connect must not revive them. */
const userDisconnected = new Set<HostId>();

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

/** The SSH launcher rejects with `{verdict, reason}` JSON; everything else is a plain message. */
function hostFailure(error: unknown): { reason: string; daemon?: DaemonVerdict } {
  const text = describeError(error);
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "reason" in parsed && typeof parsed.reason === "string") {
      const verdict = "verdict" in parsed ? parsed.verdict : null;
      const daemon = verdict === "live" || verdict === "exited" || verdict === "unverifiable" ? verdict : undefined;
      return daemon ? { reason: parsed.reason, daemon } : { reason: parsed.reason };
    }
  } catch {
    // Not JSON: a plain message.
  }
  return { reason: text };
}

export const isSshHost = (hostId: HostId): boolean => hostId.startsWith("ssh:");

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
  if (isSshHost(hostId)) return invoke<string>("start_ssh_daemon", { target: hostId.slice(4) });
  return Promise.reject(new Error(`Unknown host kind: ${hostId}`));
}

/** Idempotent per host: StrictMode runs effects twice, and Retry may be clicked while connecting. */
export function connectHost(hostId: HostId): Promise<void> {
  userDisconnected.delete(hostId);
  if (connections.has(hostId)) return Promise.resolve();
  let pending = connecting.get(hostId);
  if (!pending) {
    pending = openConnection(hostId).finally(() => connecting.delete(hostId));
    connecting.set(hostId, pending);
  }
  return pending;
}

/** Connects this computer and every WSL distro and SSH host the user connected before. */
export function connectAllHosts(): void {
  void connectHost(LOCAL_HOST);
  for (const hostId of getState().rememberedHosts) void connectHost(hostId);
}

/** Closes this window's link to a host; its daemon keeps running (stopped when the app quits). */
export function disconnectHost(hostId: HostId): void {
  if (hostId === LOCAL_HOST) return;
  userDisconnected.add(hostId);
  rememberHost(hostId, false);
  clearTimeout(reconnectTimers.get(hostId));
  reconnectTimers.delete(hostId);
  reconnectAttempts.delete(hostId);
  const conn = connections.get(hostId);
  // Removed first so its close handler does not mark the host offline again.
  connections.delete(hostId);
  conn?.close();
  expirePermissions((e) => e.hostId === hostId);
  if (isSshHost(hostId) && isTauri()) void invoke("disconnect_ssh_host", { target: hostId.slice(4) }).catch(() => undefined);
  forgetHost(hostId);
}

async function openConnection(hostId: HostId): Promise<void> {
  upsertHost(hostId, { connection: { kind: "connecting" } });
  let info: DaemonInfo;
  try {
    info = JSON.parse(await daemonInfo(hostId));
  } catch (error) {
    if (userDisconnected.has(hostId)) return;
    upsertHost(hostId, { connection: { kind: "offline", ...hostFailure(error) } });
    scheduleReconnect(hostId);
    return;
  }
  if (userDisconnected.has(hostId)) return;

  const stream = createWebSocketStream(info.url, { protocols: [info.protocolPrefix + info.token] });
  const opened = acp
    .client({ name: "acp-harness-desktop" })
    .onRequest("session/request_permission", (ctx) =>
      // The dashboard pop-out cannot show an approval card; the daemon asks the main window instead.
      WINDOW_ROLE !== "dashboard" ? requestPermission(hostId, ctx.params) : Promise.reject(new Error("This window does not answer approvals")),
    )
    // A manager agent on this host reaching sessions on any host; this window carries the call.
    .onRequest(
      MANAGER_METHODS.managerCall,
      (raw: unknown) => raw as ManagerCallParams,
      (ctx) => runManagerTool(ctx.params),
    )
    .onNotification(
      WORKFLOW_NOTIFICATIONS.workflowRunChanged,
      (raw: unknown) => raw as WorkflowRun,
      (ctx) => upsertWorkflowRun(hostId, ctx.params),
    )
    .onNotification(
      WORKFLOW_EXPERIMENT_NOTIFICATIONS.workflowExperimentChanged,
      (raw: unknown) => raw as WorkflowExperiment,
      (ctx) => upsertWorkflowExperiment(hostId, ctx.params),
    )
    .onNotification(
      PROJECT_LINK_NOTIFICATIONS.projectLinksChanged,
      (raw: unknown) => raw as ProjectLink[],
      (ctx) => {
        if (hostId === LOCAL_HOST) setProjectLinks(ctx.params);
      },
    )
    .onNotification(
      TODO_NOTIFICATIONS.todosChanged,
      (raw: unknown) => raw as TodoItem[],
      (ctx) => {
        if (hostId === LOCAL_HOST) setTodos(ctx.params);
      },
    )
    .onNotification("session/update", (ctx) => {
      const replay = replayBuffers.get(ctx.params.sessionId);
      if (replay) replay.push(ctx.params);
      else applyChatUpdate(ctx.params);
    })
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
    .onNotification(
      AUTOMATION_NOTIFICATIONS.automationsChanged,
      (raw: unknown) => raw as AutomationSnapshot,
      (ctx) => applyAutomationSnapshot(hostId, ctx.params),
    )
    .onNotification(
      TURN_RECOVERY_NOTIFICATIONS.autoResumed,
      (raw: unknown) => raw as { sessionId: string },
      (ctx) => {
        if (WINDOW_ROLE === "main") notifyAutoResumed(ctx.params.sessionId);
      },
    )
    .connect(stream);
  opened.closed.finally(() => {
    // A stale connection closing late must not tear down its replacement.
    if (connections.get(hostId) !== opened) return;
    connections.delete(hostId);
    // Asks that came over this link died with it; the daemon asks again once a window is back.
    expirePermissions((e) => e.hostId === hostId);
    upsertHost(hostId, {
      connection: {
        kind: "offline",
        reason: "Lost contact with the daemon; it may still be running there",
        daemon: hostId === LOCAL_HOST ? undefined : "unverifiable",
      },
    });
    scheduleReconnect(hostId);
  });

  try {
    await opened.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { _meta: { [MANAGER_ROUTING_CAPABILITY]: true } },
    });
    if (userDisconnected.has(hostId)) {
      opened.close();
      return;
    }
    connections.set(hostId, opened);
    upsertHost(hostId, {
      notice: info.previousExited
        ? "The daemon there had exited (its terminals and agent turns ended); a new one was started."
        : undefined,
    });
    setHarnessState(hostId, await opened.agent.request<HarnessState>(HARNESS_METHODS.stateGet, {}));
    mergeSessions(hostId, await opened.agent.request<SessionInfo[]>(HARNESS_METHODS.sessionsList, {}));
    setTerminals(hostId, await opened.agent.request<TerminalInfo[]>(HARNESS_METHODS.terminalsList, {}));
    upsertHost(hostId, {
      shells: await opened.agent.request<ShellOption[]>(HARNESS_METHODS.shellsList, {}),
      connection: { kind: "connected", url: info.url },
    });
    if (hostId !== LOCAL_HOST) rememberHost(hostId, true);
    // The person's todos live on this computer's daemon; an older daemon has none.
    if (hostId === LOCAL_HOST) void opened.agent.request<TodoItem[]>(HARNESS_METHODS.todosList, {}).then(setTodos, () => undefined);
    // Linked projects live on this computer's daemon too; an older daemon has none.
    if (hostId === LOCAL_HOST) {
      void opened.agent.request<ProjectLink[]>(HARNESS_METHODS.projectLinksList, {}).then(setProjectLinks, () => undefined);
    }
    reconnectAttempts.delete(hostId);
  } catch (error) {
    opened.close();
    if (userDisconnected.has(hostId)) return;
    // The record was fresh, so the daemon was just seen running; only the link failed.
    upsertHost(hostId, {
      connection: { kind: "offline", reason: describeError(error), daemon: hostId === LOCAL_HOST ? undefined : "unverifiable" },
    });
    scheduleReconnect(hostId);
  }
}

async function requireConnection(hostId: HostId): Promise<acp.ClientConnection> {
  await connectHost(hostId);
  // A WSL daemon that was still starting fails the first attempt; one retry covers that window.
  if (!connections.has(hostId)) await connectHost(hostId);
  const conn = connections.get(hostId);
  if (!conn) throw new Error(`Not connected to ${hostLabel(hostId)}`);
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
 * distro's daemon, under their Linux path; `ssh://<alias or user@host[:port]>/<path>` to that SSH host;
 * everything else belongs to this computer.
 */
export function hostForPath(path: string): { hostId: HostId; path: string } {
  const ssh = /^ssh:\/\/([^/]+)(\/.*)?$/i.exec(path.trim());
  if (ssh) return { hostId: `ssh:${ssh[1]}`, path: ssh[2] ?? "/" };
  const match = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i.exec(path);
  if (!match) return { hostId: LOCAL_HOST, path };
  return { hostId: `wsl:${match[1]}`, path: (match[2] ?? "\\").replaceAll("\\", "/") };
}

/** Adds a project on whichever host the path lives on, starting that host's daemon if needed. */
export async function addProject(pickedPath: string): Promise<Project> {
  const { hostId, path } = hostForPath(pickedPath);
  return harnessRequest(HARNESS_METHODS.projectAdd, { path }, hostId);
}

/**
 * Opens a new chat tab (Claude unless `agent` says otherwise) and makes it the workspace's active tab.
 * `hostId` is for a workspace this window may not have heard about yet; `focus: false` leaves the
 * visible tab alone (a manager starting agents in the background).
 */
export async function createSession(
  workspaceId: string,
  agent?: ChatAgentId,
  extra: { hostId?: HostId; role?: SessionRole; focus?: boolean } = {},
): Promise<string> {
  const hostId = extra.hostId ?? hostOf({ workspaceId });
  const params = {
    workspaceId,
    ...(agent && agent !== "claude" ? { agent } : {}),
    ...(extra.role ? { role: extra.role } : {}),
    ...(!agent || agent === "claude" ? { permissionMode: getSetting("defaultPermissionMode") } : {}),
  };
  const info = await harnessRequest(HARNESS_METHODS.sessionCreate, params, hostId);
  addSession({ ...info, hostId, workspaceId, items: [], loaded: true }, extra.focus ?? true);
  return info.id;
}

/** Replays a restored session's transcript the first time its tab is shown. */
export function ensureSessionLoaded(sessionId: string): Promise<void> {
  const session = getState().sessions.find((s) => s.id === sessionId);
  if (!session || session.loaded) return Promise.resolve();
  let pending = loading.get(sessionId);
  if (!pending) {
    markLoaded(sessionId);
    // The replay arrives as one notification per update; rendering each one made a long chat
    // visibly build up. Collect them and apply the whole transcript in one render.
    replayBuffers.set(sessionId, []);
    const flushReplay = () => {
      const buffered = replayBuffers.get(sessionId) ?? [];
      replayBuffers.delete(sessionId);
      batchUpdates(() => {
        for (const notification of buffered) applyChatUpdate(notification);
        // Approvals still waiting go back under the replayed history, where the live turn is.
        updateSession(sessionId, (s) => {
          const open = (i: (typeof s.items)[number]) => i.kind === "permission" && i.chosen === null;
          return { ...s, items: [...s.items.filter((i) => !open(i)), ...s.items.filter(open)] };
        });
      });
    };
    pending = requireConnection(session.hostId)
      .then((conn) =>
        conn.agent.request(acp.methods.agent.session.load, {
          sessionId,
          cwd: session.cwd,
          mcpServers: [],
        }),
      )
      .then(() => undefined)
      .finally(() => {
        flushReplay();
        loading.delete(sessionId);
      });
    loading.set(sessionId, pending);
  }
  return pending;
}

/** Starts a shell in a workspace and makes it the active tab. */
export async function createTerminal(
  workspaceId: string,
  shellId?: string,
  launch?: Pick<CreateTerminalParams, "agent" | "prompt" | "command" | "inline">,
  /** `select: false` leaves focus where it is (a new split pane focuses itself instead). */
  options: { select?: boolean } = {},
): Promise<string> {
  const hostId = hostOf({ workspaceId });
  const info = await harnessRequest(
    HARNESS_METHODS.terminalCreate,
    { workspaceId, ...(shellId ? { shellId } : {}), ...launch, cols: 120, rows: 30 },
    hostId,
  );
  const others = getState().terminals.filter((t) => t.hostId === hostId && t.id !== info.id);
  setTerminals(hostId, [...others, info]);
  if (options.select !== false) selectTerminal(info.id);
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
  for (const t of getState().terminals) if (t.inline?.sessionId === sessionId) closeTerminal(t.id);
  removeSession(sessionId);
  void harnessRequest(HARNESS_METHODS.sessionClose, { sessionId }, session.hostId).catch(() => undefined);
}

// Dev-only hook so scripts/cdp.ts can drive what a native folder dialog would otherwise block.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __harness: { addProject, createSession, createTerminal, connectHost, harnessRequest, selectWorkspace, state: getState, runManagerTool },
  });
}

// Vite HMR re-runs this module with `connections` reset; close the old sockets instead of leaking them.
import.meta.hot?.dispose(() => {
  for (const conn of connections.values()) conn.close();
  connections.clear();
});

/** False when the host could not be reached, so nothing was sent; the caller gives the text back. */
export async function sendPrompt(sessionId: string, text: string, images: ChatImage[] = []): Promise<boolean> {
  const session = getState().sessions.find((s) => s.id === sessionId);
  if (!session) return false;
  const before = session.status;
  // The daemon echoes the prompt back as a user_message_chunk and owns the status from here.
  updateSession(sessionId, (s) => ({ ...s, status: "working", turnStartedAt: Date.now() }));
  let conn: acp.ClientConnection;
  try {
    conn = await requireConnection(session.hostId);
  } catch (error) {
    updateSession(sessionId, (s) => ({
      ...s,
      status: before,
      turnStartedAt: null,
      items: [...s.items, { kind: "notice", text: `${describeError(error)}: not sent. Your message is back in the box.`, severity: "error" }],
    }));
    return false;
  }
  try {
    // A Stop is recorded by the daemon (a "Stopped" row that offers Continue).
    await conn.agent.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [
        ...images.map((image): acp.ContentBlock => ({ type: "image", data: image.data, mimeType: image.mimeType })),
        ...(text ? [{ type: "text" as const, text }] : []),
      ],
    });
  } catch (error) {
    // The daemon records a failed turn's error before replying; only a failure to reach it is new.
    updateSession(sessionId, (s) => {
      if (latestTurnEnd(s.items)) return { ...s, turnStartedAt: null };
      return {
        ...s,
        turnStartedAt: null,
        items: [...s.items, { kind: "notice", text: describeError(error), severity: "error" }],
      };
    });
  }
  return true;
}

export function cancelTurn(sessionId: string): void {
  const session = getState().sessions.find((s) => s.id === sessionId);
  if (!session) return;
  void connections.get(session.hostId)?.agent.notify(acp.methods.agent.session.cancel, { sessionId });
}

/** False when the request is not held by this window (another window ran the turn). */
export function answerPermission(requestId: string, optionId: string | null): boolean {
  const entry = pendingPermissions.get(requestId);
  entry?.settle(optionId);
  return entry !== undefined;
}

async function requestPermission(
  hostId: HostId,
  params: acp.RequestPermissionRequest,
): Promise<acp.RequestPermissionResponse> {
  // A window that just (re)connected may be asked before its session list has arrived.
  await whenState((s) => s.sessions.some((x) => x.id === params.sessionId), 30_000);
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
        input: params.toolCall.rawInput ?? null,
        options: params.options,
        chosen: null,
      },
    ],
  }));
  return new Promise((resolve) => {
    pendingPermissions.set(requestId, { sessionId: params.sessionId, hostId, settle: (optionId) => {
      if (!pendingPermissions.delete(requestId)) return;
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
    } });
  });
}
