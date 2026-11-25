import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git-cli.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import { workspaceSummary } from "./workspace-git-summary.ts";

setDefaultTimeout(30_000);

// "Merged" is judged against the branch work is finished into (spec worktree-skills-and-storage B1):
// the main checkout's current branch, not `main`.

let root: string;
let repo: string;
let manager: WorkspaceManager;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "merge-target-")));
  repo = join(root, "repo");
  manager = new WorkspaceManager(join(root, "home", "state.json"));
  await mkdir(join(root, "home"), { recursive: true });
  await git(root, ["init", "-b", "main", repo]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) await git(repo, ["config", k!, v!]);
  await writeFile(join(repo, "a.txt"), "one\n");
  await git(repo, ["add", "a.txt"]);
  await git(repo, ["commit", "-m", "one"]);
  // The main checkout sits on development, where finished work goes.
  await git(repo, ["checkout", "-b", "development"]);
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe("merge target", () => {
  test("a branch merged into development but not main counts as merged", async () => {
    const project = await manager.addProject(repo);
    await manager.updateProject(project.id, { worktreeRoot: join(root, "worktrees"), defaultBaseRef: "main" });
    const workspace = await manager.createWorkspace({ projectId: project.id, name: "feature", branchName: "t/feature" });
    await writeFile(join(workspace.path, "b.txt"), "two\n");
    await git(workspace.path, ["add", "b.txt"]);
    await git(workspace.path, ["commit", "-m", "two"]);
    await git(repo, ["merge", "--no-ff", "--no-edit", "t/feature"]);

    const target = await manager.mergeTargetOf(project);
    expect(target).toBe("development");
    const summary = await workspaceSummary(workspace, "main", target);
    expect(summary?.merged).toBe(true);
    expect(summary?.mergeTarget).toBe("development");
    // Judged against main, as before, it is not.
    expect((await workspaceSummary(workspace, "main"))?.merged).toBe(false);

    // Uncommitted work is never merged.
    await writeFile(join(workspace.path, "c.txt"), "three\n");
    expect((await workspaceSummary(workspace, "main", target))?.merged).toBe(false);
  });

  test("the project's override wins", async () => {
    const project = (await manager.snapshot()).projects[0]!;
    const updated = await manager.updateProject(project.id, { mergeTarget: "main" });
    expect(await manager.mergeTargetOf(updated)).toBe("main");
    const cleared = await manager.updateProject(project.id, { mergeTarget: null });
    expect(await manager.mergeTargetOf(cleared)).toBe("development");
  });
});
