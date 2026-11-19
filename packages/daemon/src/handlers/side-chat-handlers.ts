import type * as acp from "@agentclientprotocol/sdk";
import {
  HARNESS_METHODS,
  SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES,
  isChatAgentId,
  type ChatAgentId,
} from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";
import { DEFAULT_SESSION_OPTIONS, publicInfo } from "../session-registry.ts";
import { conversationMessages } from "../conversation-messages.ts";
import { log } from "../log.ts";
import { refuseUnattended } from "../chat-agent-launch-specs.ts";

/** Long answers are clipped so the seed stays a small part of the side chat's context. */
const MESSAGE_CHAR_LIMIT = 2000;

type Message = { role: "User" | "Assistant"; text: string };

/** The messages a side chat is shown: the ones with words (a turn of tool calls alone has none). */
function spokenMessages(updates: acp.SessionUpdate[]): Message[] {
  return conversationMessages(updates).filter((m) => m.text.trim());
}

export function registerSideChatHandlers({ handle, sessions, acpAgents }: HandlerContext): void {
  handle(HARNESS_METHODS.sideChatCreate, async (p) => {
    const main = sessions.get(p.sessionId);
    if (!main) throw new Error(`Unknown session ${p.sessionId}`);
    if (p.agent !== undefined && !isChatAgentId(p.agent)) throw new Error(`Unknown agent ${String(p.agent)}`);
    const agent: ChatAgentId = p.agent ?? "claude";
    // A side chat is handed the main conversation: another agent's words would drive it.
    refuseUnattended(agent, "side chats");
    const count = Math.max(0, Math.min(40, Math.floor(p.contextMessages ?? SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES)));
    const recent = count > 0 ? spokenMessages(await sessions.transcript(main.id)).slice(-count) : [];

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
