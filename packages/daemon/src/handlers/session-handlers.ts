import { HARNESS_METHODS } from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";

export function registerSessionHandlers({ handle, sessions, pendingTurns, workspaceRoot }: HandlerContext): void {
  handle(HARNESS_METHODS.sessionsList, async () => sessions.list());
  handle(HARNESS_METHODS.sessionCreate, async (p) => {
    const { claudeSessionId: _hidden, ...info } = sessions.create({
      workspaceId: p.workspaceId,
      cwd: workspaceRoot(p.workspaceId),
    });
    return info;
  });
  handle(HARNESS_METHODS.sessionClose, async (p) => {
    pendingTurns.get(p.sessionId)?.abort();
    await sessions.remove(p.sessionId);
    return {};
  });
}
