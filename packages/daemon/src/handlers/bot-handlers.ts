import type * as acp from "@agentclientprotocol/sdk";
import { BOT_METHODS, TURN_RECOVERY_META, type Bot, type TurnEndMeta } from "@zomfy/protocol";
import type { Failure } from "@zomfy/relay-contract";
import type { HandlerContext } from "./handler-context.ts";
import { BotService, type BotServiceChats } from "../bot-service.ts";
import type { BotTurnResult } from "../bot-deliveries.ts";
import { refuseUnattended } from "../chat-agent-launch-specs.ts";
import { DEFAULT_SESSION_OPTIONS } from "../session-registry.ts";
import { HARNESS_HOME } from "../harness-home.ts";
import { log } from "../log.ts";

/** The turn's last assistant message: what it said after its last tool call, else all it said. */
export function lastAgentMessage(updates: acp.SessionUpdate[]): string {
  const text = (list: acp.SessionUpdate[]) =>
    list.flatMap((u) => (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? [u.content.text] : [])).join("");
  const lastTool = updates.findLastIndex((u) => u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update");
  return text(updates.slice(lastTool + 1)).trim() || text(updates).trim();
}

/** How a turn ended short, from the notice it left, as a typed failure. */
export function turnFailure(updates: acp.SessionUpdate[]): Failure | undefined {
  for (const update of [...updates].reverse()) {
    const meta = (update as { _meta?: Record<string, unknown> })._meta?.[TURN_RECOVERY_META.turnEnd] as TurnEndMeta | undefined;
    if (!meta || typeof meta !== "object") continue;
    if (meta.reason === "usage-limit") return { category: "usage_limit", ...(meta.resetsAt ? { resetsAt: meta.resetsAt } : {}) };
    if (meta.reason === "error") {
      const title = update.sessionUpdate === "notice" ? (update as { title?: string }).title : undefined;
      return { category: "agent_error", ...(title ? { message: title.slice(0, 1000) } : {}) };
    }
    return undefined;
  }
  return undefined;
}

/** Bot chats on the real session registry: turns run like an automation's, with no window needed. */
function botChats({ sessions, workspaces, pendingTurns, runTurn }: HandlerContext): BotServiceChats {
  return {
    create(bot: Bot, init) {
      refuseUnattended(bot.agent, "bots");
      const cwd = workspaces.workspacePath(bot.homeWorkspaceId);
      if (!cwd) throw new Error(`${bot.name}'s home workspace is gone`);
      return sessions.create({
        workspaceId: bot.homeWorkspaceId,
        cwd,
        title: init.title,
        origin: "bot",
        botId: bot.id,
        ...(init.from ? { botFrom: init.from } : {}),
        ...(init.seed ? { seedContext: init.seed } : {}),
        options: { ...DEFAULT_SESSION_OPTIONS, permissionMode: bot.permissionMode, model: bot.model },
        ...(bot.agent !== "claude" ? { agent: bot.agent } : {}),
      }).id;
    },
    exists: (sessionId) => sessions.get(sessionId) !== undefined,
    busy: (sessionId) => pendingTurns.has(sessionId),
    async waitIdle(sessionId) {
      while (pendingTurns.has(sessionId)) await Bun.sleep(250);
    },
    async run(sessionId, text): Promise<BotTurnResult> {
      const before = (await sessions.transcript(sessionId)).length;
      let stopReason: string;
      let thrown: unknown;
      try {
        stopReason = await runTurn(sessionId, text);
      } catch (error) {
        stopReason = "error";
        thrown = error;
      }
      const updates = (await sessions.transcript(sessionId)).slice(before);
      const failure =
        stopReason === "cancelled"
          ? undefined
          : (turnFailure(updates) ??
            (thrown !== undefined
              ? { category: "agent_error" as const, message: String((thrown as Error)?.message ?? thrown).slice(0, 1000) }
              : stopReason === "refusal"
                ? { category: "agent_error" as const, message: "The chat could not take the message now" }
                : undefined));
      return { stopReason, text: lastAgentMessage(updates), ...(failure ? { failure } : {}) };
    },
    stop: (sessionId) => pendingTurns.get(sessionId)?.abort(),
  };
}

export function registerBotHandlers(ctx: HandlerContext): void {
  const { handle, workspaces, broadcast } = ctx;
  const service = new BotService({
    home: HARNESS_HOME,
    workspaces: { workspacePath: (id) => workspaces.workspacePath(id), workspaceForFolder: (path) => workspaces.workspaceForFolder(path) },
    chats: botChats(ctx),
    broadcast,
    log,
  });
  // Started with the daemon, not a window: a paired host answers while no window is open.
  try {
    service.start();
  } catch (error) {
    log(`bots: the connector failed to start: ${String(error)}`);
  }

  handle(BOT_METHODS.botsList, async () => ({ bots: service.list() }));
  handle(BOT_METHODS.botCreate, async (p) => service.create(p.input));
  handle(BOT_METHODS.botUpdate, async (p) => service.update(p.id, p.patch));
  handle(BOT_METHODS.botDelete, async (p) => {
    service.remove(p.id, p.deleteHome === true);
    return {};
  });
  handle(BOT_METHODS.botPause, async (p) => service.pause(p.id, p.paused));
  handle(BOT_METHODS.botAskers, async (p) => service.setAskers(p.id, p.source, p.askers));
  handle(BOT_METHODS.botsAccessRequests, async () => ({ requests: service.accessRequests() }));
  handle(BOT_METHODS.botsAnswerAccessRequest, async (p) => {
    service.answerAccessRequest(p.id, p.allow);
    return {};
  });
  handle(BOT_METHODS.botsConnectorStatus, async () => service.connectorStatus());
  handle(BOT_METHODS.botsConnectorPair, async (p) => service.connectorPair(p));
  handle(BOT_METHODS.botsConnectorUnpair, async () => service.connectorUnpair());
  handle(BOT_METHODS.botChatCreate, async (p) => service.chatCreate(p.id, p.text, p.fromSessionId));
}
