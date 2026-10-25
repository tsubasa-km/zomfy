import { HARNESS_METHODS } from "@acp-harness/protocol";
import { WorkflowEngine } from "../workflow-engine.ts";
import { WorkflowRunStore } from "../workflow-run-store.ts";
import { WorkflowStore } from "../workflow-store.ts";
import { WorkflowAgentStore } from "../workflow-agent-store.ts";
import { WorkflowExperiments } from "../workflow-experiments.ts";
import type { HandlerContext } from "./handler-context.ts";

const workflows = new WorkflowStore();
const agents = new WorkflowAgentStore();

export function registerWorkflowHandlers(ctx: HandlerContext): void {
  const { handle } = ctx;
  const engine = new WorkflowEngine(ctx, new WorkflowRunStore(), workflows, agents);
  void engine.recover();
  const experiments = new WorkflowExperiments(ctx, engine);
  void experiments.recover();
  handle(HARNESS_METHODS.workflowsList, (p) => workflows.list(p.projectId));
  handle(HARNESS_METHODS.workflowSave, (p) => workflows.save({ ...p.workflow, updatedAt: Date.now() }));
  handle(HARNESS_METHODS.workflowRemove, (p) => workflows.remove(p.projectId, p.workflowId));
  handle(HARNESS_METHODS.workflowAgentsList, () => agents.list());
  handle(HARNESS_METHODS.workflowAgentSave, (p) => agents.save(p.agent));
  handle(HARNESS_METHODS.workflowAgentRemove, (p) => agents.remove(p.id));
  handle(HARNESS_METHODS.workflowRunStart, (p) => engine.start(p.projectId, p.workflowId, p.task, p.originSessionId));
  handle(HARNESS_METHODS.workflowRunAskPerson, async (p) => ({ answer: await engine.askPerson(p.sessionId, p.question) }));
  handle(HARNESS_METHODS.workflowRunsList, (p) => engine.list(p.projectId));
  handle(HARNESS_METHODS.workflowRunAnswer, (p) => engine.answer(p.runId, p.text));
  handle(HARNESS_METHODS.workflowRunStop, (p) => engine.stop(p.runId));
  handle(HARNESS_METHODS.workflowExperimentStart, (p) => experiments.start(p));
  handle(HARNESS_METHODS.workflowExperimentsList, (p) => experiments.list(p.projectId));
  handle(HARNESS_METHODS.workflowExperimentStop, (p) => experiments.stop(p.id));
}
