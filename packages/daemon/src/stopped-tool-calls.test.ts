import { describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { TURN_RECOVERY_META } from "@zomfy/protocol";
import { PROCESS_GONE_META, stopsOpenToolCalls, stoppedToolCallUpdates } from "./stopped-tool-calls.ts";

const call = (toolCallId: string, status?: acp.ToolCallStatus): acp.SessionUpdate => ({
  sessionUpdate: "tool_call",
  toolCallId,
  title: toolCallId,
  ...(status ? { status } : {}),
});
const update = (toolCallId: string, status?: acp.ToolCallStatus): acp.SessionUpdate => ({
  sessionUpdate: "tool_call_update",
  toolCallId,
  ...(status ? { status } : {}),
});

describe("stoppedToolCallUpdates", () => {
  test("closes every call whose last status is pending or in progress, as stopped", () => {
    const closes = stoppedToolCallUpdates([
      call("bash"),
      update("bash", "in_progress"),
      call("read", "in_progress"),
      update("read", "completed"),
      call("task", "pending"),
      // A content-only update keeps the status it had.
      update("task"),
      call("child", "in_progress"),
      call("failed"),
      update("failed", "failed"),
    ]);
    expect(closes).toEqual(
      ["bash", "task", "child"].map((toolCallId) => ({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        _meta: { [TURN_RECOVERY_META.toolStopped]: true },
      })),
    );
  });

  test("leaves a transcript with no open calls as it is", () => {
    expect(stoppedToolCallUpdates([call("a", "completed"), call("b"), ...stoppedToolCallUpdates([call("b")])])).toEqual([]);
  });
});

describe("stopsOpenToolCalls", () => {
  test("a turn-end notice and a process-gone notice do; others do not", () => {
    const notice = (meta?: Record<string, unknown>): acp.SessionUpdate =>
      ({ sessionUpdate: "notice", severity: "info", title: "x", ...(meta ? { _meta: meta } : {}) }) as acp.SessionUpdate;
    expect(stopsOpenToolCalls(notice({ [TURN_RECOVERY_META.turnEnd]: { reason: "interrupted" } }))).toBe(true);
    expect(stopsOpenToolCalls(notice({ [PROCESS_GONE_META]: true }))).toBe(true);
    expect(stopsOpenToolCalls(notice())).toBe(false);
    expect(stopsOpenToolCalls(update("a", "in_progress"))).toBe(false);
  });
});
