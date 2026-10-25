import * as acp from "@agentclientprotocol/sdk";
import {
  HARNESS_NOTIFICATIONS,
  MANAGER_MCP_SERVER_NAME,
  MANAGER_SYSTEM_PROMPT,
  QUICK_CHAT_SYSTEM_PROMPT,
  LEAD_SYSTEM_PROMPT,
  TURN_RECOVERY_META,
  TURN_RECOVERY_NOTIFICATIONS,
  chatAgentLabel,
  type HarnessMethod,
  type HarnessRequests,
  type TurnEndMeta,
  type TurnResumeKind,
  type ManagerToolName,
} from "@acp-harness/protocol";
import type { WorkflowStepUsage } from "@acp-harness/protocol";
import { runClaudeTurn, type StepOptions } from "./claude-turn.ts";
import { hostPath } from "./tui-agent-detection.ts";
import { TurnAutoResume } from "./turn-auto-resume.ts";
import { recoveryPrompt } from "./turn-recovery.ts";
import { detectUsageLimit } from "./usage-limit.ts";
import { registerTurnRecoveryHandlers } from "./handlers/turn-recovery-handlers.ts";
import { AcpAgentSessions } from "./acp-agent-sessions.ts";
import { chatAgentLaunch } from "./chat-agent-launch-settings.ts";
import { noteSlashCommands } from "./claude-catalog.ts";
import { liveClaudeQueries } from "./live-claude-queries.ts";
import type { SessionRegistry } from "./session-registry.ts";
import { SessionMover } from "./session-move.ts";
import type { TerminalManager } from "./terminal-manager.ts";
import type { StepToolUse, HandlerContext } from "./handlers/handler-context.ts";
import { registerAutomationHandlers } from "./handlers/automation-handlers.ts";
import { registerChatAgentHandlers } from "./handlers/chat-agent-handlers.ts";
import { registerFileHandlers } from "./handlers/file-handlers.ts";
import { registerGitHandlers } from "./handlers/git-handlers.ts";
import { registerHostingHandlers } from "./handlers/hosting-handlers.ts";
import { registerPortHandlers } from "./handlers/port-handlers.ts";
import { registerQuickOpenHandlers } from "./handlers/quick-open-handlers.ts";
import { registerSessionHandlers } from "./handlers/session-handlers.ts";
import { registerSessionNoteHandlers } from "./handlers/session-note-handlers.ts";
import { registerChatAttachmentHandlers } from "./handlers/chat-attachment-handlers.ts";
import { registerSettingsHandlers } from "./handlers/settings-handlers.ts";
import { registerProjectLinkHandlers } from "./handlers/project-link-handlers.ts";
import { registerWorkflowHandlers } from "./handlers/workflow-handlers.ts";
import { registerSideChatHandlers } from "./handlers/side-chat-handlers.ts";
import { registerTerminalHandlers } from "./handlers/terminal-handlers.ts";
import { registerWorkspaceHandlers } from "./handlers/workspace-handlers.ts";
import type { WorkspaceManager } from "./workspace-manager.ts";
import { registerTodoHandlers } from "./handlers/todo-handlers.ts";
import { registerSkillHandlers } from "./handlers/skill-handlers.ts";
import { registerPluginHandlers } from "./handlers/plugin-handlers.ts";
import { registerVoiceHandlers } from "./handlers/voice-handlers.ts";
import { managerMcp, type ManagerRoute } from "./manager-mcp-server.ts";
import { ManagerRouting, autoAllowedManagerTools } from "./manager-routing.ts";
import { log } from "./log.ts";
import { compactTranscript } from "./transcript-compaction.ts";

