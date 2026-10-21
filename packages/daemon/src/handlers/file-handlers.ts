import { HARNESS_METHODS } from "@acp-harness/protocol";
import { listDirectory, readWorkspaceFile, writeWorkspaceFile } from "../workspace-files.ts";
import { searchWorkspace } from "../workspace-search.ts";
import { createEntry, deleteEntries, duplicateEntry, renameEntry } from "../workspace-file-ops.ts";
import { replaceInWorkspace } from "../workspace-replace.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerFileHandlers({ handle, workspaceRoot }: HandlerContext): void {
  handle(HARNESS_METHODS.fsList, async (p) => listDirectory(workspaceRoot(p.workspaceId), p.dir));
  handle(HARNESS_METHODS.fsRead, async (p) => readWorkspaceFile(workspaceRoot(p.workspaceId), p.path));
  handle(HARNESS_METHODS.fsWrite, async (p) =>
    writeWorkspaceFile(workspaceRoot(p.workspaceId), p.path, p.content, p.expectedMtimeMs),
  );
  handle(HARNESS_METHODS.search, async (p) => searchWorkspace(workspaceRoot(p.workspaceId), p));
  handle(HARNESS_METHODS.fsCreate, async (p) => {
    await createEntry(workspaceRoot(p.workspaceId), p.path, p.kind);
    return {};
  });
  handle(HARNESS_METHODS.fsRename, async (p) => {
    await renameEntry(workspaceRoot(p.workspaceId), p.from, p.to);
    return {};
  });
  handle(HARNESS_METHODS.fsDelete, async (p) =>
    deleteEntries(workspaceRoot(p.workspaceId), p.paths, p.permanent === true),
  );
  handle(HARNESS_METHODS.fsDuplicate, async (p) => duplicateEntry(workspaceRoot(p.workspaceId), p.path));
  handle(HARNESS_METHODS.searchReplace, async (p) => replaceInWorkspace(workspaceRoot(p.workspaceId), p));
}
