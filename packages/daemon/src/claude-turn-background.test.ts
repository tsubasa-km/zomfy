import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import type { query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  releaseFinishedTurn,
  runClaudeTurn,
  setBackgroundIdleCapForTests,
  useQueryForTests,
} from "./claude-turn.ts";
import { BackgroundTaskMarks } from "./background-task-marks.ts";

/** A Claude process the test drives: it reads the prompt stream and yields what the test emits. */
class FakeClaude {
  sent: SDKUserMessage[] = [];
  inputClosed = false;
  aborted = false;
  starts = 0;
  private queue: SDKMessage[] = [];
  private wake: (() => void) | null = null;
  private ended = false;

  readonly query = ((params: Parameters<typeof query>[0]) => {
    this.starts++;
    const prompt = params.prompt as AsyncIterable<SDKUserMessage>;
    params.options?.abortController?.signal.addEventListener("abort", () => {
      this.aborted = true;
      this.end();
    });
    void (async () => {
      for await (const message of prompt) this.sent.push(message);
      this.inputClosed = true;
      // The CLI exits once its input closes (its background tasks, if any, were killed first).
      this.end();
    })();
    const self = this;
    async function* messages(): AsyncGenerator<SDKMessage> {
      for (;;) {
        while (self.queue.length > 0) yield self.queue.shift()!;
        if (self.ended) return;
        await new Promise<void>((resolve) => (self.wake = resolve));
      }
    }
    return Object.assign(messages(), {
      setPermissionMode: async () => undefined,
      getContextUsage: async () => {
        throw new Error("not in the fake");
      },
    });
  }) as unknown as typeof query;

  emit(...messages: SDKMessage[]): void {
    this.queue.push(...messages);
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }
}

const sdk = (message: Record<string, unknown>): SDKMessage => message as unknown as SDKMessage;
const init = () => sdk({ type: "system", subtype: "init", session_id: "claude-1", slash_commands: [], permissionMode: "default" });
const result = (text: string) =>
  sdk({
    type: "result",
    subtype: "success",
    result: text,
    is_error: false,
    usage: { input_tokens: 1, output_tokens: 1 },
    total_cost_usd: 0,
    modelUsage: {},
  });
const tasks = (...descriptions: string[]) =>
  sdk({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: descriptions.map((description, i) => ({ task_id: `t${i}`, task_type: "local_bash", description })),
  });
const notification = (id: string, summary: string) =>
  sdk({ type: "system", subtype: "task_notification", task_id: id, status: "completed", output_file: `/tmp/${id}.output`, summary });
const suggestion = (text: string) => sdk({ type: "prompt_suggestion", suggestion: text });

