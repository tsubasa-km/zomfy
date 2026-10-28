import type { Project, Workspace } from "@acp-harness/protocol";
import type { PathGuard } from "./step-path-guard.ts";

// One chat, one worktree: a chat sees its project's other worktrees but changes only its own. To
// change another, it asks that worktree's chat (send_prompt), or claims it while every chat there is
// idle; the claim lasts until the claiming turn ends, and meanwhile the owners may only read.

export interface ClaimDeps {
  projectWorkspaces(): { workspace: Workspace; project: Project }[];
  /** Chats in a workspace and whether each has a turn running or waiting on the person. */
  chatsIn(workspaceId: string): { id: string; busy: boolean }[];
}

export class WorktreeClaims {
  /** Claimed workspace id → the claiming session. */
  private claims = new Map<string, string>();

  constructor(private deps: ClaimDeps) {}

  private siblings(workspaceId: string | null): { workspace: Workspace; project: Project }[] {
    const all = this.deps.projectWorkspaces();
    const own = all.find((w) => w.workspace.id === workspaceId);
    if (!own) return [];
    return all.filter((w) => w.project.id === own.project.id && w.workspace.id !== workspaceId);
  }

  /** Read-only guards for the session's turn, checked on every tool call so a claim applies at once. */
  guards(sessionId: string, workspaceId: string | null): PathGuard[] {
    const ownPath = this.deps.projectWorkspaces().find((w) => w.workspace.id === workspaceId)?.workspace.path;
    const others = this.siblings(workspaceId)
      .filter((w) => this.claims.get(w.workspace.id) !== sessionId)
      // Worktrees kept inside the main checkout: guarding the checkout would fence this chat out of its own.
      .filter((w) => !ownPath || !inside(ownPath, w.workspace.path))
      .map(({ workspace }) => ({
        path: workspace.path,
        name: label(workspace),
        allow: "read" as const,
        reason: `Zomfy: ${workspace.path} is ${label(workspace)}, another chat's worktree: read it, but change only your own folder. Ask its chat with send_prompt, or call claim_worktree (workspace id ${workspace.id}) while every chat there is idle.`,
      }));
    const holder = workspaceId ? this.claims.get(workspaceId) : undefined;
    const own = this.deps.projectWorkspaces().find((w) => w.workspace.id === workspaceId)?.workspace;
    // Another chat holds this worktree for now: wait for it rather than edit underneath it.
    if (!holder || holder === sessionId || !own) return others;
    return [
      ...others,
      { path: own.path, name: label(own), allow: "read", reason: "Zomfy: another chat has claimed this worktree for its current turn; wait for it to finish before changing files." },
    ];
  }

  /** What the chat should know about the worktrees around it, or null outside a multi-worktree project. */
  prompt(workspaceId: string | null): string | null {
    const siblings = this.siblings(workspaceId);
    if (siblings.length === 0) return null;
    const lines = siblings.map(({ workspace }) => `- ${label(workspace)}: ${workspace.path} (workspace id ${workspace.id})`);
    return [
      "Zomfy: this project has other worktrees, each worked on by its own chat. You may read them to understand related work:",
      ...lines,
      "Change files only in your own folder. To change another worktree, ask its chat with the harness tool send_prompt (find it with list_sessions), or, when every chat there is idle, call claim_worktree with its workspace id and edit it until your turn ends.",
    ].join("\n");
  }

  claim(sessionId: string, sessionWorkspaceId: string | null, workspaceId: string): string {
    const target = this.siblings(sessionWorkspaceId).find((w) => w.workspace.id === workspaceId);
    if (!target) throw new Error("That workspace is not another worktree of this chat's project.");
    const holder = this.claims.get(workspaceId);
    if (holder && holder !== sessionId) throw new Error("Another chat has claimed that worktree; ask its chat with send_prompt instead.");
    const busy = this.deps.chatsIn(workspaceId).filter((c) => c.busy);
    if (busy.length > 0) throw new Error(`A chat there is working or waiting on the person; ask it with send_prompt (session ${busy[0]!.id}).`);
    this.claims.set(workspaceId, sessionId);
    return `Claimed ${label(target.workspace)} (${target.workspace.path}) until this turn ends.`;
  }

  /** The claiming turn ended: its worktrees go back to their chats. */
  release(sessionId: string): void {
    for (const [workspaceId, holder] of this.claims) if (holder === sessionId) this.claims.delete(workspaceId);
  }
}

function inside(path: string, root: string): boolean {
  const norm = (p: string) => {
    const full = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? full.toLowerCase() : full;
  };
  return norm(path).startsWith(`${norm(root)}/`);
}

function label(workspace: Workspace): string {
  return workspace.isPrimary ? "the main checkout" : (workspace.branch ?? workspace.displayName ?? workspace.name);
}
