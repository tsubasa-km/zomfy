import { HARNESS_METHODS } from "@acp-harness/protocol";
import { readOrcaProjects } from "../orca-import.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerWorkspaceHandlers({ handle, workspaces, sessions, terminals }: HandlerContext): void {
  handle(HARNESS_METHODS.stateGet, () => workspaces.snapshot());
  handle(HARNESS_METHODS.projectAdd, (p) => workspaces.addProject(p.path));
  handle(HARNESS_METHODS.projectRemove, async (p) => {
    const state = await workspaces.snapshot();
    await workspaces.removeProject(p.projectId);
    for (const w of state.workspaces.filter((w) => w.projectId === p.projectId)) {
      await sessions.removeWorkspace(w.id);
      terminals.closeWorkspace(w.id);
    }
    return {};
  });
  handle(HARNESS_METHODS.workspaceCreate, (p) => workspaces.createWorkspace(p));
  handle(HARNESS_METHODS.workspaceRemove, async (p) => {
    await workspaces.removeWorkspace(p);
    await sessions.removeWorkspace(p.workspaceId);
    terminals.closeWorkspace(p.workspaceId);
    return {};
  });
  handle(HARNESS_METHODS.workspaceUpdate, (p) => workspaces.updateWorkspace(p.workspaceId, p.patch));
  handle(HARNESS_METHODS.branchesList, (p) => workspaces.listBranches(p.projectId));
  handle(HARNESS_METHODS.floatingCwdSet, (p) => workspaces.setFloatingCwd(p.path));
  handle(HARNESS_METHODS.orcaProjects, () => readOrcaProjects());
}
