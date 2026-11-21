import { afterEach, beforeEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@zomfy/protocol";
import { git } from "./git-cli.ts";
import type { SessionRecord } from "./session-registry.ts";
import { SplitCoordinator, type SplitCoordinatorDeps } from "./split-coordinator.ts";
import { SplitStore } from "./split-store.ts";

// Real git on Windows takes seconds; bun 1.4 resets the preload's default for each file.
setDefaultTimeout(30_000);

// The coordinator against real git worktrees, with chats and turns faked: who may split, one split
// per folder, holding the folder while merging, the report turn, stops, restarts and tidying up.

let root: string;
let repo: string;
let chatPath: string;
let workspaces: Map<string, Workspace>;
let records: Map<string, SessionRecord>;
let pending: Map<string, AbortController>;
let notices: string[];
let turns: { sessionId: string; text: string }[];
let turnReply: string;
let helperWork: (part: string, cwd: string, signal: AbortSignal) => Promise<string>;
let storePath: string;
let n: number;
let helperDone: boolean | undefined;
let agrees: boolean;
let leavingChats: Set<string>;
let asked: Record<string, unknown>[];

/** Every coordinator a test makes, so afterEach can wait for its splits before deleting their folders. */
let made: SplitCoordinator[] = [];
class Tracked extends SplitCoordinator {
  constructor(d: SplitCoordinatorDeps) {
    super(d);
    made.push(this);
  }
}

const project = (): Project => ({ id: "p", name: "repo", path: repo, kind: "git" });

function chat(fields: Partial<SessionRecord> & { id: string; workspaceId: string }): SessionRecord {
  const record = { title: "", status: "idle", createdAt: 0, turnStartedAt: null, claudeSessionId: null, cwd: "", options: { model: null, effort: null, permissionMode: "default" }, ...fields } as SessionRecord;
  records.set(record.id, record);
  return record;
}

async function commit(cwd: string, file: string, text: string): Promise<void> {
  await writeFile(join(cwd, file), text);
  await git(cwd, ["add", file]);
  await git(cwd, ["commit", "-m", `edit ${file}`]);
}

function deps(extra: Partial<SplitCoordinatorDeps> = {}): SplitCoordinatorDeps {
  return {
    sessions: {
      get: (id) => records.get(id),
      all: () => [...records.values()],
      create: (fields) => chat({ ...fields, id: `helper-${++n}`, workspaceId: fields.workspaceId! }),
      update: (id, patch) => void Object.assign(records.get(id)!, patch),
      transcript: async () => [],
      removeWorkspace: async (workspaceId) => {
        for (const [id, r] of records) if (r.workspaceId === workspaceId) records.delete(id);
      },
    },
    workspaces: {
      requireWorkspace: (id) => {
        const workspace = workspaces.get(id);
        if (!workspace) throw new Error(`Unknown workspace ${id}`);
        return { workspace, project: project() };
      },
      isScratch: () => false,
      createWorkspace: async (p) => {
        const path = join(root, p.name);
        await git(repo, ["worktree", "add", "-b", `me/${p.name}`, path, p.baseRef!]);
        const workspace: Workspace = { id: p.name, projectId: "p", name: p.name, path, branch: `me/${p.name}`, isPrimary: false, createdAt: 0 };
        workspaces.set(workspace.id, workspace);
        return workspace;
      },
      removeWorkspace: async (p) => {
        await git(repo, ["worktree", "remove", workspaces.get(p.workspaceId)!.path]);
        workspaces.delete(p.workspaceId);
      },
    },
    pendingTurns: pending,
    isStepTurn: () => false,
    leaving: (id) => leavingChats.has(id),
    autoApprove: new Set(),
    cliHasConversation: () => false,
    notice: (_id, title) => void notices.push(title),
    confirm: async (_id, input) => {
      asked.push(input);
      return agrees;
    },
    // Like a real turn: it starts with whatever the chat had saved for it, and a turn that ran takes it.
    startTurn: async (sessionId, text) => {
      const record = records.get(sessionId)!;
      turns.push({ sessionId, text: [record.seedContext, text].filter(Boolean).join("\n\n") });
      if (turnReply === "end_turn") record.seedContext = null;
      return turnReply;
    },
    runHelperTurn: async (sessionId) => {
      const abort = new AbortController();
      pending.set(sessionId, abort);
      try {
        const record = records.get(sessionId)!;
        const text = await helperWork(record.title, record.cwd, abort.signal);
        return { text, stopReason: abort.signal.aborted ? "cancelled" : "end_turn", ...(helperDone === undefined ? {} : { done: helperDone }) };
      } finally {
        pending.delete(sessionId);
      }
    },
    releaseFinishedTurn: async () => undefined,
    closeTerminals: () => undefined,
    runSetupHook: async () => null,
    runArchiveHook: async () => undefined,
    store: new SplitStore(storePath),
    pollMs: 10,
    ...extra,
  };
}

const parts = {
  parts: [
    { title: "Greeting", task: "Write hello.txt", owns: ["hello.txt"] },
    { title: "Farewell", task: "Write bye.txt", owns: ["bye.txt"] },
  ],
};
const file = (title: string) => (title === "Greeting" ? "hello.txt" : "bye.txt");

/** Waits until the report turn has started (or the time is up). */
async function reported(): Promise<string> {
  for (let i = 0; i < 400 && turns.length === 0; i++) await Bun.sleep(10);
  return turns[0]?.text ?? "";
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "split-coord-"));
  repo = join(root, "repo");
  chatPath = join(root, "chat");
  storePath = join(root, "splits.json");
  n = 0;
  workspaces = new Map();
  records = new Map();
  pending = new Map();
  notices = [];
  turns = [];
  turnReply = "end_turn";
  // Helpers that finish say so, as a Claude helper does in its structured result.
  helperDone = true;
  agrees = true;
  leavingChats = new Set();
  asked = [];
  helperWork = async (title, cwd) => {
    await commit(cwd, file(title), `${title}\n`);
    return `did ${title}`;
  };
  await git(root, ["init", "-b", "main", repo]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) await git(repo, ["config", k!, v!]);
  await commit(repo, "a.txt", "one\n");
  await git(repo, ["worktree", "add", "-b", "me/chat", chatPath]);
  workspaces.set("main", { id: "main", projectId: "p", name: "repo", path: repo, branch: "main", isPrimary: true, createdAt: 0 });
  workspaces.set("chat", { id: "chat", projectId: "p", name: "chat", path: chatPath, branch: "me/chat", isPrimary: false, createdAt: 0 });
  chat({ id: "c1", workspaceId: "chat", cwd: chatPath });
}, 30_000);

