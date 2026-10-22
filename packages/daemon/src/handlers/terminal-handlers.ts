import { HARNESS_METHODS } from "@acp-harness/protocol";
import { QuickCommandStore } from "../quick-command-store.ts";
import { resolveTerminalPaths } from "../terminal-path-links.ts";
import { detectInstalledAgents } from "../tui-agent-detection.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerTerminalHandlers({ handle, terminals, workspaceRoot }: HandlerContext): void {
  const quickCommands = new QuickCommandStore();

  handle(HARNESS_METHODS.shellsList, async () => terminals.listShells());
  handle(HARNESS_METHODS.terminalsList, async () => terminals.list());
  handle(HARNESS_METHODS.terminalCreate, async (p) =>
    // Listed field by field: `program` (hook runners) is daemon-internal and must not come from a client.
    terminals.create({
      workspaceId: p.workspaceId,
      shellId: p.shellId,
      cols: p.cols,
      rows: p.rows,
      agent: p.agent,
      prompt: p.prompt,
      command: p.command,
      inline: p.inline,
      cwd: workspaceRoot(p.workspaceId),
    }),
  );
  handle(HARNESS_METHODS.terminalAttach, async (p) => ({ buffer: terminals.replay(p.terminalId) }));
  handle(HARNESS_METHODS.terminalInput, async (p) => {
    terminals.write(p.terminalId, p.data);
    return {};
  });
  handle(HARNESS_METHODS.terminalResize, async (p) => {
    terminals.resize(p.terminalId, p.cols, p.rows);
    return {};
  });
  handle(HARNESS_METHODS.terminalClose, async (p) => {
    terminals.close(p.terminalId);
    return {};
  });
  handle(HARNESS_METHODS.terminalRestart, async (p) => terminals.restart(p.terminalId));
  handle(HARNESS_METHODS.terminalRename, async (p) => terminals.rename(p.terminalId, p.title));
  handle(HARNESS_METHODS.terminalSetInline, async (p) => terminals.setInline(p.terminalId, p.inline));
  handle(HARNESS_METHODS.terminalResolvePaths, async (p) => {
    const info = terminals.get(p.terminalId);
    return resolveTerminalPaths(info.cwd, workspaceRoot(info.workspaceId), p.paths);
  });
  handle(HARNESS_METHODS.agentsDetect, async (p) => detectInstalledAgents(p.refresh === true));
  handle(HARNESS_METHODS.quickCommandsList, async () => quickCommands.list());
  handle(HARNESS_METHODS.quickCommandSave, async (p) => quickCommands.save(p.command));
  handle(HARNESS_METHODS.quickCommandRemove, async (p) => quickCommands.remove(p.id));
}