/** One agent app shared by every transport, so sessions outlive the connection that made them. */
export function createHarnessAgent(
  workspaces: WorkspaceManager,
  sessions: SessionRegistry,
  terminals: TerminalManager,
): acp.AgentApp {
  const clients = new Set<acp.AgentContext>();
  const pendingTurns = new Map<string, AbortController>();
  const managerRouting = new ManagerRouting();
  /** Tools the daemon serves itself (a workflow step's spawn_agents); the rest go to a window. */
  const localTools = new Map<ManagerToolName, { route: ManagerRoute; offeredTo: (sessionId: string) => boolean }>();
  managerMcp.setRoute((caller, tool, args) => (localTools.get(tool)?.route ?? managerRouting.route)(caller, tool, args));
  managerMcp.setStepToolOffers((sessionId, tool) => localTools.get(tool)?.offeredTo(sessionId) ?? false);
  let knownSessionIds = new Set<string>();
  sessions.onChange((list) => {
    const ids = new Set(list.map((s) => s.id));
    for (const id of knownSessionIds) {
      if (ids.has(id)) continue;
      managerMcp.forgetSession(id);
      managerRouting.forgetSession(id);
      mover.forget(id);
    }
    knownSessionIds = ids;
  });

  function broadcast(method: string, params: unknown): void {
    for (const client of clients) void client.notify(method, params).catch(() => undefined);
  }
  workspaces.onChange((state) => broadcast(HARNESS_NOTIFICATIONS.stateChanged, state));
  sessions.onChange((list) => broadcast(HARNESS_NOTIFICATIONS.sessionsChanged, list));
  terminals.onChange((list) => broadcast(HARNESS_NOTIFICATIONS.terminalsChanged, list));
  terminals.onOutput((terminalId, data) =>
    broadcast(HARNESS_NOTIFICATIONS.terminalOutput, { terminalId, data }),
  );

  /** Recorded for replay, then sent to every client so a reconnected window sees live turns. */
  async function emit(sessionId: string, update: acp.SessionUpdate): Promise<void> {
    await sessions.record(sessionId, update);
    broadcast(acp.methods.client.session.update, { sessionId, update });
  }
  const acpAgents = new AcpAgentSessions(sessions, emit);
  const mover = new SessionMover({ workspaces, sessions, pendingTurns, emit });
  /** Workflow step turns: their tool policy and result shape, picked up when the turn starts. */
  const stepTurns = new Map<string, { step: StepOptions; onResult: (r: { text: string; structured: unknown; usage: WorkflowStepUsage }) => void }>();

  /**
   * Starts a recovery turn and returns once it is running; it goes on without any window, and
   * permission asks reach whichever window is open.
   */
  async function startRecovery(sessionId: string, kind: TurnResumeKind): Promise<"started" | "busy" | "gone"> {
    if (!sessions.get(sessionId)) return "gone";
    if (pendingTurns.has(sessionId)) return "busy";
    const blocks = recoveryPrompt(await sessions.transcript(sessionId));
    void prompt({ sessionId, prompt: blocks }, askAnyClient, null, kind).catch(() => undefined);
    return "started";
  }

  const autoResume = new TurnAutoResume(
    sessions,
    async (sessionId) => {
      const outcome = await startRecovery(sessionId, "auto");
      if (outcome === "started") broadcast(TURN_RECOVERY_NOTIFICATIONS.autoResumed, { sessionId });
      return outcome;
    },
    (sessionId) =>
      void emit(sessionId, {
        sessionUpdate: "notice",
        severity: "warning",
        title: "Stopped resuming automatically: the usage limit kept refusing. Resume when you're ready.",
      }).catch(() => undefined),
  );
  autoResume.start();

  type Ask =(request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>;

  /** For turns no client started (automations): the newest window that answers permission asks. */
  const autoApprove = new Set<string>();
  const askAnyClient: Ask = async (request) => {
    if (autoApprove.has(request.sessionId)) {
      const allow = request.options.find((o) => o.kind === "allow_once") ?? request.options.find((o) => o.kind === "allow_always");
      if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } };
    }
    for (const client of [...clients].reverse()) {
      try {
        return await client.request(acp.methods.client.session.requestPermission, request);
      } catch {
        // A window that does not answer asks (the dashboard pop-out); try the next.
      }
    }
    await emit(request.sessionId, {
      sessionUpdate: "notice",
      severity: "warning",
      title: `No window was open to approve ${request.toolCall.title ?? "a tool call"}, so it was denied`,
    }).catch(() => undefined);
    return { outcome: { outcome: "cancelled" } };
  };

  /**
   * `client` is the window that started the turn (null for automations); manager tool calls route
   * through it. `resumed` marks a recovery turn, whose prompt the transcript shows as a divider.
   */
  async function prompt(
    params: acp.PromptRequest,
    ask: Ask,
    client: acp.AgentContext | null,
    resumed?: TurnResumeKind,
  ): Promise<acp.PromptResponse> {
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);

    pendingTurns.get(session.id)?.abort();
    const abort = new AbortController();
    pendingTurns.set(session.id, abort);
    if (client) managerRouting.noteTurn(session.id, client);

    const text = params.prompt.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const external = acpAgents.for(session);
    const firstTurn = external
      ? session.title === chatAgentLabel(external.agent) && (await sessions.transcript(session.id)).length === 0
      : session.claudeSessionId === null && session.title === "Claude";
    sessions.update(session.id, {
      status: "working",
      turnStartedAt: Date.now(),
      promptSuggestion: null,
      // Orca renames a fresh agent tab after its first message.
      ...(firstTurn && text ? { title: text.replace(/\s+/g, " ").slice(0, 40) } : {}),
    });
    const messageId = crypto.randomUUID();
    for (const block of params.prompt) {
      await emit(session.id, {
        sessionUpdate: "user_message_chunk",
        messageId,
        content: block,
        ...(resumed ? { _meta: { [TURN_RECOVERY_META.resumed]: resumed } } : {}),
      });
    }

    const askPermission = async (request: acp.RequestPermissionRequest) => {
      sessions.update(session.id, { status: "needs-you" });
      try {
        return await ask({ ...request, sessionId: session.id });
      } finally {
        if (pendingTurns.get(session.id) === abort) sessions.update(session.id, { status: "working" });
      }
    };

    // A side chat's seed rides on its first turn only; the transcript shows just what was typed.
    const seed = session.seedContext;
    const agentPrompt: acp.ContentBlock[] = seed ? [{ type: "text", text: seed }, ...params.prompt] : params.prompt;
    if (seed) sessions.update(session.id, { seedContext: null });

    // Set by the turn when it ends short (a usage limit, an error); a holder, as a callback writes it.
    const outcome: { end: TurnEndMeta | null } = { end: null };
    // A Stop (not a newer prompt taking over, nor the chat closing) leaves a row that offers Continue.
    const interrupted = async (): Promise<acp.PromptResponse> => {
      if (pendingTurns.get(session.id) !== abort || !sessions.get(session.id)) return { stopReason: "cancelled" };
      const stopped: TurnEndMeta = { reason: "interrupted" };
      await emit(session.id, {
        sessionUpdate: "notice",
        severity: "info",
        title: "Stopped",
        _meta: { [TURN_RECOVERY_META.turnEnd]: stopped },
      }).catch(() => undefined);
      sessions.update(session.id, { status: "idle", turnStartedAt: null, claudeSessionId: session.claudeSessionId });
      autoResume.turnEnded(session.id, stopped);
      return { stopReason: "cancelled" };
    };

    const quickChat = workspaces.isScratch(session.workspaceId);
    try {
      const stopReason = external
        ? await external.prompt(agentPrompt, abort, askPermission)
        : await runClaudeTurn({
        acpSessionId: session.id,
        state: session,
        prompt: agentPrompt,
        messageId,
        abort,
        emit: (update) => emit(session.id, update),
        onQuery: (query) => {
          if (query) liveClaudeQueries.set(session.id, query);
          else liveClaudeQueries.delete(session.id);
        },
        onPermissionMode: (permissionMode) =>
          sessions.update(session.id, { options: { ...session.options, permissionMode } }),
        onSlashCommands: (names) => noteSlashCommands(session.cwd, names),
        env: (await chatAgentLaunch("claude")).env,
        askPermission,
        // A quick chat sees its harness tools up front, so it can move itself into a project.
        // Workflow steps see them up front too, for ask_lead.
        mcpServers: managerMcp.claudeServers(
          session.id,
          session.role === "manager" || session.role === "lead" || quickChat || stepTurns.has(session.id),
        ),
        allowedTools: autoAllowedManagerTools(session.role, MANAGER_MCP_SERVER_NAME),
        ...(session.role === "manager"
          ? { appendSystemPrompt: MANAGER_SYSTEM_PROMPT }
          : session.role === "lead"
            ? { appendSystemPrompt: LEAD_SYSTEM_PROMPT }
            : quickChat
            ? { appendSystemPrompt: QUICK_CHAT_SYSTEM_PROMPT }
            : {}),
        onTurnEnd: (turnEnd) => (outcome.end = turnEnd),
        onPromptSuggestion: (promptSuggestion) => sessions.update(session.id, { promptSuggestion }),
        ...(stepTurns.get(session.id) ?? {}),
      });
      if (stopReason === "cancelled" || abort.signal.aborted) return await interrupted();
      sessions.update(session.id, {
        status: outcome.end ? "error" : "idle",
        turnStartedAt: null,
        claudeSessionId: session.claudeSessionId,
      });
      autoResume.turnEnded(session.id, outcome.end);
      if (!outcome.end) void continueAfterMove(session.id, ask, client);
      return { stopReason };
    } catch (error) {
      if (abort.signal.aborted) return await interrupted();
      log(`turn failed: ${error instanceof Error ? error.stack : String(error)}`);
      // The failure stays in the transcript, not just this reply, and can offer Retry or Resume.
      const title = error instanceof Error ? error.message : String(error);
      const limit = external ? undefined : detectUsageLimit({ text: title });
      const failed: TurnEndMeta = limit ? { reason: "usage-limit", resetsAt: limit.resetsAt } : { reason: "error" };
      await emit(session.id, {
        sessionUpdate: "notice",
        severity: "error",
        title,
        _meta: { [TURN_RECOVERY_META.turnEnd]: failed },
      }).catch(() => undefined);
      sessions.update(session.id, { status: "error", turnStartedAt: null, claudeSessionId: session.claudeSessionId });
      autoResume.turnEnded(session.id, failed);
      throw error;
    } finally {
      if (pendingTurns.get(session.id) === abort) pendingTurns.delete(session.id);
    }
  }

  const app = acp
    .agent({ name: "acp-harness" })
    .onConnect((connection) => {
      clients.add(connection.client);
      void connection.closed.finally(() => {
        clients.delete(connection.client);
        managerRouting.forgetClient(connection.client);
      });
    })
    .onRequest("initialize", (ctx) => {
      managerRouting.noteInitialize(ctx.client, ctx.params);
      return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { embeddedContext: true, image: true },
      },
      agentInfo: { name: "acp-harness", title: "Zomfy", version: "0.0.1" },
      };
    })
    .onRequest("authenticate", () => ({}))
    .onRequest("session/new", (ctx) => {
      // Outside ACP clients know only a cwd; harness UIs use `_harness/sessions/create`.
      const record = sessions.create({ workspaceId: null, cwd: ctx.params.cwd });
      log(`session ${record.id} in ${ctx.params.cwd}`);
      return { sessionId: record.id };
    })
    .onRequest("session/load", async (ctx) => {
      if (!sessions.get(ctx.params.sessionId)) throw new Error(`Unknown session ${ctx.params.sessionId}`);
      // Replay goes only to the client that asked; live updates already reach everyone.
      for (const update of compactTranscript(await sessions.transcript(ctx.params.sessionId))) {
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update,
        });
      }
      return {};
    })
    .onRequest("session/prompt", (ctx) =>
      prompt(
        ctx.params,
        (request) => ctx.client.request(acp.methods.client.session.requestPermission, request),
        ctx.client,
      ),
    )
    .onNotification("session/cancel", (ctx) => {
      pendingTurns.get(ctx.params.sessionId)?.abort();
    });

  function handle<M extends HarnessMethod>(
    method: M,
    run: (params: HarnessRequests[M]["params"]) => Promise<HarnessRequests[M]["result"]>,
  ): void {
    // Params come from our own UI over an authenticated socket; the handler validates what it uses.
    app.onRequest(method, (raw: unknown) => (raw ?? {}) as HarnessRequests[M]["params"], async (ctx) => {
      try {
        return await run(ctx.params);
      } catch (error) {
        if (error instanceof acp.RequestError) throw error;
        // Unwrapped errors reach the client as a bare "Internal error"; keep the reason.
        throw new acp.RequestError(-32000, error instanceof Error ? error.message : String(error));
      }
    });
  }

  /** A move the agent asked for mid-turn happens once the turn ends; the chat then carries on there. */
  async function continueAfterMove(sessionId: string, ask: Ask, client: acp.AgentContext | null): Promise<void> {
    try {
      const text = await mover.turnEnded(sessionId);
      if (text) await prompt({ sessionId, prompt: [{ type: "text", text }] }, ask, client, "moved");
    } catch (error) {
      log(`moving ${sessionId} failed: ${String(error)}`);
      await emit(sessionId, {
        sessionUpdate: "notice",
        severity: "error",
        title: `Could not move this chat: ${error instanceof Error ? error.message : String(error)}`,
      }).catch(() => undefined);
    }
  }

  const ctx: HandlerContext = {
    handle,
    workspaces,
    sessions,
    terminals,
    pendingTurns,
    startRecovery,
    autoResume,
    acpAgents,
    broadcast,
    emit,
    async runTurn(sessionId, text) {
      const { stopReason } = await prompt({ sessionId, prompt: [{ type: "text", text }] }, askAnyClient, null);
      return stopReason;
    },
    moveSession: (params) => mover.move(params),
    serveTool: (tool, route, offeredTo) => localTools.set(tool, { route, offeredTo }),
    autoApprove,
    async runStepTurn(sessionId, text, step) {
      let result: { text: string; structured: unknown; usage?: WorkflowStepUsage } = { text: "", structured: undefined };
      stepTurns.set(sessionId, { step, onResult: (r) => (result = r) });
      // Other agents have no result hook: their reply is what they said this turn.
      const record = sessions.get(sessionId);
      const external = !!record?.agent && record.agent !== "claude";
      // The step's MCP servers (a browser, say) reach other agents too, as servers of their session.
      if (external) acpAgents.setStepServers(sessionId, acpStdioServers(step.mcpServers, await hostPath()));
      const before = (await sessions.transcript(sessionId)).length;
      try {
        const { stopReason } = await prompt({ sessionId, prompt: [{ type: "text", text }] }, askAnyClient, null);
        const turn = (await sessions.transcript(sessionId)).slice(before);
        if (external) {
          const used = record ? acpAgents.for(record)?.lastUsage : null;
          result = {
            text: agentText(turn),
            structured: undefined,
            ...(used ? { usage: used } : {}),
          };
        }
        return { stopReason, ...result, tools: stepToolUse(turn) };
      } finally {
        stepTurns.delete(sessionId);
      }
    },
    workspaceRoot(workspaceId) {
      const root = workspaces.workspacePath(workspaceId);
      if (!root) throw new Error(`Unknown workspace ${workspaceId}`);
      return root;
    },
  };
  // One register function per area, so each area's handlers live (and change) in their own file.
  for (const register of [
    registerWorkspaceHandlers,
    registerSessionHandlers,
    registerSessionNoteHandlers,
    registerChatAttachmentHandlers,
    registerTerminalHandlers,
    registerFileHandlers,
    registerGitHandlers,
    registerHostingHandlers,
    registerPortHandlers,
    registerSettingsHandlers,
    registerQuickOpenHandlers,
    registerChatAgentHandlers,
    registerTodoHandlers,
    registerSideChatHandlers,
    registerAutomationHandlers,
    registerSkillHandlers,
    registerPluginHandlers,
    registerVoiceHandlers,
    registerTurnRecoveryHandlers,
    registerProjectLinkHandlers,
    registerWorkflowHandlers,
  ]) {
    register(ctx);
  }

  return app;
}

