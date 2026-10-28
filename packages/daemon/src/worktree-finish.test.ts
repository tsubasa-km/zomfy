import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@acp-harness/protocol";
import { git } from "./git-cli.ts";
import { finishWorktree, type FinishDeps } from "./worktree-finish.ts";

let root: string;
let main: string;
let tree: string;

const project = (finishWith?: Project["finishWith"]): Project => ({ id: "p", name: "repo", path: main, kind: "git", ...(finishWith ? { finishWith } : {}) });
const primary = (): Workspace => ({ id: "main", projectId: "p", name: "repo", path: main, branch: "main", isPrimary: true, createdAt: 0 });
const worktree = (): Workspace => ({ id: "wt", projectId: "p", name: "wt", path: tree, branch: "me/wt", isPrimary: false, createdAt: 0 });

function deps(finishWith?: Project["finishWith"]): FinishDeps {
  return {
    requireWorkspace: (id) => ({ workspace: id === "wt" ? worktree() : primary(), project: project(finishWith) }),
    primaryOf: () => primary(),
    hosting: () => Promise.reject(new Error("no remote in tests")),
  };
}

async function commit(cwd: string, file: string, text: string): Promise<void> {
  await writeFile(join(cwd, file), text);
  await git(cwd, ["add", file]);
  await git(cwd, ["commit", "-m", `edit ${file}`]);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "finish-"));
  main = join(root, "main");
  tree = join(root, "wt");
  await git(root, ["init", "-b", "main", main]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) await git(main, ["config", k!, v!]);
  await commit(main, "a.txt", "one\n");
  await git(main, ["worktree", "add", "-b", "me/wt", tree]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("finishWorktree", () => {
  test("merges the worktree's commits into the main checkout", async () => {
    await commit(tree, "b.txt", "two\n");
    const done = await finishWorktree(deps(), "wt");
    expect(done.kind).toBe("merged");
    expect(await git(main, ["log", "--format=%s", "-3"])).toContain("edit b.txt");
  });

  test("stops on uncommitted changes and changes nothing", async () => {
    await writeFile(join(tree, "c.txt"), "loose\n");
    await expect(finishWorktree(deps(), "wt")).rejects.toThrow("uncommitted");
  });

  test("a conflict aborts the merge and says how to resolve it", async () => {
    await commit(tree, "a.txt", "theirs\n");
    await commit(main, "a.txt", "ours\n");
    const before = await git(main, ["rev-parse", "HEAD"]);
    await expect(finishWorktree(deps(), "wt")).rejects.toThrow("git merge main");
    expect(await git(main, ["rev-parse", "HEAD"])).toBe(before);
    expect((await git(main, ["status", "--porcelain"])).trim()).toBe("");
  });

  test("the main checkout's own chat has nothing to finish", async () => {
    await expect(finishWorktree(deps(), "main")).rejects.toThrow("main checkout");
  });
});
