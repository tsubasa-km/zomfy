import { HARNESS_METHODS } from "@acp-harness/protocol";
import { cancelCommitMessage, generateCommitMessage } from "../commit-message-generator.ts";
import { gitBaseRefs, gitBranchCompare } from "../git-branch-compare.ts";
import { gitCommit, gitDiff, gitDiscard, gitStage, gitStatus, gitUnstage } from "../git-changes.ts";
import { gitCommitChanges, gitHistory } from "../git-history.ts";
import { gitFetch, gitPull, gitPush, gitSync } from "../git-remote-sync.ts";
import { gitRepositories, repositoryRoot } from "../git-repositories.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerGitHandlers({ handle, workspaceRoot }: HandlerContext): void {
  const done = async (work: Promise<unknown>) => {
    await work;
    return {};
  };
  /** Where git runs: the workspace, or the repository below it the call names. */
  const repo = (p: { workspaceId: string; repo?: string }) => repositoryRoot(workspaceRoot(p.workspaceId), p.repo);
  /** One commit message is drafted at a time per repository. */
  const draftKey = (p: { workspaceId: string; repo?: string }) => (p.repo ? `${p.workspaceId}:${p.repo}` : p.workspaceId);
  handle(HARNESS_METHODS.gitRepositories, async (p) => ({ repositories: await gitRepositories(workspaceRoot(p.workspaceId)) }));
  handle(HARNESS_METHODS.gitStatus, async (p) => gitStatus(await repo(p)));
  handle(HARNESS_METHODS.gitDiff, async (p) => gitDiff(await repo(p), p.path, p.staged, p.compare));
  handle(HARNESS_METHODS.gitStage, async (p) => done(gitStage(await repo(p), p.paths)));
  handle(HARNESS_METHODS.gitUnstage, async (p) => done(gitUnstage(await repo(p), p.paths)));
  handle(HARNESS_METHODS.gitDiscard, async (p) => done(gitDiscard(await repo(p), p.paths, p.area)));
  handle(HARNESS_METHODS.gitCommit, async (p) => ({
    commit: await gitCommit(await repo(p), p.message, p.amend ?? false),
  }));
  handle(HARNESS_METHODS.gitPush, async (p) => done(gitPush(await repo(p), { forceWithLease: p.forceWithLease })));
  handle(HARNESS_METHODS.gitPull, async (p) => done(gitPull(await repo(p), { ffOnly: p.ffOnly })));
  handle(HARNESS_METHODS.gitFetch, async (p) => done(gitFetch(await repo(p))));
  handle(HARNESS_METHODS.gitSync, async (p) => done(gitSync(await repo(p))));
  handle(HARNESS_METHODS.gitHistory, async (p) =>
    gitHistory(await repo(p), { limit: p.limit, baseRef: p.baseRef }),
  );
  handle(HARNESS_METHODS.gitCommitChanges, async (p) => gitCommitChanges(await repo(p), p.commit));
  handle(HARNESS_METHODS.gitBranchCompare, async (p) => gitBranchCompare(await repo(p), p.baseRef));
  handle(HARNESS_METHODS.gitBaseRefs, async (p) => gitBaseRefs(await repo(p)));
  handle(HARNESS_METHODS.gitGenerateCommitMessage, async (p) => ({
    message: await generateCommitMessage(draftKey(p), await repo(p)),
  }));
  handle(HARNESS_METHODS.gitCancelCommitMessage, async (p) => {
    cancelCommitMessage(draftKey(p));
    return {};
  });
}
