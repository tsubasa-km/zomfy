import * as acp from "@agentclientprotocol/sdk";
import { runClaudeTurn, type ClaudeSessionState } from "./claude-turn.ts";
import { log } from "./log.ts";

interface HarnessSession extends ClaudeSessionState {
  pendingTurn: AbortController | null;
}

/** One agent app shared by every transport, so sessions outlive the connection that made them. */
export function createHarnessAgent(): acp.AgentApp {
  const sessions = new Map<string, HarnessSession>();

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

  return acp
    .agent({ name: "acp-harness" })
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
}
