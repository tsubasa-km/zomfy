import { HARNESS_METHODS } from "@acp-harness/protocol";
import { cancelCommitMessage, generateCommitMessage } from "../commit-message-generator.ts";
import { gitBaseRefs, gitBranchCompare } from "../git-branch-compare.ts";
import { gitCommit, gitDiff, gitDiscard, gitStage, gitStatus, gitUnstage } from "../git-changes.ts";
import { gitCommitChanges, gitHistory } from "../git-history.ts";
import { gitFetch, gitPull, gitPush, gitSync } from "../git-remote-sync.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerGitHandlers({ handle, workspaceRoot }: HandlerContext): void {
  const done = async (work: Promise<unknown>) => {
    await work;
    return {};
  };
  handle(HARNESS_METHODS.gitStatus, async (p) => gitStatus(workspaceRoot(p.workspaceId)));
  handle(HARNESS_METHODS.gitDiff, async (p) => gitDiff(workspaceRoot(p.workspaceId), p.path, p.staged, p.compare));
  handle(HARNESS_METHODS.gitStage, async (p) => done(gitStage(workspaceRoot(p.workspaceId), p.paths)));
  handle(HARNESS_METHODS.gitUnstage, async (p) => done(gitUnstage(workspaceRoot(p.workspaceId), p.paths)));
  handle(HARNESS_METHODS.gitDiscard, async (p) => done(gitDiscard(workspaceRoot(p.workspaceId), p.paths, p.area)));
  handle(HARNESS_METHODS.gitCommit, async (p) => ({
    commit: await gitCommit(workspaceRoot(p.workspaceId), p.message, p.amend ?? false),
  }));
  handle(HARNESS_METHODS.gitPush, async (p) => done(gitPush(workspaceRoot(p.workspaceId), { forceWithLease: p.forceWithLease })));
  handle(HARNESS_METHODS.gitPull, async (p) => done(gitPull(workspaceRoot(p.workspaceId), { ffOnly: p.ffOnly })));
  handle(HARNESS_METHODS.gitFetch, async (p) => done(gitFetch(workspaceRoot(p.workspaceId))));
  handle(HARNESS_METHODS.gitSync, async (p) => done(gitSync(workspaceRoot(p.workspaceId))));
  handle(HARNESS_METHODS.gitHistory, async (p) =>
    gitHistory(workspaceRoot(p.workspaceId), { limit: p.limit, baseRef: p.baseRef }),
  );
  handle(HARNESS_METHODS.gitCommitChanges, async (p) => gitCommitChanges(workspaceRoot(p.workspaceId), p.commit));
  handle(HARNESS_METHODS.gitBranchCompare, async (p) => gitBranchCompare(workspaceRoot(p.workspaceId), p.baseRef));
  handle(HARNESS_METHODS.gitBaseRefs, async (p) => gitBaseRefs(workspaceRoot(p.workspaceId)));
  handle(HARNESS_METHODS.gitGenerateCommitMessage, async (p) => ({
    message: await generateCommitMessage(p.workspaceId, workspaceRoot(p.workspaceId)),
  }));
  handle(HARNESS_METHODS.gitCancelCommitMessage, async (p) => {
    cancelCommitMessage(p.workspaceId);
    return {};
  });
}
