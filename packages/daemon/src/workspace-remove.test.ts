import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git-cli.ts";
import { WorkspaceManager } from "./workspace-manager.ts";

// Real git on Windows takes seconds; bun 1.4 resets the preload's default for each file.
setDefaultTimeout(30_000);

// Removing a worktree workspace removes its record even when git no longer knows the worktree.

let root: string;
let repo: string;
let manager: WorkspaceManager;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "remove-ws-")));
  repo = join(root, "repo");
  // Its own state file: never the person's ~/.zomfy/state.json.
  manager = new WorkspaceManager(join(root, "home", "state.json"));
  await mkdir(join(root, "home"), { recursive: true });
  await git(root, ["init", "-b", "main", repo]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) await git(repo, ["config", k!, v!]);
  await writeFile(join(repo, "a.txt"), "one\n");
  await git(repo, ["add", "a.txt"]);
  await git(repo, ["commit", "-m", "one"]);
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
}, 30_000);

async function worktreeWorkspace(name: string) {
  let project = (await manager.snapshot()).projects[0]
  if (!project) {
    project = await manager.addProject(repo)
    // Worktrees go under the test's own folder, never the person's ~/zomfy/workspaces.
    await manager.updateProject(project.id, { worktreeRoot: join(root, "worktrees") })
  }
  const workspace = await manager.createWorkspace({ projectId: project.id, name, branchName: `t/${name}` });
  return workspace;
}

describe("removing a worktree workspace", () => {
  test("removes the worktree, its branch and the record", async () => {
    const workspace = await worktreeWorkspace("plain");
    await manager.removeWorkspace({ workspaceId: workspace.id, deleteBranch: true });
    expect(existsSync(workspace.path)).toBe(false);
    expect((await manager.snapshot()).workspaces.some((w) => w.id === workspace.id)).toBe(false);
    expect(await git(repo, ["branch", "--list", "t/plain"])).toBe("");
  });

  test("a worktree git already forgot still has its record and leftover folder removed", async () => {
    const workspace = await worktreeWorkspace("gone");
    // As when a removal gave up half way: git unregistered it, part of the folder is left.
    await git(repo, ["worktree", "remove", "--force", workspace.path]);
    await mkdir(workspace.path, { recursive: true });
    await writeFile(join(workspace.path, "left-behind.txt"), "x\n");
    await manager.removeWorkspace({ workspaceId: workspace.id, deleteBranch: true });
    expect(existsSync(workspace.path)).toBe(false);
    expect((await manager.snapshot()).workspaces.some((w) => w.id === workspace.id)).toBe(false);
    expect(await git(repo, ["branch", "--list", "t/gone"])).toBe("");
  });

  test("a worktree whose folder was deleted by hand still has its record removed", async () => {
    const workspace = await worktreeWorkspace("deleted");
    await rm(workspace.path, { recursive: true, force: true });
    await manager.removeWorkspace({ workspaceId: workspace.id, deleteBranch: true });
    expect((await manager.snapshot()).workspaces.some((w) => w.id === workspace.id)).toBe(false);
  });
});
