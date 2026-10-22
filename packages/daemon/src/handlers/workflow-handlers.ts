import { HARNESS_METHODS } from "@acp-harness/protocol";
import { WorkflowEngine } from "../workflow-engine.ts";
import { WorkflowRunStore } from "../workflow-run-store.ts";
import { WorkflowStore } from "../workflow-store.ts";
import type { HandlerContext } from "./handler-context.ts";

const workflows = new WorkflowStore();

export function registerWorkflowHandlers(ctx: HandlerContext): void {
  const { handle } = ctx;
  const engine = new WorkflowEngine(ctx, new WorkflowRunStore(), workflows);
  void engine.recover();
  handle(HARNESS_METHODS.workflowsList, (p) => workflows.list(p.projectId));
  handle(HARNESS_METHODS.workflowSave, (p) => workflows.save({ ...p.workflow, updatedAt: Date.now() }));
  handle(HARNESS_METHODS.workflowRemove, (p) => workflows.remove(p.projectId, p.workflowId));
  handle(HARNESS_METHODS.workflowRunStart, (p) => engine.start(p.projectId, p.workflowId, p.task));
  handle(HARNESS_METHODS.workflowRunsList, (p) => engine.list(p.projectId));
  handle(HARNESS_METHODS.workflowRunAnswer, (p) => engine.answer(p.runId, p.text));
  handle(HARNESS_METHODS.workflowRunStop, (p) => engine.stop(p.runId));
}
