import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalInfo, Workspace } from "@zomfy/protocol";
import { git } from "./git-cli.ts";
import { WorkspaceManager } from "./workspace-manager.ts";
import { measureTree, WorkspaceSizes } from "./workspace-sizes.ts";
import { projectWorktreeRoot, restoreFreedWorkspace, WorktreeCleanup, type CleanupSession } from "./worktree-cleanup.ts";

setDefaultTimeout(60_000);

// Sizes, Free space, leftover folders and the automatic policy (spec worktree-skills-and-storage
// B2, B4–B7), on a repository and worktree root of the test's own.

const DAY = 24 * 60 * 60 * 1000;
let root: string;
let repo: string;
let worktrees: string;
let manager: WorkspaceManager;
let projectId: string;
let clock = Date.now();
const sessions: CleanupSession[] = [];
const terminals: TerminalInfo[] = [];
const moved: string[] = [];
let cleanup: WorktreeCleanup;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "cleanup-")));
  repo = join(root, "repo");
  worktrees = join(root, "worktrees");
  manager = new WorkspaceManager(join(root, "home", "state.json"));
  await mkdir(join(root, "home"), { recursive: true });
  await git(root, ["init", "-b", "main", repo]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) await git(repo, ["config", k!, v!]);
  await writeFile(join(repo, ".gitignore"), "node_modules/\ntarget/\n");
  await writeFile(join(repo, "a.txt"), "one\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "one"]);
  await git(repo, ["checkout", "-b", "development"]);
  const project = await manager.addProject(repo);
  projectId = project.id;
  await manager.updateProject(project.id, { worktreeRoot: worktrees });
  const sizes = new WorkspaceSizes(join(root, "home", "sizes.json"), () => clock);
  cleanup = new WorktreeCleanup({
    workspaces: manager,
    sizes,
    sessions: () => sessions,
    terminals: () => terminals,
    closeTerminals: () => undefined,
    moveChat: async (sessionId, workspaceId) => {
      moved.push(sessionId);
      const s = sessions.find((x) => x.id === sessionId);
      if (s) s.workspaceId = workspaceId;
    },
    splitBusy: () => null,
    runArchiveHook: async () => undefined,
    hostPolicy: async () => undefined,
    worktreeRoot: (p) => projectWorktreeRoot(p, join(root, "unused")),
    statePath: join(root, "home", "cleanup.json"),
    now: () => clock,
  });
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}, 60_000);

async function worktree(name: string): Promise<Workspace> {
  return manager.createWorkspace({ projectId, name, branchName: `t/${name}` });
}

async function commitAndMerge(workspace: Workspace, file: string): Promise<void> {
  await writeFile(join(workspace.path, file), `${file}\n`);
  await git(workspace.path, ["add", file]);
  await git(workspace.path, ["commit", "-m", file]);
  await git(repo, ["merge", "--no-ff", "--no-edit", workspace.branch!]);
}

describe("sizes", () => {
  test("split into dependencies, build output and the rest; hardlinked files are not the worktree's own", async () => {
    const dir = join(root, "measure");
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(dir, "target", "debug"), { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "x".repeat(100));
    await writeFile(join(dir, "target", "debug", "app.exe"), "y".repeat(300));
    const cached = join(root, "cache-file.js");
    await writeFile(cached, "z".repeat(1000));
    await link(cached, join(dir, "node_modules", "pkg", "index.js"));
    await writeFile(join(dir, "node_modules", "pkg", "own.js"), "w".repeat(10));
    const tree = await measureTree(dir);
    expect(tree.total).toEqual({ bytes: 1410, ownBytes: 410 });
    expect(tree.dependencies).toEqual({ bytes: 1010, ownBytes: 10 });
    expect(tree.build).toEqual({ bytes: 300, ownBytes: 300 });
    expect(tree.dependencyRoots).toEqual([join(dir, "node_modules")]);
    expect(tree.buildRoots).toEqual([join(dir, "target")]);
  });
});

