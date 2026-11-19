import { HARNESS_METHODS } from "@acp-harness/protocol";
import { SshConnectionStore, sshArgs, terminalConnection } from "../ssh-connections.ts";
import { hostPath } from "../tui-agent-detection.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerSshConnectionHandlers({ handle, terminals, workspaceRoot }: HandlerContext): void {
  const connections = new SshConnectionStore();

  handle(HARNESS_METHODS.sshConnectionsList, async () => connections.list());
  handle(HARNESS_METHODS.sshConnectionSave, async (p) => connections.save(p.id, p.connection));
  handle(HARNESS_METHODS.sshConnectionDelete, async (p) => connections.remove(p.id));
  // The tab runs this host's ssh itself, not a shell: its arguments never pass through one.
  handle(HARNESS_METHODS.sshConnectionOpen, async (p) => {
    const connection = await connections.get(p.id);
    const ssh = Bun.which("ssh", { PATH: await hostPath() });
    if (!ssh) throw new Error("ssh is not installed on this host (on Windows: Settings › System › Optional features › OpenSSH Client)");
    return terminals.create({
      workspaceId: p.workspaceId,
      cols: p.cols,
      rows: p.rows,
      cwd: workspaceRoot(p.workspaceId),
      program: { argv: [ssh, ...sshArgs(connection)], title: connection.name },
      connection: terminalConnection(connection),
    });
  });
}
