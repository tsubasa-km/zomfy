import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interruptedSplitNote, SplitStore } from "./split-store.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "split-store-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SplitStore", () => {
  test("a restart hands back the running splits once, and keeps helpers and kept parts", async () => {
    const path = join(root, "splits.json");
    const before = new SplitStore(path);
    await before.start({ sessionId: "c1", parentPath: "/x", titles: ["A"], startedAt: 1, worktrees: [] });
    await before.update("c1", (s) => s.worktrees.push({ workspaceId: "w2", name: "x-a", branch: "me/x-a", path: "/x-a" }));
    await before.addHelper("h1");
    await before.keep([{ sessionId: "c1", workspaceId: "w1" }]);

    const after = new SplitStore(path);
    const { interrupted, helpers } = await after.load();
    expect(interrupted.map((s) => s.worktrees.length)).toEqual([1]);
    expect(helpers).toEqual(["h1"]);
    expect(after.isKept("w1")).toBe(true);
    // The interrupted split's worktree is now a kept part its chat can tidy.
    expect(after.keptFor("c1").map((k) => k.workspaceId).sort()).toEqual(["w1", "w2"]);
    // Handed back once: the file no longer lists it as running.
    expect(JSON.parse(await readFile(path, "utf8")).running).toEqual([]);
    expect((await new SplitStore(path).load()).interrupted).toEqual([]);
  });

  test("forgetting a chat drops what was recorded for it", async () => {
    const store = new SplitStore(join(root, "splits.json"));
    await store.keep([{ sessionId: "c1", workspaceId: "w1" }]);
    await store.forget("c1");
    expect(store.keptFor("c1")).toEqual([]);
  });
});


describe("interruptedSplitNote", () => {
  test("tells finished parts from unfinished ones", () => {
    const note = interruptedSplitNote(
      {
        sessionId: "c1",
        parentPath: "/chat",
        titles: ["A", "B"],
        startedAt: 0,
        worktrees: [
          { workspaceId: "w1", name: "chat-a", branch: "me/chat-a", path: "/a", finished: true },
          { workspaceId: "w2", name: "chat-b", branch: "me/chat-b", path: "/b" },
        ],
      },
      false,
    );
    expect(note).toContain("Finished, with their work committed on their branches: chat-a");
    expect(note).toContain("Not finished");
    expect(note).toContain("chat-b");
    expect(note).toContain("Do not merge these without checking them first.");
  });
});
