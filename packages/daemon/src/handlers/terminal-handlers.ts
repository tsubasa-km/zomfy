import { HARNESS_METHODS } from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";

export function registerTerminalHandlers({ handle, terminals, workspaceRoot }: HandlerContext): void {
  handle(HARNESS_METHODS.shellsList, async () => terminals.listShells());
  handle(HARNESS_METHODS.terminalsList, async () => terminals.list());
  handle(HARNESS_METHODS.terminalCreate, async (p) =>
    terminals.create({ ...p, cwd: workspaceRoot(p.workspaceId) }),
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
}
