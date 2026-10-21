import { HARNESS_METHODS } from "@acp-harness/protocol";
import { listDirectory, readWorkspaceFile, writeWorkspaceFile } from "../workspace-files.ts";
import { searchWorkspace } from "../workspace-search.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerFileHandlers({ handle, workspaceRoot }: HandlerContext): void {
  handle(HARNESS_METHODS.fsList, async (p) => listDirectory(workspaceRoot(p.workspaceId), p.dir));
  handle(HARNESS_METHODS.fsRead, async (p) => readWorkspaceFile(workspaceRoot(p.workspaceId), p.path));
  handle(HARNESS_METHODS.fsWrite, async (p) =>
    writeWorkspaceFile(workspaceRoot(p.workspaceId), p.path, p.content, p.expectedMtimeMs),
  );
  handle(HARNESS_METHODS.search, async (p) => searchWorkspace(workspaceRoot(p.workspaceId), p));
}
