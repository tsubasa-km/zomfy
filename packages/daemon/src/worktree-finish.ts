import type { Project, Workspace } from "@acp-harness/protocol";
import { git, GitError } from "./git-cli.ts";
import { gitPush } from "./git-remote-sync.ts";
import type { HostingContext, HostingProvider } from "./hosting-provider.ts";

// A chat's worktree comes home when its work is done, the way the project says: merged into the
// main checkout (then the chat moves there and the worktree and branch go), or pushed as a pull
// request (the worktree stays for follow-ups). It never discards work or rewrites history: anything
// that would is left to the person, and every refusal says what to do instead.

export interface FinishDeps {
  requireWorkspace(workspaceId: string): { workspace: Workspace; project: Project };
  primaryOf(projectId: string): Workspace | undefined;
  hosting(cwd: string): Promise<{ ctx: HostingContext; provider: HostingProvider }>;
}

export type FinishResult =
  | { kind: "merged"; message: string; workspaceId: string; primaryId: string }
  | { kind: "pull-request"; message: string };

async function dirty(path: string): Promise<boolean> {
  return (await git(path, ["status", "--porcelain"])).trim().length > 0;
}

export async function finishWorktree(deps: FinishDeps, workspaceId: string | null, title?: string): Promise<FinishResult> {
  if (!workspaceId) throw new Error("This chat has no worktree to finish.");
  const { workspace, project } = deps.requireWorkspace(workspaceId);
  if (project.kind !== "git" || workspace.isPrimary || !workspace.branch) {
    throw new Error("This chat works in the main checkout, not a worktree of its own; there is nothing to finish.");
  }
  const primary = deps.primaryOf(project.id);
  if (!primary?.branch) throw new Error("The project's main checkout is not on a branch, so nothing can be merged into it.");
  const branch = workspace.branch;
  const base = primary.branch;
  if (await dirty(workspace.path)) {
    throw new Error("Your worktree has uncommitted changes. Commit what belongs to the work; to throw any away, ask the person (forward_to_person) first.");
  }
  const ahead = Number(await git(primary.path, ["rev-list", "--count", `${base}..${branch}`]));

  if ((project.finishWith ?? "merge") === "pull-request") {
    if (ahead === 0) throw new Error(`${branch} has no commits that ${base} lacks, so there is nothing to open a pull request for.`);
    await gitPush(workspace.path);
    const { ctx, provider } = await deps.hosting(workspace.path);
    const subject = (await git(workspace.path, ["log", "-1", "--format=%s"])).trim();
    const log = (await git(workspace.path, ["log", "--format=- %s", `${base}..${branch}`])).trim();
    const url = await provider.createReview(ctx, { title: title?.trim() || subject, body: log, base, head: branch, draft: false });
    return { kind: "pull-request", message: `Pushed ${branch} and opened a pull request into ${base}: ${url}. The worktree stays for follow-ups.` };
  }

  if (ahead > 0) {
    if (await dirty(primary.path)) {
      throw new Error(`The main checkout (${primary.path}) has uncommitted changes, so ${branch} cannot be merged into it now. Tell the person; do not touch them.`);
    }
    try {
      await git(primary.path, ["merge", "--no-ff", "--no-edit", branch], { timeoutMs: 120_000 });
    } catch (error) {
      const conflicted = await git(primary.path, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { quiet: true }).then(() => true, () => false);
      if (conflicted) {
        await git(primary.path, ["merge", "--abort"], { quiet: true }).catch(() => undefined);
        throw new Error(`${branch} conflicts with ${base}; nothing was changed. In your worktree, run git merge ${base} (or rebase onto it), resolve the conflicts, commit, and call finish_worktree again.`);
      }
      throw new Error(`git refused the merge (nothing was changed): ${error instanceof GitError ? error.stderr.trim() : String(error)}`);
    }
  }
  const merged = ahead > 0 ? `Merged ${branch} into ${base}` : `${branch} had nothing ${base} lacks`;
  return {
    kind: "merged",
    message: `${merged}. When this turn ends, this chat moves to the main checkout and the worktree and its branch are removed. End your turn now with a short summary.`,
    workspaceId: workspace.id,
    primaryId: primary.id,
  };
}
