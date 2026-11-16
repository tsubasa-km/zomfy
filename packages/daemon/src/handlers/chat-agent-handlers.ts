import { CHAT_AGENT_NOTIFICATIONS, HARNESS_METHODS, isChatAgentId } from "@acp-harness/protocol";
import { updateChatAgentLaunch } from "../chat-agent-launch-settings.ts";
import { checkUpdates, installChatAgent, listChatAgents } from "../chat-agent-launch-specs.ts";
import { scheduleAgentUpdateChecks } from "../chat-agent-updates.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerChatAgentHandlers({ handle, broadcast }: HandlerContext): void {
  // Windows learn of a newer agent release without asking; the settings row offers the update.
  scheduleAgentUpdateChecks(async () => {
    if (await checkUpdates(true)) broadcast(CHAT_AGENT_NOTIFICATIONS.chatAgentsChanged, await listChatAgents(false));
  });
  handle(HARNESS_METHODS.chatAgentsList, async (p) => listChatAgents(p.refresh === true));
  handle(HARNESS_METHODS.chatAgentSetLaunch, async (p) => {
    if (!isChatAgentId(p.agent)) throw new Error(`Unknown agent ${String(p.agent)}`);
    // Claude's command is the existing Claude Code command setting.
    await updateChatAgentLaunch(p.agent, { ...(p.agent === "claude" ? {} : { command: p.command }), env: p.env });
    return listChatAgents(false);
  });
  handle(HARNESS_METHODS.chatAgentInstall, async (p) => {
    if (!isChatAgentId(p.agent)) throw new Error(`Unknown agent ${String(p.agent)}`);
    const result = await installChatAgent(p.agent);
    // Other windows on this host see the agent installed (or updated) too.
    broadcast(CHAT_AGENT_NOTIFICATIONS.chatAgentsChanged, result.agents);
    return result;
  });
}
