import type * as acp from "@agentclientprotocol/sdk";
import {
  HARNESS_METHODS,
  SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES,
  isChatAgentId,
  type ChatAgentId,
} from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";
import { DEFAULT_SESSION_OPTIONS, publicInfo } from "../session-registry.ts";
import { log } from "../log.ts";

/** Long answers are clipped so the seed stays a small part of the side chat's context. */
const MESSAGE_CHAR_LIMIT = 2000;

type Message = { role: "User" | "Assistant"; text: string };

export function registerSideChatHandlers({ handle, sessions, acpAgents }: HandlerContext): void {
  handle(HARNESS_METHODS.sideChatCreate, async (p) => {
    const main = sessions.get(p.sessionId);
    if (!main) throw new Error(`Unknown session ${p.sessionId}`);
    if (p.agent !== undefined && !isChatAgentId(p.agent)) throw new Error(`Unknown agent ${String(p.agent)}`);
    const agent: ChatAgentId = p.agent ?? "claude";
    const count = Math.max(0, Math.min(40, Math.floor(p.contextMessages ?? SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES)));
    const recent = count > 0 ? conversationMessages(await sessions.transcript(main.id)).slice(-count) : [];

    const record = sessions.create({
      workspaceId: main.workspaceId,
      cwd: main.cwd,
      title: "Side chat",
      sideOf: main.id,
      seedContext: seedText(main.title, recent),
      // A quick aside, so Claude answers on low effort unless the user picks otherwise.
      options: { ...DEFAULT_SESSION_OPTIONS, effort: agent === "claude" ? "low" : null },
      ...(agent !== "claude" ? { agent } : {}),
    });
    const notice: acp.SessionUpdate = {
      sessionUpdate: "notice",
      severity: "info",
      title:
        recent.length > 0
          ? `Side chat: sees the last ${recent.length} message${recent.length === 1 ? "" : "s"} of “${main.title}”, which it leaves untouched`
          : `Side chat beside “${main.title}”, which it leaves untouched`,
    };
    await sessions.record(record.id, notice);
    acpAgents.for(record)?.ensureStarted().catch((error) => log(`starting ${agent} failed: ${String(error)}`));
    return publicInfo(record);
  });
}

/** The transcript's user and agent text, with streamed chunks joined into whole messages. */
function conversationMessages(updates: acp.SessionUpdate[]): Message[] {
  const messages: Message[] = [];
  for (const update of updates) {
    if (update.sessionUpdate !== "user_message_chunk" && update.sessionUpdate !== "agent_message_chunk") continue;
    if (update.content.type !== "text") continue;
    const role = update.sessionUpdate === "user_message_chunk" ? "User" : "Assistant";
    const last = messages.at(-1);
    if (last?.role === role) last.text += update.content.text;
    else messages.push({ role, text: update.content.text });
  }
  return messages.filter((m) => m.text.trim());
}

function seedText(mainTitle: string, recent: Message[]): string {
  const lines = [
    "<side-chat-context>",
    `This is a side chat opened beside the user's main conversation ("${mainTitle}") in the same workspace.`,
    "Answer the user's quick questions here. Do not change files or run long tasks unless the user asks;",
    "the main conversation's agent keeps doing the real work.",
  ];
  if (recent.length > 0) {
    lines.push("", "Most recent messages of the main conversation:");
    for (const m of recent) {
      const text = m.text.trim();
      lines.push("", `${m.role}: ${text.length > MESSAGE_CHAR_LIMIT ? `${text.slice(0, MESSAGE_CHAR_LIMIT)}…` : text}`);
    }
  }
  lines.push("</side-chat-context>");
  return lines.join("\n");
}
