import * as acp from "@agentclientprotocol/sdk";
import {
  HARNESS_METHODS,
  HARNESS_NOTIFICATIONS,
  type HarnessMethod,
  type HarnessRequests,
} from "@acp-harness/protocol";
import { runClaudeTurn, type ClaudeSessionState } from "./claude-turn.ts";
import type { WorkspaceManager } from "./workspace-manager.ts";
import { log } from "./log.ts";

interface HarnessSession extends ClaudeSessionState {
  pendingTurn: AbortController | null;
}

/** One agent app shared by every transport, so sessions outlive the connection that made them. */
export function createHarnessAgent(workspaces: WorkspaceManager): acp.AgentApp {
  const sessions = new Map<string, HarnessSession>();
  const clients = new Set<acp.AgentContext>();

  workspaces.onChange((state) => {
    for (const client of clients) {
      void client.notify(HARNESS_NOTIFICATIONS.stateChanged, state).catch(() => undefined);
    }
  });

  async function prompt(
    params: acp.PromptRequest,
    client: acp.AgentContext,
  ): Promise<acp.PromptResponse> {
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);

    session.pendingTurn?.abort();
    const abort = new AbortController();
    session.pendingTurn = abort;
    try {
      const stopReason = await runClaudeTurn({
        acpSessionId: params.sessionId,
        state: session,
        prompt: params.prompt,
        abort,
        client,
      });
      return { stopReason };
    } catch (error) {
      if (abort.signal.aborted) return { stopReason: "cancelled" };
      log(`turn failed: ${error instanceof Error ? error.stack : String(error)}`);
      throw error;
    } finally {
      if (session.pendingTurn === abort) session.pendingTurn = null;
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
        loadSession: false,
        promptCapabilities: { embeddedContext: true },
      },
      agentInfo: { name: "acp-harness", title: "ACP Harness", version: "0.0.1" },
    }))
    .onRequest("authenticate", () => ({}))
    .onRequest("session/new", (ctx) => {
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, {
        cwd: ctx.params.cwd,
        claudeSessionId: null,
        pendingTurn: null,
      });
      log(`session ${sessionId} in ${ctx.params.cwd}`);
      return { sessionId };
    })
    .onRequest("session/prompt", (ctx) => prompt(ctx.params, ctx.client))
    .onNotification("session/cancel", (ctx) => {
      sessions.get(ctx.params.sessionId)?.pendingTurn?.abort();
    });

  function handle<M extends HarnessMethod>(
    method: M,
    run: (params: HarnessRequests[M]["params"]) => Promise<HarnessRequests[M]["result"]>,
  ): void {
    // Params come from our own UI over an authenticated socket; the handler validates what it uses.
    app.onRequest(method, (raw: unknown) => (raw ?? {}) as HarnessRequests[M]["params"], (ctx) =>
      run(ctx.params),
    );
  }

  handle(HARNESS_METHODS.stateGet, () => workspaces.snapshot());
  handle(HARNESS_METHODS.projectAdd, (p) => workspaces.addProject(p.path));
  handle(HARNESS_METHODS.projectRemove, async (p) => {
    await workspaces.removeProject(p.projectId);
    return {};
  });
  handle(HARNESS_METHODS.workspaceCreate, (p) => workspaces.createWorkspace(p));
  handle(HARNESS_METHODS.workspaceRemove, async (p) => {
    await workspaces.removeWorkspace(p);
    return {};
  });
  handle(HARNESS_METHODS.branchesList, (p) => workspaces.listBranches(p.projectId));
  handle(HARNESS_METHODS.floatingCwdSet, (p) => workspaces.setFloatingCwd(p.path));

  return app;
}
