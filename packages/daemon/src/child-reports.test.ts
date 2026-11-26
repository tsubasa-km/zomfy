import { beforeEach, describe, expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import type { PromptOrigin, SessionInfo, SessionStatus } from "@zomfy/protocol";
import { ChildReports, REPORT_HEADING } from "./child-reports.ts";
import type { SessionRecord } from "./session-registry.ts";

// The launcher hears from the chats it prompted, with chats and turns faked: one batched turn for
// several children, a busy launcher told after its turn, wait_for_session taking a child out of the
// report, a child that needs the person reported once, an archived launcher, and no loops.

let records: Map<string, SessionRecord>;
let transcripts: Map<string, acp.SessionUpdate[]>;
let listeners: Set<(list: SessionInfo[]) => void>;
let busy: Set<string>;
let turns: { sessionId: string; text: string; origin: PromptOrigin }[];
let asks: Map<string, string[]>;
let reports: ChildReports;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function changed(): void {
  const list = [...records.values()] as SessionInfo[];
  for (const listener of listeners) listener(list);
}

function chat(id: string, fields: Partial<SessionRecord> = {}): SessionRecord {
  const record = { id, title: id, status: "idle", createdAt: 0, turnStartedAt: null, claudeSessionId: null, cwd: "", workspaceId: "w", options: { model: null, effort: null, permissionMode: "default" }, ...fields } as SessionRecord;
  records.set(id, record);
  changed();
  return record;
}

function status(id: string, next: SessionStatus): void {
  records.get(id)!.status = next;
  changed();
}

/** A child's turn as the daemon runs it: working, a reply, then its end status. */
function turn(id: string, reply: string): void {
  reports.turnStarted(id);
  status(id, "working");
  transcripts.set(id, [
    { sessionUpdate: "user_message_chunk", content: { type: "text", text: "do it" } } as acp.SessionUpdate,
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reply } } as acp.SessionUpdate,
  ]);
}

