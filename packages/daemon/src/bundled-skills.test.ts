import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_SKILLS, BundledSkills, skillDigest, type BundledSkillDefinition } from "./bundled-skills.ts";
import { git } from "./git-cli.ts";
import { WorkspaceManager } from "./workspace-manager.ts";

setDefaultTimeout(60_000);

// Zomfy's bundled skills (spec worktree-skills-and-storage A): a shared copy per host, recognised by
// digest, linked per project and agent into every workspace and kept out of git.

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "bundled-skills-")));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}, 60_000);

const v1 = "---\nname: demo\ndescription: one\n---\nfirst\n";
const v2 = "---\nname: demo\ndescription: two\n---\nsecond\n";
const demo = (content: string): BundledSkillDefinition => ({
  name: "demo",
  description: "Demo",
  content,
  shipped: [skillDigest(v1), skillDigest(v2)],
});

describe("the shipped list", () => {
  test("holds the digest of every bundled skill as it ships now", () => {
    // A changed SKILL.md must add its digest, or installed copies would count as edited.
    for (const skill of BUNDLED_SKILLS) expect(skill.shipped).toContain(skillDigest(skill.content));
  });

  test("digests ignore CRLF line ends", () => {
    expect(skillDigest("a\r\nb\r\n")).toBe(skillDigest("a\nb\n"));
  });
});

describe("the shared copy", () => {
  test("missing, current, older (updated in place) and edited (left, then replaced with a backup)", async () => {
    const home = join(root, "copy-home");
    const older = new BundledSkills({ copyRoot: join(home, "skills"), backupRoot: join(home, "backups"), skills: [demo(v1)] });
    const current = new BundledSkills({ copyRoot: join(home, "skills"), backupRoot: join(home, "backups"), skills: [demo(v2)], now: () => 0 });
    expect(await current.copyState("demo")).toBe("missing");
    await older.ensureCopy("demo");
    expect(await current.copyState("demo")).toBe("older");
    expect(await current.ensureCopy("demo")).toBe("current");
    expect(await readFile(join(home, "skills", "demo", "SKILL.md"), "utf8")).toBe(v2);

    await writeFile(join(home, "skills", "demo", "SKILL.md"), "my own changes\n");
    expect(await current.ensureCopy("demo")).toBe("edited");
    expect(await readFile(join(home, "skills", "demo", "SKILL.md"), "utf8")).toBe("my own changes\n");

    await current.replace("demo");
    expect(await current.copyState("demo")).toBe("current");
    const backups = await readdir(join(home, "backups"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(home, "backups", backups[0]!, "SKILL.md"), "utf8")).toBe("my own changes\n");
  });
});

describe("per project and agent", () => {
  let repo: string;
  let manager: WorkspaceManager;
  let skills: BundledSkills;

  beforeAll(async () => {
    repo = join(root, "repo");
    manager = new WorkspaceManager(join(root, "home", "state.json"));
    await mkdir(join(root, "home"), { recursive: true });
    await git(root, ["init", "-b", "main", repo]);
    for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) await git(repo, ["config", k!, v!]);
    await writeFile(join(repo, "a.txt"), "one\n");
    await git(repo, ["add", "a.txt"]);
    await git(repo, ["commit", "-m", "one"]);
    skills = new BundledSkills({ copyRoot: join(root, "home", "skills"), backupRoot: join(root, "home", "backups"), skills: [demo(v2)] });
    manager.onWorktreeCreated(async (workspace, project) => {
      if (project.bundledSkills) await skills.syncProject(project, [workspace]);
    });
  });

  const all = async (projectId: string) => {
    const state = await manager.snapshot();
    return { project: state.projects.find((p) => p.id === projectId)!, workspaces: state.workspaces.filter((w) => w.projectId === projectId) };
  };

  test("turning it on links every workspace, git stays clean, and off removes only the link", async () => {
    let project = await manager.addProject(repo);
    await manager.updateProject(project.id, { worktreeRoot: join(root, "worktrees") });
    const existing = await manager.createWorkspace({ projectId: project.id, name: "before", branchName: "t/before" });

    project = await manager.setBundledSkill(project.id, "demo", ["claude", "codex"]);
    await skills.syncProject(project, (await all(project.id)).workspaces);
    for (const path of [repo, existing.path]) {
      const claude = join(path, ".claude", "skills", "demo");
      expect((await lstat(claude)).isSymbolicLink()).toBe(true);
      expect(await readFile(join(claude, "SKILL.md"), "utf8")).toBe(v2);
      expect((await lstat(join(path, ".agents", "skills", "demo"))).isSymbolicLink()).toBe(true);
      expect(await git(path, ["status", "--porcelain"])).toBe("");
    }
    const listed = await skills.describe(project, (await all(project.id)).workspaces);
    expect(listed[0]!.agents.map((a) => [a.agent, a.enabled, a.blocked])).toEqual([["claude", true, 0], ["codex", true, 0]]);
    expect(listed[0]!.copyState).toBe("current");

    // A worktree made later is linked as it is created.
    const later = await manager.createWorkspace({ projectId: project.id, name: "after", branchName: "t/after" });
    expect(existsSync(join(later.path, ".claude", "skills", "demo", "SKILL.md"))).toBe(true);

    project = await manager.setBundledSkill(project.id, "demo", ["codex"]);
    await skills.syncProject(project, (await all(project.id)).workspaces);
    expect(existsSync(join(repo, ".claude", "skills", "demo"))).toBe(false);
    expect(existsSync(join(repo, ".agents", "skills", "demo"))).toBe(true);
    expect(existsSync(join(root, "home", "skills", "demo", "SKILL.md"))).toBe(true);

    // Deleting a worktree with a link keeps the shared copy.
    await manager.removeWorkspace({ workspaceId: later.id, deleteBranch: true });
    expect(existsSync(later.path)).toBe(false);
    expect(await readFile(join(root, "home", "skills", "demo", "SKILL.md"), "utf8")).toBe(v2);
  });

  test("a folder of the person's own by that name is left alone and counted as blocked", async () => {
    const state = await manager.snapshot();
    let project = state.projects[0]!;
    const own = join(repo, ".claude", "skills", "demo");
    await mkdir(own, { recursive: true });
    await writeFile(join(own, "SKILL.md"), "mine\n");
    project = await manager.setBundledSkill(project.id, "demo", ["claude", "codex"]);
    await skills.syncProject(project, (await all(project.id)).workspaces);
    expect(await readFile(join(own, "SKILL.md"), "utf8")).toBe("mine\n");
    const listed = await skills.describe(project, (await all(project.id)).workspaces);
    expect(listed[0]!.agents.find((a) => a.agent === "claude")!.blocked).toBe(1);

    project = await manager.setBundledSkill(project.id, "demo", []);
    await skills.syncProject(project, (await all(project.id)).workspaces);
    expect(await readFile(join(own, "SKILL.md"), "utf8")).toBe("mine\n");
    expect(existsSync(join(repo, ".agents", "skills", "demo"))).toBe(false);
    expect(project.bundledSkills).toBeUndefined();
  });
});
