import * as acp from "@agentclientprotocol/sdk";
import {
  HARNESS_NOTIFICATIONS,
  type HarnessMethod,
  type HarnessRequests,
} from "@acp-harness/protocol";
import { runClaudeTurn } from "./claude-turn.ts";
import type { SessionRegistry } from "./session-registry.ts";
import type { TerminalManager } from "./terminal-manager.ts";
import type { HandlerContext } from "./handlers/handler-context.ts";
import { registerFileHandlers } from "./handlers/file-handlers.ts";
import { registerGitHandlers } from "./handlers/git-handlers.ts";
import { registerSessionHandlers } from "./handlers/session-handlers.ts";
import { registerTerminalHandlers } from "./handlers/terminal-handlers.ts";
import { registerWorkspaceHandlers } from "./handlers/workspace-handlers.ts";
import type { WorkspaceManager } from "./workspace-manager.ts";
import { log } from "./log.ts";

/** One agent app shared by every transport, so sessions outlive the connection that made them. */
export function createHarnessAgent(
  workspaces: WorkspaceManager,
  sessions: SessionRegistry,
  terminals: TerminalManager,
): acp.AgentApp {
  const clients = new Set<acp.AgentContext>();
  const pendingTurns = new Map<string, AbortController>();

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

  async function prompt(
    params: acp.PromptRequest,
    client: acp.AgentContext,
  ): Promise<acp.PromptResponse> {
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);

    pendingTurns.get(session.id)?.abort();
    const abort = new AbortController();
    pendingTurns.set(session.id, abort);

    const text = params.prompt.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const firstTurn = session.claudeSessionId === null && session.title === "Claude";
    sessions.update(session.id, {
      status: "working",
      turnStartedAt: Date.now(),
      // Orca renames a fresh agent tab after its first message.
      ...(firstTurn && text ? { title: text.replace(/\s+/g, " ").slice(0, 40) } : {}),
    });
    for (const block of params.prompt) {
      await emit(session.id, { sessionUpdate: "user_message_chunk", content: block });
    }

    try {
      const stopReason = await runClaudeTurn({
        acpSessionId: session.id,
        state: session,
        prompt: params.prompt,
        abort,
        emit: (update) => emit(session.id, update),
        askPermission: async (request) => {
          sessions.update(session.id, { status: "needs-you" });
          try {
            return await client.request(acp.methods.client.session.requestPermission, request);
          } finally {
            if (pendingTurns.get(session.id) === abort) sessions.update(session.id, { status: "working" });
          }
        },
      });
      sessions.update(session.id, { status: "idle", turnStartedAt: null, claudeSessionId: session.claudeSessionId });
      return { stopReason };
    } catch (error) {
      if (abort.signal.aborted) {
        sessions.update(session.id, { status: "idle", turnStartedAt: null });
        return { stopReason: "cancelled" };
      }
      log(`turn failed: ${error instanceof Error ? error.stack : String(error)}`);
      sessions.update(session.id, { status: "error", turnStartedAt: null });
      throw error;
    } finally {
      if (pendingTurns.get(session.id) === abort) pendingTurns.delete(session.id);
    }
  }

  const app = acp
    .agent({ name: "acp-harness" })
    .onConnect((connection) => {
      clients.add(connection.client);
      void connection.closed.finally(() => clients.delete(connection.client));
    })
    .onRequest("initialize", () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { embeddedContext: true },
      },
      agentInfo: { name: "acp-harness", title: "ACP Harness", version: "0.0.1" },
    }))
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
      for (const update of await sessions.transcript(ctx.params.sessionId)) {
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update,
        });
      }
      return {};
    })
    .onRequest("session/prompt", (ctx) => prompt(ctx.params, ctx.client))
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

  const ctx: HandlerContext = {
    handle,
    workspaces,
    sessions,
    terminals,
    pendingTurns,
    broadcast,
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
    registerTerminalHandlers,
    registerFileHandlers,
    registerGitHandlers,
  ]) {
    register(ctx);
  }

  return app;
}
