import { homedir } from "node:os";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { HARNESS_METHODS, MANAGER_MCP_SERVER_NAME, type ChatMcpStatusResult } from "@zomfy/protocol";
import type { HandlerContext } from "./handler-context.ts";
import { ClaudeControl, SIGN_IN_MS, chatMcpServer, startMcpSignIn, submitMcpCallback } from "../claude-control.ts";
import { UsageLimits } from "../usage-limits.ts";
import { chatAgentLaunch } from "../chat-agent-launch-settings.ts";
import { liveClaudeQueries } from "../live-claude-queries.ts";
import { managerMcp } from "../manager-mcp-server.ts";
import { log } from "../log.ts";

// The session panel's connectors and usage limits. A chat's servers are read from a control process
// of its own (claude-control.ts) started in the chat's folder with the tools the daemon gives its
// turns, so it sees what a turn would; a reconnect also reaches the turn running now, if any.

const USAGE_KEY = "usage";
const chatKey = (sessionId: string) => `chat:${sessionId}`;

export function registerChatStatusHandlers(ctx: HandlerContext): void {
  const { handle, sessions } = ctx;

  const claudeChat = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("This thread is gone.");
    if ((session.agent ?? "claude") !== "claude") throw new Error("Connectors are listed for Claude threads.");
    return session;
  };

  const control = new ClaudeControl(async (key) => {
    const env = (await chatAgentLaunch("claude")).env;
    if (key === USAGE_KEY) return { cwd: homedir(), env, noMcp: true };
    const sessionId = key.slice("chat:".length);
    const session = claudeChat(sessionId);
    return { cwd: session.cwd, env, mcpServers: managerMcp.claudeServers(sessionId) };
  });

  const limits = new UsageLimits({
    withClaude: <T>(read: (query: Query) => Promise<T>, sessionId?: string) => {
      const live = sessionId ? liveClaudeQueries.get(sessionId) : undefined;
      if (live) return read(live);
      // A chat's own control process is up while its panel shows: no second process for the limits.
      if (sessionId && control.has(chatKey(sessionId))) return control.with(chatKey(sessionId), read);
      return control.with(USAGE_KEY, read);
    },
    codexHome: async () => (await chatAgentLaunch("codex")).env.CODEX_HOME ?? process.env.CODEX_HOME,
  });

  const status = async (sessionId: string): Promise<ChatMcpStatusResult> => {
    claudeChat(sessionId);
    const servers = await control.with(chatKey(sessionId), (query) => query.mcpServerStatus());
    return { servers: servers.map((s) => chatMcpServer(s, MANAGER_MCP_SERVER_NAME)) };
  };

  handle(HARNESS_METHODS.chatMcpStatus, (p) => status(p.sessionId));

  handle(HARNESS_METHODS.chatMcpReconnect, async (p) => {
    claudeChat(p.sessionId);
    const live = liveClaudeQueries.get(p.sessionId);
    if (live) await live.reconnectMcpServer(p.server).catch((error) => log(`reconnecting ${p.server} in the turn: ${String(error)}`));
    await control.with(chatKey(p.sessionId), (query) => query.reconnectMcpServer(p.server));
    return status(p.sessionId);
  });

  handle(HARNESS_METHODS.chatMcpToggle, async (p) => {
    claudeChat(p.sessionId);
    if (p.server === MANAGER_MCP_SERVER_NAME) throw new Error("The harness's own tools cannot be turned off.");
    const live = liveClaudeQueries.get(p.sessionId);
    if (live) await live.toggleMcpServer(p.server, p.enabled).catch((error) => log(`toggling ${p.server} in the turn: ${String(error)}`));
    await control.with(chatKey(p.sessionId), (query) => query.toggleMcpServer(p.server, p.enabled));
    return status(p.sessionId);
  });

  // The sign-in's callback listener lives in the control process, which stays up until it is done.
  handle(HARNESS_METHODS.chatMcpAuthenticate, async (p) => {
    claudeChat(p.sessionId);
    return control.with(chatKey(p.sessionId), (query) => startMcpSignIn(query, p.server), SIGN_IN_MS);
  });

  handle(HARNESS_METHODS.chatMcpCallback, async (p) => {
    claudeChat(p.sessionId);
    if (!control.has(chatKey(p.sessionId))) throw new Error("That sign-in has ended. Start it again.");
    await control.with(chatKey(p.sessionId), (query) => submitMcpCallback(query, p.server, p.callbackUrl.trim()));
    return status(p.sessionId);
  });

  handle(HARNESS_METHODS.usageLimits, (p) => limits.read({ refresh: p.refresh === true, ...(p.sessionId ? { sessionId: p.sessionId } : {}) }));
}