const until = async (condition: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

let chat = 0;
type TurnInput = Parameters<typeof runClaudeTurn>[0];
function turnFor(sessionId: string, updates: acp.SessionUpdate[], extra: Partial<TurnInput> = {}): TurnInput {
  return {
    acpSessionId: sessionId,
    state: { cwd: tmpdir(), claudeSessionId: null, options: { permissionMode: "default" } as TurnInput["state"]["options"] },
    prompt: [{ type: "text" as const, text: "go" }],
    messageId: crypto.randomUUID(),
    abort: new AbortController(),
    emit: async (update: acp.SessionUpdate) => void updates.push(update),
    askPermission: async (): Promise<acp.RequestPermissionResponse> => ({ outcome: { outcome: "cancelled" } }),
    ...extra,
  };
}

const texts = (updates: acp.SessionUpdate[], kind: string): string[] =>
  updates.flatMap((u) => {
    if (u.sessionUpdate !== kind) return [];
    const content = (u as { content?: { type?: string; text?: string } }).content;
    return content?.type === "text" && typeof content.text === "string" ? [content.text] : [];
  });

describe("background tasks", () => {
  afterEach(() => {
    useQueryForTests(null);
    setBackgroundIdleCapForTests(null);
  });

  test("a turn with no background tasks lets its process go after the suggestion", async () => {
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const updates: acp.SessionUpdate[] = [];
    const done = runClaudeTurn(turnFor(`bg-${++chat}`, updates));
    await until(() => claude.sent.length === 1);
    claude.emit(init(), result("hi"));
    expect(await done).toBe("end_turn");
    claude.emit(suggestion("next"));
    await until(() => claude.inputClosed);
    expect(claude.aborted).toBe(false);
  });

  test("a finished background task wakes the chat with its notification", async () => {
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const sessionId = `bg-${++chat}`;
    const updates: acp.SessionUpdate[] = [];
    const woken: string[] = [];
    const marks: string[][] = [];
    const first = turnFor(sessionId, updates, { onWake: (n) => woken.push(n), onBackgroundTasks: (t) => marks.push(t) });
    const done = runClaudeTurn(first);
    await until(() => claude.sent.length === 1);
    claude.emit(init(), tasks("Sleep then echo"), result("I'll continue when it finishes"));
    expect(await done).toBe("end_turn");
    claude.emit(suggestion("next"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Kept up for the task.
    expect(claude.inputClosed).toBe(false);

    claude.emit(notification("t0", 'Background command "Sleep then echo" completed (exit code 0)'), tasks(), init());
    await until(() => woken.length === 1);
    expect(woken[0]).toContain("<task-notification>");
    expect(woken[0]).toContain("<status>completed</status>");
    // The CLI's turn goes on while the chat sets its turn up: held, then delivered in order.
    claude.emit(result("FINISHED"));
    const wokenUpdates: acp.SessionUpdate[] = [];
    const wokenTurn = runClaudeTurn(turnFor(sessionId, wokenUpdates, { attach: true, onWake: (n) => woken.push(n) }));
    expect(await wokenTurn).toBe("end_turn");
    expect(texts(wokenUpdates, "agent_message_chunk")).toEqual(["FINISHED"]);
    expect(claude.sent.length).toBe(1);
    expect(marks.at(0)).toEqual(["Sleep then echo"]);
    expect(marks.at(-1)).toEqual([]);
    // Nothing runs any more: the process goes as an ordinary one does.
    claude.emit(suggestion("again"));
    await until(() => claude.inputClosed);
    expect(woken.length).toBe(1);
  });

  test("a prompt while background tasks run goes to the same process", async () => {
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const sessionId = `bg-${++chat}`;
    const updates: acp.SessionUpdate[] = [];
    const first = turnFor(sessionId, updates);
    const done = runClaudeTurn(first);
    await until(() => claude.sent.length === 1);
    claude.emit(init(), tasks("Build"), result("started the build"));
    await done;
    const second = runClaudeTurn(turnFor(sessionId, updates, { state: { ...first.state, claudeSessionId: "claude-1" } }));
    await until(() => claude.sent.length === 2);
    claude.emit(result("still building"));
    expect(await second).toBe("end_turn");
    expect(claude.starts).toBe(1);
    expect(claude.inputClosed).toBe(false);
    await releaseFinishedTurn(sessionId);
  });

  test("a notification during a running turn is shown in it", async () => {
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const updates: acp.SessionUpdate[] = [];
    const done = runClaudeTurn(turnFor(`bg-${++chat}`, updates));
    await until(() => claude.sent.length === 1);
    claude.emit(init(), notification("t9", "Monitor fired"), result("ok"));
    await done;
    const shown = texts(updates, "user_message_chunk");
    expect(shown.length).toBe(1);
    expect(shown[0]).toContain("<summary>Monitor fired</summary>");
  });

  test("letting the process go stops its tasks and says so", async () => {
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const sessionId = `bg-${++chat}`;
    const updates: acp.SessionUpdate[] = [];
    const marks: string[][] = [];
    const done = runClaudeTurn(turnFor(sessionId, updates, { onBackgroundTasks: (t) => marks.push(t) }));
    await until(() => claude.sent.length === 1);
    claude.emit(init(), tasks("Build"), result("started"));
    await done;
    await releaseFinishedTurn(sessionId);
    expect(claude.aborted).toBe(true);
    expect(marks.at(-1)).toEqual([]);
    expect(updates.some((u) => u.sessionUpdate === "notice" && u.title === "The background tasks this chat was running were stopped: Build")).toBe(true);
  });

  test("an idle process is kept only up to the cap", async () => {
    setBackgroundIdleCapForTests(40);
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const updates: acp.SessionUpdate[] = [];
    const done = runClaudeTurn(turnFor(`bg-${++chat}`, updates));
    await until(() => claude.sent.length === 1);
    claude.emit(init(), tasks("Watch"), result("watching"));
    await done;
    await until(() => claude.aborted);
    await until(() => updates.some((u) => u.sessionUpdate === "notice" && u.title.startsWith("Stopped waiting for background tasks")));
  });

  test("Stop on a woken turn ends it and the process", async () => {
    const claude = new FakeClaude();
    useQueryForTests(claude.query);
    const sessionId = `bg-${++chat}`;
    const updates: acp.SessionUpdate[] = [];
    let wokenWith: string | null = null;
    const done = runClaudeTurn(turnFor(sessionId, updates, { onWake: (n) => (wokenWith = n) }));
    await until(() => claude.sent.length === 1);
    claude.emit(init(), tasks("Build"), result("started"));
    await done;
    claude.emit(notification("t0", "Build failed"), tasks(), init());
    await until(() => wokenWith !== null);
    const stop = new AbortController();
    const woken = runClaudeTurn(turnFor(sessionId, [], { attach: true, abort: stop }));
    stop.abort();
    expect(await woken).toBe("cancelled");
    expect(claude.aborted).toBe(true);
  });
});

describe("BackgroundTaskMarks", () => {
  test("marks survive a restart and are taken once", () => {
    const dir = mkdtempSync(join(tmpdir(), "bg-marks-"));
    try {
      const path = join(dir, "background-tasks.json");
      const marks = new BackgroundTaskMarks(path);
      marks.set("a", ["Build"]);
      marks.set("b", ["Watch"]);
      marks.set("b", []);
      const next = new BackgroundTaskMarks(path);
      expect(next.takeAll()).toEqual([["a", ["Build"]]]);
      expect(new BackgroundTaskMarks(path).takeAll()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
