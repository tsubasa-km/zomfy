import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git-cli.ts";
import { copyWorktreeIncludes } from "./worktree-include.ts";

let root: string;
let main: string;
let tree: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "include-"));
  main = join(root, "main");
  tree = join(root, "wt");
  await git(root, ["init", "-b", "main", main]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) {
    await git(main, ["config", k!, v!]);
  }
  await writeFile(join(main, ".gitignore"), ".env*\nconfig/local/\n*.log\n");
  await writeFile(join(main, "tracked.txt"), "branch version\n");
  await writeFile(join(main, ".worktreeinclude"), "# secrets\n.env*\n!.env.example\nconfig/local/\ntracked.txt\nnotes.md\n");
  await git(main, ["add", "."]);
  await git(main, ["commit", "-m", "init"]);
  await writeFile(join(main, ".env"), "TOKEN=1\n");
  await writeFile(join(main, ".env.local"), "LOCAL=1\n");
  await writeFile(join(main, ".env.example"), "TOKEN=\n");
  await writeFile(join(main, "debug.log"), "not listed\n");
  await writeFile(join(main, "notes.md"), "untracked, not ignored\n");
  await mkdir(join(main, "config", "local"), { recursive: true });
  await writeFile(join(main, "config", "local", "db.json"), "{}\n");
  await writeFile(join(main, "tracked.txt"), "uncommitted edit\n");
  await git(main, ["worktree", "add", "-b", "wt", tree]);
}, 30_000);

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
}, 30_000);

describe("copyWorktreeIncludes", () => {
  test("copies the ignored files and folders the patterns match, and nothing else", async () => {
    const copied = await copyWorktreeIncludes(main, tree);
    expect(copied.sort()).toEqual([".env", ".env.local", "config/local"]);
    expect(await readFile(join(tree, ".env"), "utf8")).toBe("TOKEN=1\n");
    expect(await readFile(join(tree, "config", "local", "db.json"), "utf8")).toBe("{}\n");
    // Negated, not listed, or not ignored: left behind.
    expect(existsSync(join(tree, ".env.example"))).toBe(false);
    expect(existsSync(join(tree, "debug.log"))).toBe(false);
    expect(existsSync(join(tree, "notes.md"))).toBe(false);
    // Tracked files keep the worktree's own version.
    expect(await readFile(join(tree, "tracked.txt"), "utf8")).toBe("branch version\n");
  });

  test("leaves a file the worktree already has", async () => {
    await writeFile(join(tree, ".env"), "TOKEN=mine\n");
    await copyWorktreeIncludes(main, tree);
    expect(await readFile(join(tree, ".env"), "utf8")).toBe("TOKEN=mine\n");
  });

  test("does nothing without the file", async () => {
    await rm(join(main, ".worktreeinclude"));
    expect(await copyWorktreeIncludes(main, tree)).toEqual([]);
    expect(existsSync(join(tree, ".env"))).toBe(false);
  });
});