afterEach(async () => {
  // On Windows a folder git still works in cannot be removed: let every split finish first.
  await Promise.all(made.map((m) => m.settled()));
  made = [];
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe("SplitCoordinator", () => {
  test("is offered to a chat in a worktree, not the main checkout, a side chat or a manager", () => {
    const splits = new Tracked(deps());
    chat({ id: "primary", workspaceId: "main" });
    chat({ id: "side", workspaceId: "chat", sideOf: "c1" });
    chat({ id: "mgr", workspaceId: "chat", role: "manager" });
    expect(["c1", "primary", "side", "mgr"].map((id) => splits.offered(id))).toEqual([true, false, false, false]);
  });

  test("returns at once, merges the parts, deletes their branches and reports in the chat's next turn", async () => {
    const splits = new Tracked(deps());
    const started = await splits.call("c1", parts);
    expect(started.isError).toBeUndefined();
    expect(started.result).toContain("Started 2 parts");
    const report = await reported();
    expect(report).toContain("2 merged");
    expect(await readFile(join(chatPath, "hello.txt"), "utf8")).toBe("Greeting\n");
    // Merged into the chat's branch, so deleted from there; nothing is left behind.
    expect((await git(repo, ["branch", "--list", "me/chat-*"])).trim()).toBe("");
    expect([...workspaces.keys()].sort()).toEqual(["chat", "main"]);
    // Helpers are known as helpers, and may not split in turn.
    expect(splits.offered("helper-1")).toBe(false);
    expect(splits.isHelper("helper-1")).toBe(true);
  });

  test("two calls at once start one split", async () => {
    const splits = new Tracked(deps());
    const results = await Promise.all([splits.call("c1", parts), splits.call("c1", parts)]);
    expect(results.filter((r) => !r.isError)).toHaveLength(1);
    expect(results.find((r) => r.isError)?.result).toContain("still running");
    await reported();
  });

  test("refuses in plan mode and while another chat works in the folder", async () => {
    const splits = new Tracked(deps());
    records.get("c1")!.options.permissionMode = "plan";
    expect((await splits.call("c1", parts)).result).toContain("plan mode");
    records.get("c1")!.options.permissionMode = "default";
    chat({ id: "other", workspaceId: "chat" });
    pending.set("other", new AbortController());
    expect((await splits.call("c1", parts)).result).toContain("Another chat is working in this folder");
  });

  test("merges nothing while any chat in the folder has a turn running", async () => {
    const splits = new Tracked(deps());
    // The turn that called split_work is still running.
    pending.set("c1", new AbortController());
    await splits.call("c1", parts);
    await Bun.sleep(400);
    expect(await git(chatPath, ["log", "--format=%s"])).not.toContain("split_work");
    expect(splits.busy("c1")).toContain("still running");
    pending.delete("c1");
    expect(await reported()).toContain("2 merged");
    expect(splits.busy("c1")).toBeNull();
  });

  test("a stop reaches a helper whose turn had not registered yet", async () => {
    let aborted = 0;
    const splits = new Tracked(
      deps({
        // The helper exists, but its turn registers itself only a moment later.
        runHelperTurn: async (sessionId) => {
          await Bun.sleep(150);
          const abort = new AbortController();
          pending.set(sessionId, abort);
          for (let i = 0; i < 300 && !abort.signal.aborted; i++) await Bun.sleep(10);
          pending.delete(sessionId);
          if (abort.signal.aborted) aborted++;
          return { text: "", stopReason: abort.signal.aborted ? "cancelled" : "end_turn" };
        },
      }),
    );
    await splits.call("c1", parts);
    for (let i = 0; i < 200 && !(records.has("helper-2") && !pending.has("helper-2")); i++) await Bun.sleep(5);
    expect(records.has("helper-2") && !pending.has("helper-2")).toBe(true);
    expect((await splits.manage("c1", { action: "stop" })).result).toContain("Stopping");
    const report = await reported();
    expect(aborted).toBe(2);
    expect(report).toContain("0 merged");
    expect(report).toContain("stopped, not merged");
  });

  test("a report whose turn did not run stays saved, whole, for the chat's next turn", async () => {
    turnReply = "not-sent";
    const splits = new Tracked(deps());
    await splits.call("c1", parts);
    await reported();
    await splits.settled();
    expect(records.get("c1")!.seedContext).toContain("2 merged");
    expect(records.get("c1")!.seedContext).toContain("## 2. Farewell");
  });

  test("a report saved before a restart gets its turn after it", async () => {
    records.get("c1")!.seedContext = "[split_work] Every part you split off has finished. Report:\n\nSplit into 2 parts; 2 merged.";
    const splits = new Tracked(deps());
    await splits.recover();
    expect(await reported()).toContain("2 merged");
  });

  test("is not offered to agents that cannot say whether a part is done", () => {
    const splits = new Tracked(deps());
    chat({ id: "codex", workspaceId: "chat", agent: "codex" });
    expect(splits.offered("codex")).toBe(false);
  });

  test("tidies away a kept part once the chat has brought its work in", async () => {
    // Both parts touch a.txt; the second does not own it.
    helperWork = async (title, cwd) => {
      await commit(cwd, "a.txt", `${title}\n`);
      return "";
    };
    const splits = new Tracked(deps());
    await splits.call("c1", { parts: [{ title: "Greeting", task: "x", owns: ["a.txt"] }, { title: "Farewell", task: "y", owns: ["b.txt"] }] });
    // The second part reaches into a.txt, which it does not own: kept, not merged.
    expect(await reported()).toContain("Farewell: failed, not merged");
    expect((await splits.manage("c1", { action: "tidy" })).result).toContain("not in your branch yet");
    // The chat brings it in by hand, as the report says.
    await git(chatPath, ["merge", "me/chat-farewell"]).catch(() => undefined);
    await writeFile(join(chatPath, "a.txt"), "both\n");
    await git(chatPath, ["add", "a.txt"]);
    await git(chatPath, ["commit", "--no-edit"]);
    expect((await splits.manage("c1", { action: "tidy" })).result).toContain("Removed me/chat-farewell");
    expect(workspaces.has("chat-farewell")).toBe(false);
  });

  test("after a restart, aborts a merge that was under way and tells the chat", async () => {
    await commit(chatPath, "a.txt", "chat\n");
    await git(repo, ["branch", "other", "main"]);
    await git(repo, ["worktree", "add", join(root, "other"), "other"]);
    await commit(join(root, "other"), "a.txt", "other\n");
    await git(chatPath, ["merge", "other"]).catch(() => undefined);
    await writeFile(
      storePath,
      // The merge under way is of one of the split's parts ("other"), so recovery may abort it.
      JSON.stringify({
        running: [
          {
            sessionId: "c1",
            parentPath: chatPath,
            titles: ["A", "B"],
            startedAt: 0,
            merging: true,
            worktrees: [{ workspaceId: "other", name: "other", branch: "other", path: join(root, "other") }],
          },
        ],
        kept: [],
        helpers: ["h9"],
      }),
    );
    const splits = new Tracked(deps());
    await splits.recover();
    expect((await git(chatPath, ["status", "--porcelain"])).trim()).toBe("");
    // The chat hears it in a turn of its own, as it would a report.
    expect(await reported()).toContain("that merge was aborted");
    expect(notices).toContain("Parts split off were cut short by a restart");
    expect(splits.isHelper("h9")).toBe(true);
  });
});

describe("SplitCoordinator, after the split", () => {
  test("the report turn is not told the parts are still running", async () => {
    let seedAtReport: string | null | undefined = "unset";
    const splits = new Tracked(
      deps({
        startTurn: async (sessionId, text) => {
          seedAtReport = records.get(sessionId)!.seedContext;
          turns.push({ sessionId, text });
          return "end_turn";
        },
      }),
    );
    await splits.call("c1", parts);
    // While the parts run, every turn of the chat hears about them; nothing is stored for later.
    expect(splits.turnNote("c1")).toContain("still running");
    expect(records.get("c1")!.seedContext ?? "").not.toContain("still running");
    await reported();
    expect(seedAtReport ?? "").not.toContain("still running");
    expect(splits.turnNote("c1")).toBeNull();
  });

  test("a chat that finished its worktree can still tidy its kept parts", async () => {
    helperWork = async (title, cwd) => {
      await commit(cwd, "a.txt", `${title}\n`);
      return "";
    };
    const splits = new Tracked(deps());
    await splits.call("c1", { parts: [{ title: "Greeting", task: "x", owns: ["a.txt"] }, { title: "Farewell", task: "y", owns: ["b.txt"] }] });
    await reported();
    // finish_worktree moved the chat to the main checkout, where split_work is not offered.
    records.get("c1")!.workspaceId = "main";
    expect(splits.offered("c1")).toBe(false);
    expect(splits.manageOffered("c1")).toBe(true);
    expect((await splits.manage("c1", { action: "tidy" })).result).toContain("not in your branch yet");
  });

  test("a deleted chat leaves no kept parts behind in the store", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    helperWork = async () => {
      await gate;
      return "";
    };
    const splits = new Tracked(deps());
    await splits.call("c1", parts);
    for (let i = 0; i < 200 && !records.has("helper-2"); i++) await Bun.sleep(5);
    records.delete("c1");
    splits.forget("c1");
    release();
    await splits.settled();
    expect(splits.keptParts("c1")).toBe(0);
  });
});

describe("SplitCoordinator, what counts as done", () => {
  test("a part whose helper says it is not done is kept, not merged", async () => {
    helperDone = false;
    const splits = new Tracked(deps());
    await splits.call("c1", parts);
    const report = await reported();
    expect(report).toContain("0 merged");
    expect(report).toContain("its helper said the part is not done");
  });
});

describe("SplitCoordinator, what is merged and when", () => {
  test("a helper that does not say whether it is done is kept, not merged", async () => {
    helperDone = undefined;
    const splits = new Tracked(deps());
    await splits.call("c1", parts);
    expect(await reported()).toContain("did not say whether the part is done");
  });

  test("asks the chat to commit its own changes before merging into its folder", async () => {
    let asked = 0;
    const splits = new Tracked(
      deps({
        startTurn: async (sessionId, text) => {
          if (text.includes("uncommitted changes")) {
            asked++;
            // The chat does as asked.
            await git(chatPath, ["commit", "-am", "the chat's own work"]);
            return "end_turn";
          }
          turns.push({ sessionId, text: [records.get(sessionId)!.seedContext, text].filter(Boolean).join("\n\n") });
          records.get(sessionId)!.seedContext = null;
          return "end_turn";
        },
      }),
    );
    await splits.call("c1", parts);
    // While the parts run, the chat leaves a change uncommitted.
    await writeFile(join(chatPath, "a.txt"), "the chat's edit\n");
    expect(await reported()).toContain("2 merged");
    expect(asked).toBe(1);
  });

  test("a turn waiting on the merge reads the report, not that parts are still running", async () => {
    let held: Promise<void> | undefined;
    const splits = new Tracked(
      deps({
        notice: (_id, title) => {
          notices.push(title);
          if (title.startsWith("Merging")) held = splits.hold("chat");
        },
      }),
    );
    await splits.call("c1", parts);
    for (let i = 0; i < 400 && !held; i++) await Bun.sleep(10);
    expect(held).toBeDefined();
    await held;
    // Released only once the report is saved and the split is over.
    expect(splits.turnNote("c1")).toBeNull();
    expect(records.get("c1")!.seedContext ?? turns[0]?.text ?? "").toContain("2 merged");
  });
});

describe("SplitCoordinator, a merge the person started", () => {
  test("is left alone after a restart", async () => {
    await commit(chatPath, "a.txt", "chat\n");
    await git(repo, ["branch", "mine", "main"]);
    await git(repo, ["worktree", "add", join(root, "mine"), "mine"]);
    await commit(join(root, "mine"), "a.txt", "mine\n");
    await git(chatPath, ["merge", "mine"]).catch(() => undefined);
    await writeFile(
      storePath,
      JSON.stringify({
        running: [{ sessionId: "c1", parentPath: chatPath, titles: ["A"], startedAt: 0, merging: true, worktrees: [] }],
        kept: [],
        helpers: [],
      }),
    );
    await new Tracked(deps()).recover();
    expect((await git(chatPath, ["status", "--porcelain"])).trim()).toContain("a.txt");
  });
});

describe("SplitCoordinator, the person's say", () => {
  test("asks once, with the plan, and starts nothing when the person says no", async () => {
    agrees = false;
    const splits = new Tracked(deps());
    const result = await splits.call("c1", parts);
    expect(result.isError).toBe(true);
    expect(result.result).toContain("did not want this split");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(parts);
    expect(splits.running("c1")).toBe(false);
    expect([...workspaces.keys()].sort()).toEqual(["chat", "main"]);
  });

  test("is not asked about a split that cannot run", async () => {
    await writeFile(join(chatPath, "a.txt"), "uncommitted\n");
    const splits = new Tracked(deps());
    expect((await splits.call("c1", parts)).result).toContain("uncommitted changes");
    expect(asked).toHaveLength(0);
  });

  test("says where each part is", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    helperWork = async (title, cwd) => {
      if (title === "Farewell") await gate;
      await commit(cwd, file(title), `${title}\n`);
      return "";
    };
    const splits = new Tracked(deps());
    await splits.call("c1", parts);
    for (let i = 0; i < 300 && !(await splits.manage("c1", { action: "status" })).result.includes("Greeting: finished"); i++) await Bun.sleep(10);
    const status = (await splits.manage("c1", { action: "status" })).result;
    expect(status).toContain("- Greeting: finished, waiting to be merged");
    expect(status).toContain("- Farewell: working");
    release();
    await reported();
  });
});

describe("SplitCoordinator, a chat about to move", () => {
  test("does not split while a move or finish waits for its turn to end", async () => {
    leavingChats.add("c1");
    const splits = new Tracked(deps());
    expect((await splits.call("c1", parts)).result).toContain("moves to another folder");
    expect(asked).toHaveLength(0);
  });

  test("a late yes, after the turn that asked was stopped, starts nothing", async () => {
    const turn = new AbortController();
    pending.set("c1", turn);
    const splits = new Tracked(
      deps({
        confirm: async () => {
          turn.abort();
          await Bun.sleep(50);
          return true;
        },
      }),
    );
    expect((await splits.call("c1", parts)).result).toContain("did not want this split");
    expect(splits.running("c1")).toBe(false);
  });
});
