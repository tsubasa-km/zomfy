import { HARNESS_METHODS, type WorkspaceSummary } from "@acp-harness/protocol";
import { readOrcaProjects } from "../orca-import.ts";
import { effectiveHook, projectHookInfo, runArchiveHook, writeHookRunner } from "../project-hooks.ts";
import { cloneRepository, createRepository, expandHome, projectCreationDefaults } from "../repo-bootstrap.ts";
import { inspectWorkspace, workspaceSummary } from "../workspace-git-summary.ts";
import { log } from "../log.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerWorkspaceHandlers({ handle, workspaces, sessions, terminals }: HandlerContext): void {
  handle(HARNESS_METHODS.stateGet, () => workspaces.snapshot());
  handle(HARNESS_METHODS.projectAdd, (p) =>
    workspaces.addProject(expandHome(p.path), { requireGit: p.requireGit === true }),
  );
  handle(HARNESS_METHODS.projectRemove, async (p) => {
    const state = await workspaces.snapshot();
    await workspaces.removeProject(p.projectId);
    for (const w of state.workspaces.filter((w) => w.projectId === p.projectId)) {
      await sessions.removeWorkspace(w.id);
      terminals.closeWorkspace(w.id);
    }
    return {};
  });
  handle(HARNESS_METHODS.workspaceCreate, async (p) => {
    const workspace = await workspaces.createWorkspace(p);
    const { project } = workspaces.requireWorkspace(workspace.id);
    if (project.kind !== "git" || p.runSetup === false) return workspace;
    // Orca runs the setup script in a terminal of the new worktree, where the user can watch it.
    try {
      const script = await effectiveHook(project, "setup", workspace.path);
      if (!script) return workspace;
      const launch = await writeHookRunner(project, workspace.path, "setup", script);
      const terminal = await terminals.create({
        workspaceId: workspace.id,
        cwd: workspace.path,
        cols: 120,
        rows: 30,
        program: { argv: launch.argv, title: "Setup", env: launch.env },
      });
      return { ...workspace, setupTerminalId: terminal.id };
    } catch (error) {
      log(`setup for ${workspace.path} did not start: ${String(error)}`);
      return workspace;
    }
  });
  handle(HARNESS_METHODS.workspaceCreateScratch, () => workspaces.createScratchWorkspace());
  handle(HARNESS_METHODS.workspaceRemove, async (p) => {
    const scratch = (await workspaces.snapshot()).workspaces.some((w) => w.id === p.workspaceId && w.scratch);
    if (!scratch) {
      const { workspace, project } = workspaces.requireWorkspace(p.workspaceId);
      if (project.kind === "git" && !workspace.isPrimary) await runArchiveHook(project, workspace.path);
    }
    await workspaces.removeWorkspace(p);
    await sessions.removeWorkspace(p.workspaceId);
    terminals.closeWorkspace(p.workspaceId);
    return {};
  });
  handle(HARNESS_METHODS.workspaceUpdate, (p) => workspaces.updateWorkspace(p.workspaceId, p.patch));
  handle(HARNESS_METHODS.branchesList, (p) => workspaces.listBranches(p.projectId));
  handle(HARNESS_METHODS.floatingCwdSet, (p) => workspaces.setFloatingCwd(p.path));
  handle(HARNESS_METHODS.orcaProjects, () => readOrcaProjects());
  handle(HARNESS_METHODS.projectUpdate, (p) => workspaces.updateProject(p.projectId, p.patch));
  handle(HARNESS_METHODS.projectsReorder, async (p) => {
    await workspaces.reorderProjects(p.projectIds);
    return {};
  });
  handle(HARNESS_METHODS.projectHooks, async (p) => {
    const project = (await workspaces.snapshot()).projects.find((x) => x.id === p.projectId);
    if (!project) throw new Error(`Unknown project ${p.projectId}`);
    return projectHookInfo(project);
  });
  handle(HARNESS_METHODS.projectClone, async (p) =>
    workspaces.addProject(await cloneRepository(p.url, p.parentPath, p.name)),
  );
  handle(HARNESS_METHODS.projectCreateRepo, async (p) =>
    workspaces.addProject(await createRepository(p.parentPath, p.name)),
  );
  handle(HARNESS_METHODS.projectCreationDefaults, () => projectCreationDefaults());
  handle(HARNESS_METHODS.projectGroupCreate, (p) => workspaces.createProjectGroup(p.name, p.projectIds));
  handle(HARNESS_METHODS.projectGroupUpdate, (p) => workspaces.updateProjectGroup(p.groupId, p.patch));
  handle(HARNESS_METHODS.projectGroupRemove, async (p) => {
    await workspaces.removeProjectGroup(p.groupId);
    return {};
  });
  handle(HARNESS_METHODS.workspacesReorder, async (p) => {
    await workspaces.reorderWorkspaces(p.workspaceIds);
    return {};
  });
  handle(HARNESS_METHODS.workspaceSummaries, async () => {
    const baseRefs = new Map<string, Promise<string>>();
    const summaries = await Promise.all(
      workspaces
        .projectWorkspaces()
        .filter(({ project }) => project.kind === "git")
        .map(async ({ workspace, project }) => {
          let base = baseRefs.get(project.id);
          if (!base) baseRefs.set(project.id, (base = workspaces.baseRefOf(project)));
          return workspaceSummary(workspace, await base).catch(() => null);
        }),
    );
    return summaries.filter((s): s is WorkspaceSummary => s !== null);
  });
  handle(HARNESS_METHODS.workspaceInspect, async (p) => {
    const { workspace, project } = workspaces.requireWorkspace(p.workspaceId);
    if (project.kind !== "git") return { modifiedFiles: 0, untrackedFiles: 0, unpushedCommits: null };
    return inspectWorkspace(workspace, await workspaces.baseRefOf(project));
  });
}
