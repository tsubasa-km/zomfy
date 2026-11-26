import { HARNESS_METHODS, type WorkspaceSummary } from "@zomfy/protocol";
import { readOrcaProjects } from "../orca-import.ts";
import { effectiveHook, projectHookInfo, runArchiveHook, writeHookRunner } from "../project-hooks.ts";
import { cloneRepository, createRepository, expandHome, projectCreationDefaults } from "../repo-bootstrap.ts";
import { hostingAccounts } from "../hosting-account-service.ts";
import { cloneAuth, giveAccount, inspectFolder, publishToGitHub } from "../project-accounts.ts";
import { inspectWorkspace, workspaceSummary } from "../workspace-git-summary.ts";
import { log } from "../log.ts";
import { join } from "node:path";
import { HARNESS_HOME, WORKSPACE_ROOT } from "../harness-home.ts";
import { loadHostSettings } from "../host-settings.ts";
import { WorkspaceSizes } from "../workspace-sizes.ts";
import { projectWorktreeRoot, WorktreeCleanup } from "../worktree-cleanup.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerWorkspaceHandlers(ctx: HandlerContext): void {
  const { handle, workspaces, sessions, terminals, followFolder, splitBusy } = ctx;
  const sizes = new WorkspaceSizes(join(HARNESS_HOME, "worktree-sizes.json"));
  const cleanup = new WorktreeCleanup({
    workspaces,
    sizes,
    sessions: () => sessions.all(),
    terminals: () => terminals.list(),
    closeTerminals: (workspaceId) => terminals.closeWorkspace(workspaceId),
    moveChat: async (sessionId, workspaceId, notice) => {
      try {
        await ctx.moveSession({ sessionId, workspaceId });
        await ctx.emit(sessionId, { sessionUpdate: "notice", severity: "info", title: notice });
      } catch (error) {
        log(`cleanup kept a worktree: ${sessionId} could not move: ${String(error)}`);
      }
    },
    splitBusy,
    runArchiveHook,
    hostPolicy: async () => (await loadHostSettings()).worktreeCleanup,
    worktreeRoot: (project) => projectWorktreeRoot(project, WORKSPACE_ROOT),
    statePath: join(HARNESS_HOME, "worktree-cleanup.json"),
  });
  // Tests make many agents; the policy runs only in a real daemon.
  if (process.env.NODE_ENV !== "test") cleanup.start();

  handle(HARNESS_METHODS.stateGet, () => workspaces.snapshot());
  handle(HARNESS_METHODS.projectAdd, async (p) => {
    const project = await workspaces.addProject(expandHome(p.path), { requireGit: p.requireGit === true, displayName: p.displayName });
    return giveAccount(workspaces, hostingAccounts(), project, p.hostingAccount);
  });
  handle(HARNESS_METHODS.projectInspectFolder, (p) => inspectFolder(expandHome(p.path)));
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
    // Parts split off merge into this folder: it stays until they are done.
    const busy = sessions.all().filter((s) => s.workspaceId === p.workspaceId).map((s) => splitBusy(s.id)).find((b) => b);
    if (busy) throw new Error(`${busy} Remove the folder once they are done.`);
    const scratch = (await workspaces.snapshot()).workspaces.some((w) => w.id === p.workspaceId && w.scratch);
    if (!scratch) {
      const { workspace, project } = workspaces.requireWorkspace(p.workspaceId);
      if (project.kind === "git" && !workspace.isPrimary) await runArchiveHook(project, workspace.path);
    }
    // Its terminals hold the folder open on Windows; they go first.
    terminals.closeWorkspace(p.workspaceId);
    await workspaces.removeWorkspace(p);
    await sessions.removeWorkspace(p.workspaceId);
    sizes.forget(p.workspaceId);
    return {};
  });
  handle(HARNESS_METHODS.workspaceUpdate, (p) => workspaces.updateWorkspace(p.workspaceId, p.patch));
  handle(HARNESS_METHODS.branchesList, (p) => workspaces.listBranches(p.projectId));
  handle(HARNESS_METHODS.floatingCwdSet, (p) => workspaces.setFloatingCwd(p.path));
  handle(HARNESS_METHODS.orcaProjects, () => readOrcaProjects());
  handle(HARNESS_METHODS.projectUpdate, async (p) => {
    const before = (await workspaces.snapshot()).projects.find((x) => x.id === p.projectId)?.hostingAccount;
    const project = await workspaces.updateProject(p.projectId, p.patch);
    // docs/specs/project-hosting-accounts.md: git pushes over HTTPS follow the project's account.
    if ("hostingAccount" in p.patch && project.kind === "git") {
      await hostingAccounts()
        .applyGitCredential(project.path, before, project.hostingAccount)
        .catch((error: unknown) => log(`credential helper for ${project.path} not updated: ${String(error)}`));
    }
    return project;
  });
  handle(HARNESS_METHODS.projectRelocate, async (p) => {
    const { project, primary } = await workspaces.relocateProject(p.projectId, expandHome(p.path));
    let waiting = 0;
    if (primary) {
      for (const session of sessions.all().filter((s) => s.workspaceId === primary.id)) {
        if (await followFolder(session.id, primary.path)) waiting++;
      }
    }
    return { project, waiting };
  });
  handle(HARNESS_METHODS.projectsReorder, async (p) => {
    await workspaces.reorderProjects(p.projectIds);
    return {};
  });
  handle(HARNESS_METHODS.projectHooks, async (p) => {
    const project = (await workspaces.snapshot()).projects.find((x) => x.id === p.projectId);
    if (!project) throw new Error(`Unknown project ${p.projectId}`);
    return projectHookInfo(project);
  });
  handle(HARNESS_METHODS.projectClone, async (p) => {
    const accounts = hostingAccounts();
    const path = await cloneRepository(p.url, p.parentPath, p.name, await cloneAuth(accounts, p.url, p.hostingAccount));
    return giveAccount(workspaces, accounts, await workspaces.addProject(path, { displayName: p.displayName }), p.hostingAccount);
  });
  handle(HARNESS_METHODS.projectCreateRepo, async (p) => {
    const project = await workspaces.addProject(await createRepository(p.parentPath, p.name), { displayName: p.displayName });
    if (!p.publish) return project;
    // The account first, so the push gh makes goes through its credential helper.
    const accounts = hostingAccounts();
    const withAccount = await giveAccount(workspaces, accounts, project, p.publish.account);
    const publishError = await publishToGitHub(accounts, withAccount, p.publish);
    return publishError ? { ...withAccount, publishError } : withAccount;
  });
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
    const refs = new Map<string, Promise<[string, string]>>();
    const summaries = await Promise.all(
      workspaces
        .projectWorkspaces()
        .filter(({ project }) => project.kind === "git")
        .map(async ({ workspace, project }) => {
          let pair = refs.get(project.id);
          if (!pair) refs.set(project.id, (pair = Promise.all([workspaces.baseRefOf(project), workspaces.mergeTargetOf(project)])));
          const [base, target] = await pair;
          return workspaceSummary(workspace, base, target).catch(() => null);
        }),
    );
    return summaries.filter((s): s is WorkspaceSummary => s !== null);
  });
  handle(HARNESS_METHODS.workspaceSizes, async (p) => {
    const all = workspaces.projectWorkspaces().map((x) => x.workspace).filter((w) => !w.scratch);
    const wanted = p.workspaceIds ? all.filter((w) => p.workspaceIds!.includes(w.id)) : all;
    return sizes.get(wanted, { wait: p.wait === true });
  });
  handle(HARNESS_METHODS.cleanupList, (p) => cleanup.list(p.projectId));
  handle(HARNESS_METHODS.workspaceFreeSpace, (p) => cleanup.freeSpace(p.workspaceId));
  handle(HARNESS_METHODS.leftoverRemove, async (p) => {
    await cleanup.removeLeftover(p.projectId, p.path);
    return {};
  });
  handle(HARNESS_METHODS.cleanupLastRun, () => cleanup.lastRun());
  handle(HARNESS_METHODS.workspaceInspect, async (p) => {
    const { workspace, project } = workspaces.requireWorkspace(p.workspaceId);
    if (project.kind !== "git") return { modifiedFiles: 0, untrackedFiles: 0, unpushedCommits: null };
    return inspectWorkspace(workspace, await workspaces.mergeTargetOf(project));
  });
}
