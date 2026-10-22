import { HARNESS_METHODS } from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";
import { AutomationService } from "../automation-service.ts";
import { log } from "../log.ts";

export function registerAutomationHandlers({ handle, workspaces, sessions, runTurn, broadcast }: HandlerContext): void {
  const service = new AutomationService({ workspaces, sessions, runTurn, broadcast });
  // Started with the daemon, not a window: runs go on while no client is connected.
  const started = service.start().catch((error) => log(`automations failed to start: ${String(error)}`));

  handle(HARNESS_METHODS.automationsList, async () => {
    await started;
    return service.snapshot();
  });
  handle(HARNESS_METHODS.automationCreate, async (p) => {
    await started;
    return service.create(p.input);
  });
  handle(HARNESS_METHODS.automationUpdate, async (p) => {
    await started;
    return service.update(p.id, p.patch);
  });
  handle(HARNESS_METHODS.automationDelete, async (p) => {
    await started;
    service.remove(p.id);
    return {};
  });
  handle(HARNESS_METHODS.automationRunNow, async (p) => {
    await started;
    return service.runNow(p.id, p.workspaceId);
  });
}
