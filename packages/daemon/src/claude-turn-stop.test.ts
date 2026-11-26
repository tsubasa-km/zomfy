import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import type * as acp from "@agentclientprotocol/sdk";
import type { query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { releaseFinishedTurn, runClaudeTurn, useQueryForTests } from "./claude-turn.ts";

/**
 * Claude processes the test drives. `exitDelayMs` is how long a killed one takes to end its message
 * stream, as a real CLI ending its tools (or a slow Windows process exit) does.
 */
class FakeClaude {
  starts = 0;
  /** When each process started and when its stream ended, in order. */
  events: string[] = [];
  sent: SDKUserMessage[] = [];
  exitDelayMs = 0;
  /** A control request the process never answers (busy with its tasks). */
  stuckControl = false;
  private current: { push: (m: SDKMessage) => void } | null = null;

  readonly query = ((params: Parameters<typeof query>[0]) => {
    const n = ++this.starts;
    this.events.push(`start ${n}`);
    const prompt = params.prompt as AsyncIterable<SDKUserMessage>;
    const queue: SDKMessage[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      wake?.();
    };
    // Killed or with its input closed, it exits only after `exitDelayMs`.
    const exit = (): void => {
      if (this.exitDelayMs > 0) setTimeout(end, this.exitDelayMs);
      else end();
    };
    params.options?.abortController?.signal.addEventListener("abort", exit);
    void (async () => {
      for await (const message of prompt) this.sent.push(message);
      exit();
    })();
    this.current = {
      push: (m) => {
        queue.push(m);
        wake?.();
      },
    };
    const self = this;
    async function* messages(): AsyncGenerator<SDKMessage> {
      for (;;) {
        while (queue.length > 0) yield queue.shift()!;
        if (ended) {
          self.events.push(`exit ${n}`);
          return;
        }
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
    }
    return Object.assign(messages(), {
      setPermissionMode: () => (this.stuckControl ? new Promise<void>(() => undefined) : Promise.resolve()),
      getContextUsage: async () => {
        throw new Error("not in the fake");
      },
    });
  }) as unknown as typeof query;

  emit(...messages: SDKMessage[]): void {
    for (const m of messages) this.current?.push(m);
  }
}

const sdk = (message: Record<string, unknown>): SDKMessage => message as unknown as SDKMessage;
const init = () => sdk({ type: "system", subtype: "init", session_id: "claude-1", slash_commands: [], permissionMode: "default" });
const said = (text: string) =>
  sdk({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
const tasks = (...descriptions: string[]) =>
  sdk({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: descriptions.map((description, i) => ({ task_id: `t${i}`, task_type: "local_bash", description })),
  });
const result = (text: string, promptId: string) =>
  sdk({
    type: "result",
    subtype: "success",
    result: text,
    user_message_uuid: promptId,
    user_message_uuids: [promptId],
    is_error: false,
    usage: { input_tokens: 1, output_tokens: 1 },
    total_cost_usd: 0,
    modelUsage: {},
  });

const until = async (condition: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** Resolves with the turn's stop reason, or "still running" after `ms`. */
const within = <T>(promise: Promise<T>, ms: number): Promise<T | "still running"> =>
  Promise.race([promise, new Promise<"still running">((resolve) => setTimeout(() => resolve("still running"), ms))]);

let chat = 0;
type TurnInput = Parameters<typeof runClaudeTurn>[0];
function turnFor(sessionId: string, updates: acp.SessionUpdate[], extra: Partial<TurnInput> = {}): TurnInput {
  return {
    acpSessionId: sessionId,
    state: { cwd: tmpdir(), claudeSessionId: null, options: { model: null, permissionMode: "default", effort: null } },
    prompt: [{ type: "text" as const, text: "go" }],
    messageId: crypto.randomUUID(),
    abort: new AbortController(),
    emit: async (update: acp.SessionUpdate) => void updates.push(update),
    askPermission: async (): Promise<acp.RequestPermissionResponse> => ({ outcome: { outcome: "cancelled" } }),
    ...extra,
  };
}

const texts = (updates: acp.SessionUpdate[]): string[] =>
  updates.flatMap((u) => (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? [u.content.text] : []));

describe("Stop", () => {
  afterEach(() => useQueryForTests(null));

  test("ends the turn at once, though the stopped process takes a while to exit", async () => {
    const claude = new FakeClaude();
    claude.exitDelayMs = 1500;
    useQueryForTests(claude.query);
    const sessionId = `stop-${++chat}`;
    const updates: acp.SessionUpdate[] = [];
    const input = turnFor(sessionId, updates);
    const done = runClaudeTurn(input);
    await until(() => claude.sent.length === 1);
    claude.emit(init(), said("working on it"));
    await until(() => texts(updates).length === 1);
    input.abort.abort();
    expect(await within(done, 200)).toBe("cancelled");
    // What the dying process still says is not shown after the Stop.
    claude.emit(said(" and more"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(texts(updates)).toEqual(["working on it"]);
    await releaseFinishedTurn(sessionId);
  });

  test("before the process is up starts none", async () => {
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const input = turnFor(`stop-${++chat}`, []);
    input.abort.abort();
    expect(await runClaudeTurn(input)).toBe("cancelled");
    expect(claude.starts).toBe(0);
  });

  test("the next turn waits for the stopped process to exit before starting its own", async () => {
    const claude = new FakeClaude();
    claude.exitDelayMs = 150;
    useQueryForTests(claude.query);
    const sessionId = `stop-${++chat}`;
    const updates: acp.SessionUpdate[] = [];
    const first = turnFor(sessionId, updates);
    const stopped = runClaudeTurn(first);
    await until(() => claude.sent.length === 1);
    claude.emit(init());
    first.abort.abort();
    expect(await stopped).toBe("cancelled");
    const second = turnFor(sessionId, updates, { state: { ...first.state, claudeSessionId: "claude-1" } });
    const next = runClaudeTurn(second);
    await until(() => claude.sent.length === 2);
    expect(claude.events).toEqual(["start 1", "exit 1", "start 2"]);
    claude.emit(init(), result("answered", second.messageId));
    expect(await next).toBe("end_turn");
    expect(texts(updates)).toEqual(["answered"]);
    await releaseFinishedTurn(sessionId);
  });

  test("reaches a turn joining a kept process that does not answer, and spares its tasks", async () => {
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const sessionId = `stop-${++chat}`;
    const updates: acp.SessionUpdate[] = [];
    const first = turnFor(sessionId, updates);
    const done = runClaudeTurn(first);
    await until(() => claude.sent.length === 1);
    claude.emit(init(), tasks("Build"), result("started the build", first.messageId));
    expect(await done).toBe("end_turn");

    claude.stuckControl = true;
    const second = turnFor(sessionId, updates, { state: { ...first.state, claudeSessionId: "claude-1" } });
    const joined = runClaudeTurn(second);
    await new Promise((resolve) => setTimeout(resolve, 30));
    second.abort.abort();
    expect(await within(joined, 200)).toBe("cancelled");
    // The prompt never went in, and the process (with its build) is still there.
    expect(claude.sent.length).toBe(1);
    expect(claude.events).toEqual(["start 1"]);
    await releaseFinishedTurn(sessionId);
  });
});
