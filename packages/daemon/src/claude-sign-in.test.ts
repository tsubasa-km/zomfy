import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import type * as acp from "@agentclientprotocol/sdk";
import type { query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { TURN_RECOVERY_META } from "@zomfy/protocol";
import { CLAUDE_SIGNED_OUT, isClaudeSignedOut, signedOutNotice } from "./claude-executable.ts";
import { releaseFinishedTurn, runClaudeTurn, turnEffort, useQueryForTests } from "./claude-turn.ts";
import { claudeReadFailed } from "./usage-limits.ts";

// docs/specs/claude-sign-in.md and docs/specs/composer-effort.md

const EXPIRED = "Failed to authenticate: OAuth session expired and could not be refreshed";

describe("signed-out detection", () => {
  test("reads the SDK's error kind and the CLI's words", () => {
    expect(isClaudeSignedOut(EXPIRED)).toBe(true);
    expect(isClaudeSignedOut("Not logged in · Please run /login")).toBe(true);
    expect(isClaudeSignedOut("something else", "authentication_failed")).toBe(true);
    expect(isClaudeSignedOut("API Error: 500 overloaded", "server_error")).toBe(false);
  });

  test("the notice says what to do, then what Claude said", () => {
    expect(signedOutNotice(EXPIRED)).toBe(`${CLAUDE_SIGNED_OUT}\n${EXPIRED}`);
    expect(signedOutNotice("  ")).toBe(CLAUDE_SIGNED_OUT);
  });

  test("a usage read that fails signed out says so and drops stale windows", () => {
    const before = { provider: "claude" as const, plan: "max", status: "ok" as const, windows: [{ id: "session", usedPercent: 3, resetsAt: null }], updatedAt: 0 };
    const signedOut = claudeReadFailed(new Error(EXPIRED), before, 5);
    expect(signedOut).toMatchObject({ provider: "claude", plan: "max", status: "error", signedOut: true, windows: [], updatedAt: 5 });
    const other = claudeReadFailed(new Error("socket hang up"), before, 5);
    expect(other.signedOut).toBeUndefined();
    expect(other.error).toBe("socket hang up");
    expect(other.windows).toEqual(before.windows);
  });
});

test("turnEffort reads a known level from a hook's input", () => {
  expect(turnEffort({ hook_event_name: "Stop", effort: { level: "xhigh" } })).toBe("xhigh");
  expect(turnEffort({ hook_event_name: "Stop", effort: { level: "ultra" } })).toBeNull();
  expect(turnEffort({ hook_event_name: "Stop" })).toBeNull();
});

type HookFn = (input: unknown, toolUseId: string | undefined, options: { signal: AbortSignal }) => Promise<unknown>;

/** One Claude process: yields what the test queues, and keeps the options it was started with. */
function fakeClaude(script: (options: { hooks?: Record<string, { hooks: HookFn[] }[]> }) => Promise<SDKMessage[]>) {
  let ended = false;
  const fake = ((params: Parameters<typeof query>[0]) => {
    const prompt = params.prompt as AsyncIterable<SDKUserMessage>;
    const options = params.options as unknown as { hooks?: Record<string, { hooks: HookFn[] }[]> };
    let close!: () => void;
    const closed = new Promise<void>((resolve) => (close = resolve));
    void (async () => {
      for await (const _ of prompt) void _;
      ended = true;
      close();
    })();
    params.options?.abortController?.signal.addEventListener("abort", () => close());
    async function* messages(): AsyncGenerator<SDKMessage> {
      yield* await script(options);
      if (!ended) await closed;
    }
    return Object.assign(messages(), {
      setPermissionMode: async () => undefined,
      getContextUsage: async () => {
        throw new Error("not in the fake");
      },
    });
  }) as unknown as typeof query;
  return fake;
}

const sdk = (message: Record<string, unknown>): SDKMessage => message as unknown as SDKMessage;
const init = sdk({ type: "system", subtype: "init", session_id: "claude-1", slash_commands: [], permissionMode: "default" });
const errorResult = (text: string) =>
  sdk({ type: "result", subtype: "success", result: text, is_error: true, usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0, modelUsage: {} });
const okResult = sdk({ type: "result", subtype: "success", result: "done", is_error: false, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0, modelUsage: {} });

let chat = 0;
type TurnInput = Parameters<typeof runClaudeTurn>[0];
function turn(updates: acp.SessionUpdate[], extra: Partial<TurnInput> = {}): TurnInput {
  return {
    acpSessionId: `sign-in-${++chat}`,
    state: { cwd: tmpdir(), claudeSessionId: null, options: { model: null, permissionMode: "default", effort: null } },
    prompt: [{ type: "text" as const, text: "go" }],
    messageId: crypto.randomUUID(),
    abort: new AbortController(),
    emit: async (update: acp.SessionUpdate) => void updates.push(update),
    askPermission: async (): Promise<acp.RequestPermissionResponse> => ({ outcome: { outcome: "cancelled" } }),
    ...extra,
  };
}

afterEach(() => useQueryForTests(null));

describe("a Claude turn", () => {
  test("that fails signed out ends with the sign-in turn end", async () => {
    useQueryForTests(
      fakeClaude(async () => [
        init,
        sdk({ type: "assistant", parent_tool_use_id: null, error: "authentication_failed", message: { content: [{ type: "text", text: EXPIRED }], usage: { input_tokens: 0, output_tokens: 0 } } }),
        errorResult(EXPIRED),
      ]),
    );
    const updates: acp.SessionUpdate[] = [];
    const ends: unknown[] = [];
    const input = turn(updates, { onTurnEnd: (end) => ends.push(end) });
    await runClaudeTurn(input);
    await releaseFinishedTurn(input.acpSessionId);
    const notice = updates.find((u) => u.sessionUpdate === "notice") as { title?: string; _meta?: Record<string, unknown> } | undefined;
    expect(notice?.title).toBe(`${CLAUDE_SIGNED_OUT}\n${EXPIRED}`);
    expect(notice?._meta?.[TURN_RECOVERY_META.turnEnd]).toEqual({ reason: "error", signIn: "claude" });
    expect(ends).toEqual([{ reason: "error", signIn: "claude" }]);
  });

  test("that fails otherwise ends as a plain error", async () => {
    useQueryForTests(fakeClaude(async () => [init, errorResult("API Error: 500 Internal server error")]));
    const updates: acp.SessionUpdate[] = [];
    const input = turn(updates);
    await runClaudeTurn(input);
    await releaseFinishedTurn(input.acpSessionId);
    const notice = updates.find((u) => u.sessionUpdate === "notice") as { _meta?: Record<string, unknown> } | undefined;
    expect(notice?._meta?.[TURN_RECOVERY_META.turnEnd]).toEqual({ reason: "error" });
  });

  test("with no effort picked reports the level its Stop hook saw", async () => {
    useQueryForTests(
      fakeClaude(async (options) => {
        const stop = options.hooks?.Stop?.[0]?.hooks[0];
        await stop?.({ hook_event_name: "Stop", effort: { level: "high" } }, undefined, { signal: new AbortController().signal });
        return [init, okResult];
      }),
    );
    const found: unknown[] = [];
    const input = turn([], { onDefaultEffort: (f) => found.push(f) });
    await runClaudeTurn(input);
    await releaseFinishedTurn(input.acpSessionId);
    expect(found).toEqual([{ model: null, effort: "high" }]);
  });

  test("with an effort picked reports no default", async () => {
    useQueryForTests(
      fakeClaude(async (options) => {
        await options.hooks?.Stop?.[0]?.hooks[0]?.({ hook_event_name: "Stop", effort: { level: "low" } }, undefined, { signal: new AbortController().signal });
        return [init, okResult];
      }),
    );
    const found: unknown[] = [];
    const input = turn([], { onDefaultEffort: (f) => found.push(f) });
    input.state.options = { model: "opus", permissionMode: "default", effort: "low" };
    await runClaudeTurn(input);
    await releaseFinishedTurn(input.acpSessionId);
    expect(found).toEqual([]);
  });
});
