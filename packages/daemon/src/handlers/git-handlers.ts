import { HARNESS_METHODS } from "@acp-harness/protocol";
import { gitCommit, gitDiff, gitStage, gitStatus, gitUnstage } from "../git-changes.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerGitHandlers({ handle, workspaceRoot }: HandlerContext): void {
  handle(HARNESS_METHODS.gitStatus, async (p) => gitStatus(workspaceRoot(p.workspaceId)));
  handle(HARNESS_METHODS.gitDiff, async (p) => gitDiff(workspaceRoot(p.workspaceId), p.path, p.staged));
  handle(HARNESS_METHODS.gitStage, async (p) => {
    await gitStage(workspaceRoot(p.workspaceId), p.paths);
    return {};
  });
  handle(HARNESS_METHODS.gitUnstage, async (p) => {
    await gitUnstage(workspaceRoot(p.workspaceId), p.paths);
    return {};
  });
  handle(HARNESS_METHODS.gitCommit, async (p) => ({
    commit: await gitCommit(workspaceRoot(p.workspaceId), p.message),
  }));
}
