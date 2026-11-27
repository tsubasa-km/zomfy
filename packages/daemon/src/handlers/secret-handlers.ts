import { CHAT_AGENT_NOTIFICATIONS, HARNESS_METHODS } from "@zomfy/protocol";
import { listChatAgents } from "../chat-agent-launch-specs.ts";
import { secrets } from "../secret-service.ts";
import { detectInstalledAgents } from "../tui-agent-detection.ts";
import { liveEnvironment } from "../user-environment.ts";
import type { HandlerContext } from "./handler-context.ts";

// Secrets agents can use but not see (docs/specs/agent-secrets.md), and Reload environment
// (docs/specs/live-environment.md). No value ever goes back to a client.
export function registerSecretHandlers({ handle, broadcast }: HandlerContext): void {
  // Loaded now, so redaction is on before any chat's update is recorded.
  secrets();
  handle(HARNESS_METHODS.secretsList, async () => secrets().list());
  handle(HARNESS_METHODS.secretSave, async (p) => secrets().save(p));
  handle(HARNESS_METHODS.secretDelete, async (p) => secrets().delete(p.id));
  handle(HARNESS_METHODS.environmentReload, async () => {
    const changed = await liveEnvironment().reload();
    // A CLI installed since the app started is found on the new PATH.
    await detectInstalledAgents(true);
    broadcast(CHAT_AGENT_NOTIFICATIONS.chatAgentsChanged, await listChatAgents(true));
    return { changed };
  });
}
