import { HARNESS_METHODS, isChatAgentId } from "@acp-harness/protocol";
import { updateChatAgentLaunch } from "../chat-agent-launch-settings.ts";
import { listChatAgents } from "../chat-agent-launch-specs.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerChatAgentHandlers({ handle }: HandlerContext): void {
  handle(HARNESS_METHODS.chatAgentsList, async (p) => listChatAgents(p.refresh === true));
  handle(HARNESS_METHODS.chatAgentSetLaunch, async (p) => {
    if (!isChatAgentId(p.agent)) throw new Error(`Unknown agent ${String(p.agent)}`);
    // Claude's command is the existing Claude Code command setting.
    await updateChatAgentLaunch(p.agent, { ...(p.agent === "claude" ? {} : { command: p.command }), env: p.env });
    return listChatAgents(false);
  });
}
