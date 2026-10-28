import { describe, expect, test } from "bun:test";
import type { Project, Workspace } from "@acp-harness/protocol";
import { WorktreeClaims } from "./worktree-claims.ts";
import { guardedUse } from "./step-path-guard.ts";

const project = { id: "p", path: "/repo" } as Project;
const ws = (id: string, path: string, isPrimary = false): Workspace =>
  ({ id, projectId: "p", path, isPrimary, branch: isPrimary ? "main" : `me/${id}`, name: id }) as Workspace;
const all = [ws("main", "/repo", true), ws("a", "/wt/a"), ws("b", "/wt/b")];

function claimsWith(busy: Record<string, boolean> = {}) {
  return new WorktreeClaims({
    projectWorkspaces: () => all.map((workspace) => ({ workspace, project })),
    chatsIn: (workspaceId) => [{ id: `chat-${workspaceId}`, busy: busy[workspaceId] ?? false }],
  });
}

describe("WorktreeClaims", () => {
  test("a chat reads other worktrees but cannot change them", () => {
    const guards = claimsWith().guards("chat-a", "a");
    expect(guardedUse(guards, "Read", { file_path: "/wt/b/x.ts" }, "/wt/a")).toBeNull();
    expect(guardedUse(guards, "Edit", { file_path: "/wt/b/x.ts" }, "/wt/a")).toContain("another chat's worktree");
    expect(guardedUse(guards, "Edit", { file_path: "/wt/a/x.ts" }, "/wt/a")).toBeNull();
  });

  test("a claim lets the claimer edit and fences the owner until the turn ends", () => {
    const claims = claimsWith();
    claims.claim("chat-a", "a", "b");
    expect(guardedUse(claims.guards("chat-a", "a"), "Edit", { file_path: "/wt/b/x.ts" }, "/wt/a")).toBeNull();
    expect(guardedUse(claims.guards("chat-b", "b"), "Edit", { file_path: "/wt/b/x.ts" }, "/wt/b")).toContain("claimed");
    claims.release("chat-a");
    expect(guardedUse(claims.guards("chat-b", "b"), "Edit", { file_path: "/wt/b/x.ts" }, "/wt/b")).toBeNull();
  });

  test("a worktree whose chat is working cannot be claimed", () => {
    expect(() => claimsWith({ b: true }).claim("chat-a", "a", "b")).toThrow("send_prompt");
  });

  test("worktrees inside the main checkout are not fenced out of themselves", () => {
    const nested = [ws("main", "/repo", true), ws("n", "/repo/.worktrees/n")];
    const claims = new WorktreeClaims({ projectWorkspaces: () => nested.map((workspace) => ({ workspace, project })), chatsIn: () => [] });
    expect(guardedUse(claims.guards("chat-n", "n"), "Edit", { file_path: "/repo/.worktrees/n/x.ts" }, "/repo/.worktrees/n")).toBeNull();
  });

  test("the prompt lists the other worktrees", () => {
    expect(claimsWith().prompt("a")).toContain("/wt/b");
    expect(claimsWith().prompt(null)).toBeNull();
  });
});
