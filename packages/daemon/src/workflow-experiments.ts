import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WORKFLOW_EXPERIMENT_NOTIFICATIONS, type WorkflowContextRemoval, type WorkflowExperiment } from "@acp-harness/protocol";
import type { HandlerContext } from "./handlers/handler-context.ts";
import { HARNESS_HOME } from "./harness-home.ts";
import { replaceFile } from "./replace-file.ts";
import type { WorkflowEngine } from "./workflow-engine.ts";
import { log } from "./log.ts";

// Compares flows: the same task through each workflow, several trials each, as ordinary runs (each
// in a worktree of its own). Trials are interleaved (A1 B1 A2 B2…) so a change on the host or the
// model during the experiment does not land on one flow only.

const FILE = join(HARNESS_HOME, "workflow-experiments.json");
const KEEP = 50;

export class WorkflowExperiments {
  private all: Promise<WorkflowExperiment[]> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly stopped = new Set<string>();

  constructor(
    private readonly deps: Pick<HandlerContext, "broadcast">,
    private readonly engine: WorkflowEngine,
  ) {}

  private load(): Promise<WorkflowExperiment[]> {
    this.all ??= readFile(FILE, "utf8")
      .then((text) => {
        const parsed: unknown = JSON.parse(text);
        return Array.isArray(parsed) ? (parsed as (WorkflowExperiment & { workflowIds?: string[] })[]).map(withArms) : [];
      })
      .catch(() => []);
    return this.all;
  }

  /** One the previous daemon was running cannot pick its queue back up. */
  async recover(): Promise<void> {
    for (const experiment of await this.load()) {
      if (experiment.status !== "running") continue;
      experiment.status = "stopped";
      experiment.endedAt = Date.now();
      await this.save(experiment);
    }
  }

  async list(projectId: string): Promise<WorkflowExperiment[]> {
    return (await this.load()).filter((e) => e.projectId === projectId);
  }

  async start(params: {
    projectId: string;
    task: string;
    arms: { workflowId: string; label: string; without?: WorkflowContextRemoval }[];
    trials: number;
    parallel: number;
    autoApprove: boolean;
  }): Promise<WorkflowExperiment> {
    if (!params.task.trim()) throw new Error("Describe the task to compare the flows on");
    if (params.arms.length === 0) throw new Error("Pick at least one workflow");
    const arms = params.arms.map((arm) => ({ ...arm, id: crypto.randomUUID() }));
    const trials = Math.max(1, Math.min(10, Math.round(params.trials)));
    const experiment: WorkflowExperiment = {
      id: crypto.randomUUID(),
      projectId: params.projectId,
      task: params.task.trim(),
      arms,
      trials,
      parallel: Math.max(1, Math.min(4, Math.round(params.parallel))),
      autoApprove: params.autoApprove,
      runs: Array.from({ length: trials }, (_, t) => arms.map((arm) => ({ armId: arm.id, trial: t + 1, runId: null }))).flat(),
      status: "running",
      createdAt: Date.now(),
      endedAt: null,
    };
    await this.save(experiment);
    void this.drive(experiment);
    return experiment;
  }

  async stop(id: string): Promise<WorkflowExperiment> {
    const experiment = (await this.load()).find((e) => e.id === id);
    if (!experiment) throw new Error(`Unknown experiment ${id}`);
    if (experiment.status !== "running") return experiment;
    this.stopped.add(id);
    for (const slot of experiment.runs) if (slot.runId) await this.engine.stop(slot.runId).catch(() => undefined);
    experiment.status = "stopped";
    experiment.endedAt = Date.now();
    await this.save(experiment);
    return experiment;
  }

  private async drive(experiment: WorkflowExperiment): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (!this.stopped.has(experiment.id)) {
        const slot = experiment.runs[next++];
        if (!slot) return;
        const arm = experiment.arms.find((a) => a.id === slot.armId);
        try {
          if (!arm) throw new Error("The arm is gone");
          const run = await this.engine.start(experiment.projectId, arm.workflowId, experiment.task, undefined, {
            experimentId: experiment.id,
            autoApprove: experiment.autoApprove,
            ...(arm.without ? { without: arm.without } : {}),
          });
          slot.runId = run.id;
          await this.save(experiment);
          await this.engine.ended(run.id);
        } catch (error) {
          slot.error = error instanceof Error ? error.message : String(error);
          log(`experiment ${experiment.id}: ${slot.error}`);
          await this.save(experiment);
        }
      }
    };
    await Promise.all(Array.from({ length: experiment.parallel }, worker));
    if (this.stopped.delete(experiment.id) || experiment.status !== "running") return;
    experiment.status = "done";
    experiment.endedAt = Date.now();
    await this.save(experiment);
  }

  private async save(experiment: WorkflowExperiment): Promise<void> {
    const list = await this.load();
    const others = list.filter((e) => e.id !== experiment.id);
    // Finished ones past the cap make room, oldest first.
    const done = others.filter((e) => e.status !== "running");
    const dropped = new Set(done.slice(0, Math.max(0, others.length + 1 - KEEP)).map((e) => e.id));
    const next = [...others.filter((e) => !dropped.has(e.id)), experiment];
    this.all = Promise.resolve(next);
    this.deps.broadcast(WORKFLOW_EXPERIMENT_NOTIFICATIONS.workflowExperimentChanged, experiment);
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await mkdir(dirname(FILE), { recursive: true });
      await writeFile(`${FILE}.tmp`, JSON.stringify(next, null, 2));
      await replaceFile(`${FILE}.tmp`, FILE);
    });
    await this.writing;
  }
}

/** An experiment saved before arms: one arm per workflow, its runs keyed by the workflow. */
function withArms(experiment: WorkflowExperiment & { workflowIds?: string[] }): WorkflowExperiment {
  if (experiment.arms) return experiment;
  const { workflowIds = [], ...rest } = experiment;
  return {
    ...rest,
    arms: workflowIds.map((workflowId) => ({ id: workflowId, workflowId, label: workflowId })),
    runs: rest.runs.map((r) => ({ ...r, armId: r.armId ?? (r as { workflowId?: string }).workflowId ?? "" })),
  };
}
