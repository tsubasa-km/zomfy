import { HARNESS_METHODS } from "@acp-harness/protocol";
import { WorkflowStore } from "../workflow-store.ts";
import type { HandlerContext } from "./handler-context.ts";

const workflows = new WorkflowStore();

export function registerWorkflowHandlers({ handle }: HandlerContext): void {
  handle(HARNESS_METHODS.workflowsList, (p) => workflows.list(p.projectId));
  handle(HARNESS_METHODS.workflowSave, (p) => workflows.save({ ...p.workflow, updatedAt: Date.now() }));
  handle(HARNESS_METHODS.workflowRemove, (p) => workflows.remove(p.projectId, p.workflowId));
}
