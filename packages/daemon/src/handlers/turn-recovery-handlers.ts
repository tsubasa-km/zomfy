import { HARNESS_METHODS } from "@acp-harness/protocol";
import { publicInfo } from "../session-registry.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerTurnRecoveryHandlers({ handle, sessions, startRecovery, autoResume }: HandlerContext): void {
  handle(HARNESS_METHODS.sessionResumeTurn, async (p) => {
    const outcome = await startRecovery(p.sessionId, p.kind);
    if (outcome === "gone") throw new Error(`Unknown session ${p.sessionId}`);
    if (outcome === "busy") throw new Error("The agent is already working in this chat");
    return {};
  });

  handle(HARNESS_METHODS.sessionSetAutoResume, async (p) => {
    const session = sessions.get(p.sessionId);
    if (!session) throw new Error(`Unknown session ${p.sessionId}`);
    if (p.enabled) autoResume.enable(session.id, p.resetsAt ?? null);
    else autoResume.disable(session.id);
    return publicInfo(session);
  });
}
