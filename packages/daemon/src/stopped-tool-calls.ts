import type * as acp from "@agentclientprotocol/sdk";
import { TURN_RECOVERY_META } from "@zomfy/protocol";

// A tool call whose turn or process has stopped never gets a result of its own: these close it,
// so no client shows it running for good (stopped-tool-calls.md).

/** `_meta` on a notice that says the chat's Claude process is gone (its background tasks were stopped). */
export const PROCESS_GONE_META = "harness/processGone";

/** Whether recording `update` means every call still open in the chat has stopped. */
export function stopsOpenToolCalls(update: acp.SessionUpdate): boolean {
  if (update.sessionUpdate !== "notice") return false;
  const meta = (update as { _meta?: Record<string, unknown> | null })._meta;
  return Boolean(meta?.[TURN_RECOVERY_META.turnEnd] || meta?.[PROCESS_GONE_META]);
}

/** The updates that close every tool call `transcript` leaves pending or in progress. */
export function stoppedToolCallUpdates(transcript: readonly acp.SessionUpdate[]): acp.SessionUpdate[] {
  const open = new Map<string, boolean>();
  for (const update of transcript) {
    if (update.sessionUpdate === "tool_call") {
      open.set(update.toolCallId, isOpen(update.status ?? "pending"));
    } else if (update.sessionUpdate === "tool_call_update" && update.status) {
      open.set(update.toolCallId, isOpen(update.status));
    }
  }
  return [...open]
    .filter(([, stillOpen]) => stillOpen)
    .map(([toolCallId]) => ({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "failed",
      _meta: { [TURN_RECOVERY_META.toolStopped]: true },
    }));
}

function isOpen(status: string): boolean {
  return status === "pending" || status === "in_progress";
}
