import type * as acp from "@agentclientprotocol/sdk";
import { BOT_METHODS, TURN_RECOVERY_META, type Bot, type TurnEndMeta } from "@zomfy/protocol";
import type { Failure } from "@zomfy/relay-contract";
import type { HandlerContext } from "./handler-context.ts";
import { BotService, type BotServiceChats } from "../bot-service.ts";
import type { BotTurnResult } from "../bot-deliveries.ts";
import { toolAutomationInput } from "../bot-automations.ts";
import { conversationRef, turnPrLinks } from "../bot-turn-extras.ts";
import { git } from "../git-cli.ts";
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

/** How the turn after transcript index `before` went. */
async function turnResult(ctx: HandlerContext, sessionId: string, before: number, stopReason: string, thrown?: unknown): Promise<BotTurnResult> {
  const updates = (await ctx.sessions.transcript(sessionId)).slice(before);
  const failure =
    stopReason === "cancelled"
      ? undefined
      : (turnFailure(updates) ??
        (thrown !== undefined
          ? { category: "agent_error" as const, message: String((thrown as Error)?.message ?? thrown).slice(0, 1000) }
          : stopReason === "refusal"
            ? { category: "agent_error" as const, message: "The chat could not take the message now" }
            : undefined));
  const text = lastAgentMessage(updates);
  const prLinks = turnPrLinks(updates, text);
  return { stopReason, text, ...(failure ? { failure } : {}), ...(prLinks.length ? { prLinks } : {}) };
}

/** Whether `headSha` is the workspace's HEAD or one of its ancestors (the worker went on since). */
async function atCommit(cwd: string, headSha: string): Promise<boolean> {
  try {
    const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
    if (head.startsWith(headSha)) return true;
    await git(cwd, ["merge-base", "--is-ancestor", headSha, "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/** Bot chats on the real session registry: turns run like an automation's, with no window needed. */
function botChats(ctx: HandlerContext): BotServiceChats {
  const { sessions, workspaces, pendingTurns, runTurn } = ctx;
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
        options: { ...DEFAULT_SESSION_OPTIONS, permissionMode: init.permissionMode ?? bot.permissionMode, model: bot.model },
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
      return turnResult(ctx, sessionId, before, stopReason, thrown);
    },
    stop: (sessionId) => pendingTurns.get(sessionId)?.abort(),
    mark: async (sessionId) => (await sessions.transcript(sessionId)).length,
    resultSince: (sessionId, at) => turnResult(ctx, sessionId, at, "end_turn"),
    async prWorker(branch, headSha) {
      const state = await workspaces.snapshot();
      for (const workspace of state.workspaces.filter((w) => w.branch === branch)) {
        const cwd = workspaces.workspacePath(workspace.id);
        if (!cwd || !(await atCommit(cwd, headSha))) continue;
        // The newest chat in that worktree, a bot's worker before any other.
        const chats = sessions
          .list()
          .filter((s) => s.workspaceId === workspace.id && !s.sideOf)
          .sort((a, b) => Number(!!b.botId || !!b.parentId) - Number(!!a.botId || !!a.parentId) || (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt));
        if (chats[0]) return chats[0].id;
      }
      return null;
    },
  };
}

export function registerBotHandlers(ctx: HandlerContext): void {
  const { handle, workspaces, broadcast, sessions } = ctx;
  const service = new BotService({
    home: HARNESS_HOME,
    workspaces: { workspacePath: (id) => workspaces.workspacePath(id), workspaceForFolder: (path) => workspaces.workspaceForFolder(path) },
    chats: botChats(ctx),
    broadcast,
    log,
    asks: ctx.asks,
  });
  if (ctx.services.automations) service.setAutomations(ctx.services.automations);
  // A bot turn's activity, and the owner's words in a Slack-linked chat.
  ctx.onSessionUpdate((sessionId, update) => {
    if (sessions.get(sessionId)?.origin === "bot") service.sessionUpdate(sessionId, update);
  });
  // Turns a bot chat runs on its own, and the workers a linked chat started.
  const lastStatus = new Map<string, string>();
  sessions.onChange((list) => {
    const children = new Map<string, { sessionId: string; title: string; status: string }[]>();
    for (const session of list) {
      if (session.origin === "bot" && lastStatus.get(session.id) !== session.status) {
        lastStatus.set(session.id, session.status);
        service.deliveries.status(session.id, session.status);
      }
      if (session.parentId) {
        const running = session.status === "working" || session.status === "needs-you";
        const entry = children.get(session.parentId) ?? [];
        if (running) entry.push({ sessionId: session.id, title: session.title, status: session.status });
        children.set(session.parentId, entry);
      }
    }
    for (const [parentId, workers] of children) service.deliveries.workers(parentId, workers);
  });
  // A bot saves its own schedules and triggers from its chats.
  ctx.serveTool(
    "create_bot_automation",
    async (caller, _tool, args) => {
      const automations = ctx.services.automations;
      const botId = sessions.get(caller)?.botId;
      const bot = botId ? service.store.get(botId) : undefined;
      if (!bot || !automations) return { result: "Only a Zomfy bot's chat can save a bot automation.", isError: true };
      try {
        const conversation = service.deliveries.conversationOf(caller);
        const input = toolAutomationInput(bot, args, { sessionId: caller, threadRef: conversation ? conversationRef(conversation) : null });
        const saved = automations.create(input);
        const when = saved.nextRunAt ? ` Next run: ${new Date(saved.nextRunAt).toString()}.` : "";
        return { result: `Saved "${saved.name}" (${saved.id}).${when}` };
      } catch (error) {
        return { result: (error as Error).message, isError: true };
      }
    },
    (sessionId) => sessions.get(sessionId)?.origin === "bot",
  );
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
  handle(BOT_METHODS.botsNotices, async () => ({ notices: service.notices() }));
  handle(BOT_METHODS.botsDismissNotice, async (p) => {
    service.dismissNotice(p.id);
    return {};
  });
  handle(BOT_METHODS.botsAction, async (p) => ({ result: await service.windowAction(p.verb, p.ref, p.args ?? {}) }));
}
