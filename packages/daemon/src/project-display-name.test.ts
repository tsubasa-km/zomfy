import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "./workspace-manager.ts";

// docs/specs/add-project-dialog.md: the display name the Add a project dialog sends with a new project.

let root: string;
let manager: WorkspaceManager;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "display-name-")));
  // Its own state file: never the person's ~/.zomfy/state.json.
  manager = new WorkspaceManager(join(root, "home", "state.json"));
  for (const folder of ["home", "plain", "named", "same"]) await mkdir(join(root, folder), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a project's display name as it is added", () => {
  test("is unset without one", async () => {
    const project = await manager.addProject(join(root, "plain"));
    expect(project.name).toBe("plain");
    expect(project.displayName).toBeUndefined();
  });

  test("is set, trimmed, on a project this adds", async () => {
    const project = await manager.addProject(join(root, "named"), { displayName: "  My Project " });
    expect(project.displayName).toBe("My Project");
    expect((await manager.snapshot()).projects.find((p) => p.id === project.id)?.displayName).toBe("My Project");
  });

  test("is left unset when it is the folder's own name or blank", async () => {
    const project = await manager.addProject(join(root, "same"), { displayName: "same" });
    expect(project.displayName).toBeUndefined();
  });

  test("does not rename a project already added", async () => {
    const again = await manager.addProject(join(root, "named"), { displayName: "Something else" });
    expect(again.displayName).toBe("My Project");
  });
});