describe("free space", () => {
  test("deletes ignored dependencies and build output and keeps files and git state", async () => {
    const workspace = await worktree("free");
    await writeFile(join(workspace.path, "work.txt"), "uncommitted\n");
    await mkdir(join(workspace.path, "node_modules", "big"), { recursive: true });
    await writeFile(join(workspace.path, "node_modules", "big", "index.js"), "b".repeat(200_000));
    await mkdir(join(workspace.path, "apps", "desktop", "src-tauri", "target", "debug"), { recursive: true });
    await writeFile(join(workspace.path, "apps", "desktop", "src-tauri", "target", "debug", "app.exe"), "e".repeat(300_000));
    // A tracked folder named dist is source, not output: it stays.
    await mkdir(join(workspace.path, "dist"), { recursive: true });
    await writeFile(join(workspace.path, "dist", "keep.txt"), "tracked\n");
    await git(workspace.path, ["add", "dist/keep.txt"]);
    await git(workspace.path, ["commit", "-m", "dist"]);

    const { freedBytes } = await cleanup.freeSpace(workspace.id);
    expect(freedBytes).toBeGreaterThanOrEqual(500_000);
    expect(existsSync(join(workspace.path, "node_modules"))).toBe(false);
    expect(existsSync(join(workspace.path, "apps", "desktop", "src-tauri", "target"))).toBe(false);
    expect(existsSync(join(workspace.path, "dist", "keep.txt"))).toBe(true);
    expect(existsSync(join(workspace.path, "work.txt"))).toBe(true);
    expect(await git(workspace.path, ["status", "--porcelain"])).toBe("?? work.txt");
    const list = await cleanup.list(projectId);
    const row = list.candidates.find((c) => c.workspaceId === workspace.id)!;
    expect(row.size!.total.bytes).toBeLessThan(100 * 1024 * 1024);
    expect(row.untrackedFiles).toBe(1);
    expect(manager.requireWorkspace(workspace.id).workspace.spaceFreedAt).toBe(clock);

    // Its next turn is told (no setup script here), once.
    const note = await restoreFreedWorkspace(manager, workspace.id, async () => null, async () => false, async () => undefined);
    expect(note).toContain("bun install");
    expect(await restoreFreedWorkspace(manager, workspace.id, async () => null, async () => false, async () => undefined)).toBeNull();
  });

  test("refused while a terminal runs there", async () => {
    const workspace = await worktree("busy-terminal");
    terminals.push({ id: "t1", workspaceId: workspace.id, title: "", shell: "", cwd: workspace.path, createdAt: clock, exitCode: null } as TerminalInfo);
    await expect(cleanup.freeSpace(workspace.id)).rejects.toThrow(/terminal/);
    terminals.length = 0;
  });
});

describe("leftover folders", () => {
  test("a folder that is no worktree is offered and removable; one with a .git is not", async () => {
    const project = (await manager.snapshot()).projects[0]!;
    const base = projectWorktreeRoot(project, join(root, "unused"));
    await mkdir(join(base, "skeleton", "node_modules", "x"), { recursive: true });
    await mkdir(join(base, "checkout"), { recursive: true });
    await writeFile(join(base, "checkout", ".git"), "gitdir: elsewhere\n");
    const list = await cleanup.list(projectId);
    expect(list.leftovers.map((l) => l.path)).toEqual([join(base, "skeleton")]);
    await expect(cleanup.removeLeftover(projectId, join(base, "checkout"))).rejects.toThrow(/not a leftover/);
    await cleanup.removeLeftover(projectId, join(base, "skeleton"));
    expect(existsSync(join(base, "skeleton"))).toBe(false);
    await rm(join(base, "checkout"), { recursive: true, force: true });
  });
});

describe("the policy", () => {
  test("deletes a merged, idle worktree a day after it was merged, moving its chat; keeps the rest", async () => {
    const merged = await worktree("merged");
    await commitAndMerge(merged, "m.txt");
    const dirty = await worktree("dirty");
    await commitAndMerge(dirty, "d.txt");
    await writeFile(join(dirty.path, "scratch.txt"), "not committed\n");
    const pinned = await worktree("pinned");
    await commitAndMerge(pinned, "p.txt");
    await manager.updateWorkspace(pinned.id, { pinned: true });
    const working = await worktree("working");
    await commitAndMerge(working, "w.txt");
    sessions.push({ id: "chat-merged", workspaceId: merged.id, status: "idle", createdAt: clock, lastActivityAt: clock });
    sessions.push({ id: "chat-working", workspaceId: working.id, status: "working", createdAt: clock, lastActivityAt: clock });

    // First seen merged now: not yet a day.
    let run = await cleanup.runPolicy();
    expect(run.deleted).toBe(0);
    expect(existsSync(merged.path)).toBe(true);

    clock += 2 * DAY;
    run = await cleanup.runPolicy();
    expect(run.errors).toEqual([]);
    // The worktree from the terminal test never got a commit: merged and idle too.
    expect(run.deleted).toBe(2);
    expect(existsSync(merged.path)).toBe(false);
    expect(await git(repo, ["branch", "--list", "t/merged"])).toBe("");
    expect(moved).toContain("chat-merged");
    expect(existsSync(dirty.path)).toBe(true);
    expect(existsSync(pinned.path)).toBe(true);
    expect(existsSync(working.path)).toBe(true);
    expect((await cleanup.lastRun())?.deleted).toBe(2);
  });

  test("a project can turn it off", async () => {
    const off = await worktree("project-off");
    await commitAndMerge(off, "o.txt");
    await manager.updateProject(projectId, { cleanup: { deleteMerged: false } });
    await cleanup.runPolicy();
    clock += 2 * DAY;
    const run = await cleanup.runPolicy();
    expect(run.deleted).toBe(0);
    expect(existsSync(off.path)).toBe(true);
    await manager.updateProject(projectId, { cleanup: null });
  });
});
