import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git-cli.ts";
import { WorkspaceManager } from "./workspace-manager.ts";

// A project whose repository moved on disk is pointed at the new folder; its worktree relinks.

let root: string;
let manager: WorkspaceManager;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relocate-")));
  // Its own state file: never the person's ~/.acp-harness/state.json.
  manager = new WorkspaceManager(join(root, "home", "state.json"));
  await mkdir(join(root, "home"), { recursive: true });
  await git(root, ["init", "-b", "main", join(root, "old")]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) await git(join(root, "old"), ["config", k!, v!]);
  await writeFile(join(root, "old", "a.txt"), "one\n");
  await git(join(root, "old"), ["add", "a.txt"]);
  await git(join(root, "old"), ["commit", "-m", "one"]);
  await git(join(root, "old"), ["worktree", "add", "-b", "me/wt", join(root, "wt")]);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("relocating a project", () => {
  test("follows a repository moved on disk, worktree and all", async () => {
    const project = await manager.addProject(join(root, "old"));
    await rename(join(root, "old"), join(root, "new"));
    const { project: moved, primary } = await manager.relocateProject(project.id, join(root, "new"));
    expect(moved.id).toBe(project.id);
    expect(moved.path).toBe(join(root, "new"));
    expect(moved.name).toBe("new");
    expect(primary?.path).toBe(join(root, "new"));
    expect(primary?.branch).toBe("main");
    const listed = await git(join(root, "new"), ["worktree", "list", "--porcelain"]);
    expect(listed.replaceAll("\\", "/")).toContain(join(root, "wt").replaceAll("\\", "/"));
    expect(await git(join(root, "wt"), ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("me/wt");
  });

  test("refuses a folder that is missing or already another project", async () => {
    const [project] = (await manager.snapshot()).projects;
    await expect(manager.relocateProject(project!.id, join(root, "nowhere"))).rejects.toThrow("is not a folder");
    const other = await manager.addProject(join(root, "home"));
    await expect(manager.relocateProject(project!.id, other.path)).rejects.toThrow("is already the project");
  });
});