/**
 * A step's stdio MCP servers in ACP's shape. On Windows anything but a program (npx is npx.cmd) only
 * starts through cmd; `PATH` is the host's full one, which the daemon's own may lack.
 */
function acpStdioServers(servers: StepOptions["mcpServers"], PATH: string): acp.McpServer[] {
  return Object.entries(servers ?? {}).flatMap(([name, server]): acp.McpServer[] => {
    if (!("command" in server) || (server.type && server.type !== "stdio")) return [];
    const args = server.args ?? [];
    const env = Object.entries(server.env ?? {}).map(([key, value]) => ({ name: key, value }));
    const program = process.platform === "win32" && /\.exe$/i.test(Bun.which(server.command, { PATH }) ?? server.command);
    return [process.platform === "win32" && !program ? { name, command: "cmd.exe", args: ["/d", "/c", server.command, ...args], env } : { name, command: server.command, args, env }];
  });
}

/** Files a stretch of transcript read and edited, and the commands it ran. */
function stepToolUse(updates: acp.SessionUpdate[]): StepToolUse {
  const use: StepToolUse = { reads: [], edits: [], commands: [] };
  for (const update of updates) {
    if (update.sessionUpdate !== "tool_call") continue;
    const input = update.rawInput && typeof update.rawInput === "object" ? (update.rawInput as Record<string, unknown>) : {};
    const paths = [...(update.locations ?? []).map((l) => l.path), input.file_path, input.notebook_path].filter(
      (p): p is string => typeof p === "string" && !!p,
    );
    const command = typeof input.command === "string" ? input.command : Array.isArray(input.command) ? input.command.join(" ") : "";
    if (update.kind === "read") use.reads.push(...new Set(paths));
    else if (update.kind === "edit") use.edits.push(...new Set(paths));
    else if (update.kind === "execute" && command) use.commands.push(command);
  }
  return use;
}

/** The agent's own words in a stretch of transcript, as one text. */
function agentText(updates: acp.SessionUpdate[]): string {
  return updates
    .flatMap((u) => (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? [u.content.text] : []))
    .join("");
}
