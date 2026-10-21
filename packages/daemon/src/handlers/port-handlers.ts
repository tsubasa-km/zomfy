import { HARNESS_METHODS } from "@acp-harness/protocol";
import { killWorkspacePort, scanWorkspacePorts } from "../workspace-ports.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerPortHandlers({ handle, workspaces, terminals }: HandlerContext): void {
  // The floating workspace sits in the home folder, which would claim every process by cwd.
  const folders = async () => (await workspaces.snapshot()).workspaces.filter((w) => w.projectId !== null);
  handle(HARNESS_METHODS.portsList, async () => scanWorkspacePorts(await folders(), terminals.shellPids()));
  handle(HARNESS_METHODS.portsKill, async (p) => {
    await killWorkspacePort(await folders(), terminals.shellPids(), p.pid, p.port);
    return {};
  });
}
