import { HARNESS_METHODS } from "@acp-harness/protocol";
import { listWorkspaceFiles } from "../workspace-file-list.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerQuickOpenHandlers({ handle, workspaceRoot }: HandlerContext): void {
  handle(HARNESS_METHODS.quickOpenFiles, async (p) => listWorkspaceFiles(workspaceRoot(p.workspaceId)));
}