beforeEach(() => {
  records = new Map();
  transcripts = new Map();
  listeners = new Set();
  busy = new Set();
  turns = [];
  asks = new Map();
  reports = new ChildReports({
    sessions: {
      get: (id) => records.get(id),
      update: (id, patch) => {
        Object.assign(records.get(id)!, patch);
        changed();
      },
      transcript: async (id) => transcripts.get(id) ?? [],
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    busy: (id) => busy.has(id),
    blocked: () => false,
    startTurn: async (sessionId, text, origin) => {
      if (busy.has(sessionId)) return "not-sent";
      turns.push({ sessionId, text, origin });
      return "end_turn";
    },
    waitingOn: (id) => asks.get(id) ?? [],
    log: () => undefined,
    batchMs: 20,
    maxBatchMs: 200,
    inFlightMs: 150,
    afterTurnMs: 5,
    pollMs: 5,
  });
  chat("lead");
  chat("a", { parentId: "lead" });
  chat("b", { parentId: "lead" });
});

describe("reports to the launcher", () => {
  test("two children that stop give the lead one batched turn", async () => {
    reports.launched("lead", "a");
    reports.launched("lead", "b");
    turn("a", "A is done");
    turn("b", "B is done");
    status("a", "idle");
    await sleep(60);
    // B still works: A's report waits for it.
    expect(turns).toHaveLength(0);
    status("b", "idle");
    await sleep(60);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.sessionId).toBe("lead");
    expect(turns[0]!.origin).toEqual({ kind: "harness-note", title: "Helpers reported: 2 chats stopped" });
    expect(turns[0]!.text).toContain(REPORT_HEADING);
    expect(turns[0]!.text).toContain('"a" (sessionId a) finished.');
    expect(turns[0]!.text).toContain("> A is done");
    expect(turns[0]!.text).toContain("> B is done");
  });

  test("one child's report names it", async () => {
    reports.launched("lead", "a");
    turn("a", "done");
    status("a", "idle");
    await sleep(60);
    expect(turns.map((t) => t.origin)).toEqual([{ kind: "harness-note", title: "Helper finished: a" }]);
  });

  test("a busy lead gets the report once its turn ends", async () => {
    reports.launched("lead", "a");
    turn("a", "done");
    busy.add("lead");
    status("a", "idle");
    await sleep(60);
    expect(turns).toHaveLength(0);
    busy.delete("lead");
    reports.turnEnded("lead");
    await sleep(30);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.text).toContain("> done");
  });

  test("a child wait_for_session already returned is not reported again", async () => {
    reports.launched("lead", "a");
    turn("a", "done");
    busy.add("lead");
    const waited = reports.wait("lead", ["a"], { timeoutMs: 1000, all: false, active: () => true });
    status("a", "idle");
    const result = await waited;
    expect(result.timedOut).toBe(false);
    expect(result.sessions).toEqual([{ sessionId: "a", title: "a", status: "idle", lastReply: "done" }]);
    busy.delete("lead");
    reports.turnEnded("lead");
    await sleep(60);
    expect(turns).toHaveLength(0);
  });

  test("a child that needs the person is reported once, at once", async () => {
    reports.launched("lead", "a");
    reports.launched("lead", "b");
    turn("a", "");
    turn("b", "");
    asks.set("a", ["Bash"]);
    status("a", "needs-you");
    await sleep(60);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.origin).toEqual({ kind: "harness-note", title: "Helper needs the person: a" });
    expect(turns[0]!.text).toContain("needs the person: waiting on Bash");
    expect(turns[0]!.text).toContain("1 other chat you started is still working");
    await sleep(60);
    expect(turns).toHaveLength(1);
    // Answered, it works on and finishes: that is news of its own, sent with B's.
    asks.delete("a");
    status("a", "working");
    status("a", "idle");
    status("b", "idle");
    await sleep(60);
    expect(turns).toHaveLength(2);
    expect(turns[1]!.origin).toEqual({ kind: "harness-note", title: "Helpers reported: 2 chats stopped" });
  });

  test("an archived lead gets the report as context, and no turn", async () => {
    records.get("lead")!.archived = true;
    reports.launched("lead", "a");
    turn("a", "done");
    status("a", "idle");
    await sleep(60);
    expect(turns).toHaveLength(0);
    expect(records.get("lead")!.seedContext).toContain(REPORT_HEADING);
  });

  test("a closed lead gets nothing", async () => {
    reports.launched("lead", "a");
    turn("a", "done");
    records.delete("lead");
    changed();
    status("a", "idle");
    await sleep(60);
    expect(turns).toHaveLength(0);
  });

  test("a turn the person starts in the child is not reported", async () => {
    reports.launched("lead", "a");
    turn("a", "first");
    status("a", "idle");
    await sleep(60);
    expect(turns).toHaveLength(1);
    turn("a", "second");
    status("a", "idle");
    await sleep(60);
    expect(turns).toHaveLength(1);
  });

  test("a child prompting its launcher sets up no report back", async () => {
    reports.launched("lead", "a");
    reports.launched("a", "lead");
    turn("lead", "lead's answer");
    status("lead", "idle");
    await sleep(60);
    expect(turns).toHaveLength(0);
    // Nor toward its parent, whoever launched it.
    reports.launched("b", "lead");
    turn("lead", "again");
    status("lead", "idle");
    await sleep(60);
    expect(turns).toHaveLength(0);
  });

  test("split_work helpers and workflow chats are left to their own reports", async () => {
    chat("helper", { parentId: "lead", origin: "workflow" });
    reports.launched("lead", "helper");
    turn("helper", "done");
    status("helper", "idle");
    await sleep(60);
    expect(turns).toHaveLength(0);
  });

  test("report turns in one chat are capped; the rest wait for its next turn", async () => {
    for (let i = 0; i < 11; i++) {
      reports.launched("lead", "a");
      turn("a", `round ${i}`);
      status("a", "idle");
      await sleep(40);
    }
    expect(turns).toHaveLength(10);
    expect(records.get("lead")!.seedContext).toContain("round 10");
  });
});

describe("wait_for_session", () => {
  test("a chat just prompted reads as working until its turn starts", async () => {
    reports.launched("lead", "a");
    expect(reports.settled("a")).toBeNull();
    turn("a", "done");
    expect(reports.settled("a")).toBeNull();
    status("a", "idle");
    expect(reports.settled("a")).toBe("idle");
  });

  test("a prompt whose turn never starts stops reading as working", async () => {
    reports.launched("lead", "a");
    await sleep(170);
    expect(reports.settled("a")).toBe("idle");
  });

  test("all waits for every chat", async () => {
    turn("a", "A");
    turn("b", "B");
    const waited = reports.wait("lead", ["a", "b"], { timeoutMs: 1000, all: true, active: () => true });
    status("a", "idle");
    await sleep(30);
    status("b", "error");
    const result = await waited;
    expect(result.timedOut).toBe(false);
    expect(result.sessions.map((s) => s.status)).toEqual(["idle", "error"]);
  });

  test("times out, and ends with the caller's turn", async () => {
    turn("a", "A");
    const timedOut = await reports.wait("lead", ["a"], { timeoutMs: 30, all: false, active: () => true });
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.sessions[0]!.status).toBe("working");
    const started = Date.now();
    await reports.wait("lead", ["a"], { timeoutMs: 5000, all: false, active: () => Date.now() - started < 20 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("names what a chat that needs the person waits on, and a closed chat as gone", async () => {
    turn("a", "");
    asks.set("a", ["Edit"]);
    status("a", "needs-you");
    records.delete("b");
    changed();
    const result = await reports.wait("lead", ["a", "b"], { timeoutMs: 1000, all: true, active: () => true });
    expect(result.sessions).toEqual([
      { sessionId: "a", title: "a", status: "needs-you", waitingOn: ["Edit"] },
      { sessionId: "b", status: "gone" },
    ]);
  });
});
