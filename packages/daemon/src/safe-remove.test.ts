import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { namespacedPath, removeTree } from "./safe-remove.ts";

setDefaultTimeout(30_000);

let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "safe-remove-")));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe("removeTree", () => {
  test("deletes a tree whose paths pass 260 characters", async () => {
    const top = join(root, "long");
    let deep = top;
    while (deep.length < 320) deep = join(deep, "node_modules_with_a_long_folder_name");
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, "index.js"), "module.exports = 1\n");
    expect(join(deep, "index.js").length).toBeGreaterThan(260);
    await removeTree(top);
    expect(existsSync(top)).toBe(false);
  });

  test("removes a link inside the tree without touching what it points at", async () => {
    const shared = join(root, "shared");
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, "SKILL.md"), "keep me\n");
    const top = join(root, "linked");
    await mkdir(join(top, ".claude", "skills"), { recursive: true });
    await symlink(shared, join(top, ".claude", "skills", "zomfy-worktrees"), "junction");
    await removeTree(top);
    expect(existsSync(top)).toBe(false);
    expect(existsSync(join(shared, "SKILL.md"))).toBe(true);
  });

  test("a missing folder is nothing to do", async () => {
    await removeTree(join(root, "never-there"));
  });

  test("namespaced paths", () => {
    if (process.platform !== "win32") return;
    expect(namespacedPath("C:\\a\\b")).toBe("\\\\?\\C:\\a\\b");
    expect(namespacedPath("\\\\server\\share\\x")).toBe("\\\\?\\UNC\\server\\share\\x");
  });
});
