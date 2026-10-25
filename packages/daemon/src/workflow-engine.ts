import {
  cyclesOf,
  isAbsolutePath,
  localOnlySteps,
  resolveWorkflowAgents,
  runsLocally,
  workflowAccessIssues,
  WORKFLOW_META,
  WORKFLOW_NOTIFICATIONS,
  workflowOutcomes,
  type ManagerCallResult,
  type Workflow,
  type ChatAgentId,
  type WorkflowCycle,
  type WorkflowDataLink,
  type WorkflowDataSource,
  type WorkflowNode,
  type WorkflowOutcome,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowToolPolicy,
  type Workspace,
} from "@acp-harness/protocol";
import type { StepOptions } from "./claude-turn.ts";
import type { HandlerContext } from "./handlers/handler-context.ts";
import { noteActivity } from "./session-activity.ts";
import { consultLead } from "./lead-consult.ts";
import type { WorkflowRunStore } from "./workflow-run-store.ts";
import type { WorkflowStore } from "./workflow-store.ts";
import type { WorkflowAgentStore } from "./workflow-agent-store.ts";
import type { PathGuard } from "./step-path-guard.ts";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { sanitizeWorkspaceName } from "./worktree-naming.ts";
import { log } from "./log.ts";

// Runs a workflow graph: the engine, not a model, picks each next step. Agent steps are chat
// sessions whose turn must end in a structured {outcome, summary}; the edge labelled with that
// outcome is taken. Checks are commands (exit code), "Ask the person" waits for an answer, and
// limited outcomes (a review's "changes", a check's "fail") count rounds. A loop that cannot finish (its
// limit reached, or stuck on the same failure) is never just dropped: it is handed up to the loop around
// it to rethink, and only the outermost loop asks the person.

type Deps = Pick<HandlerContext, "workspaces" | "sessions" | "pendingTurns" | "broadcast" | "runStepTurn" | "emit" | "serveTool">;

/** Outcomes counted against a step's round limit. */
const LIMITED: WorkflowOutcome[] = ["changes", "fail"];
const CHECK_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_TAIL = 4000;

interface Verdict {
  outcome: WorkflowOutcome;
  summary: string;
  /** Reviews: non-blocking findings for later. */
  followUps?: string[];
  /** Reviews: a blocking finding from last round is still not fixed. */
  repeated?: boolean;
}

interface StepResult extends Verdict {
  sessionIds: string[];
}

type TurnResult = Verdict & { index: number };

class RunStopped extends Error {}

/** A step session that may spawn helpers, sharing its step's cap with the step's other sessions. */
interface Spawner {
  run: WorkflowRun;
  node: WorkflowNode;
  live: { stopped: boolean; sessions: Set<string> };
  workspace: Workspace;
  step: StepOptions;
  slots: Slots;
  helpers: string[];
}

/** At most `max` jobs at once; the rest wait their turn. */
class Slots {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}

export class WorkflowEngine {
  /** Runs this daemon is driving now, so Stop can reach their turns. */
  private readonly live = new Map<string, { stopped: boolean; sessions: Set<string> }>();
  /** A step's session waiting mid-turn on the person (ask_lead escalated), by run id. */
  private readonly asking = new Map<string, (answer: string) => void>();
  /** Step sessions that may spawn helpers now, by session id. */
  private readonly spawners = new Map<string, Spawner>();

  constructor(
    private readonly deps: Deps,
    private readonly runs: WorkflowRunStore,
    private readonly workflows: WorkflowStore,
    private readonly agents: WorkflowAgentStore,
  ) {
    deps.serveTool("spawn_agents", (caller, _tool, args) => this.spawnAgents(caller, args), (id) => this.spawners.has(id));
  }

  /** A run left running by a previous daemon cannot pick its turn back up; a waiting one can. */
  async recover(): Promise<void> {
    for (const run of await this.runs.all()) {
      if (run.status !== "running") continue;
      run.status = "stopped";
      run.endedAt = Date.now();
      const open = run.steps.at(-1);
      if (open && open.endedAt === null) {
        open.endedAt = Date.now();
        open.error = "The daemon restarted during this step.";
      }
      await this.runs.save(run);
    }
  }

  async list(projectId: string): Promise<WorkflowRun[]> {
    return (await this.runs.all()).filter((r) => r.projectId === projectId);
  }

  async start(projectId: string, workflowId: string, task: string, originSessionId?: string): Promise<WorkflowRun> {
    const saved = (await this.workflows.list(projectId)).find((w) => w.id === workflowId);
    if (!saved) throw new Error("Save the workflow before running it");
    // The run keeps each step's agent as it is now, so editing an agent later does not change it.
    const profiles = await this.agents.list();
    const broken = workflowAccessIssues(saved, profiles).find((i) => i.level === "error");
    if (broken) throw new Error(broken.message);
    const workflow = resolveWorkflowAgents(saved, profiles);
    const start = workflow.nodes.find((n) => n.kind === "start");
    if (!start) throw new Error("The workflow has no Start step");
    const first = workflow.edges.find((e) => e.from === start.id && e.outcome === "next");
    if (!first) throw new Error("Start leads nowhere");
    if (!task.trim()) throw new Error("Describe the task for the run");

    const id = crypto.randomUUID();
    const workspace = await this.runWorkspace(projectId, workflow, id);
    const run: WorkflowRun = {
      id,
      workflowId,
      projectId,
      workflow,
      task: task.trim(),
      status: "running",
      currentNodeId: first.to,
      workspaceId: workspace.id,
      rounds: {},
      sessionsByNode: {},
      steps: [],
      waiting: null,
      createdAt: Date.now(),
      endedAt: null,
    };
    await this.save(run);
    if (originSessionId && this.deps.sessions.get(originSessionId)) {
      // The chat it started from draws the run as a live card.
      await this.deps
        .emit(originSessionId, {
          sessionUpdate: "notice",
          severity: "info",
          title: `Workflow "${workflow.name}" started`,
          _meta: { [WORKFLOW_META.run]: run.id },
        })
        .catch(() => undefined);
    }
    this.tellLead(run, `Workflow "${workflow.name}" started on: ${run.task.slice(0, 300)} (run ${run.id}, in ${workspace.path}).`);
    void this.drive(run);
    return run;
  }

  /** A step's session asks the person mid-turn; the run waits until they answer. Null: no run has that session. */
  async askPerson(sessionId: string, question: string): Promise<string | null> {
    const runId = [...this.live.entries()].find(([, live]) => live.sessions.has(sessionId))?.[0];
    const run = runId ? await this.runs.get(runId) : null;
    if (!run || run.status !== "running") return null;
    const answer = new Promise<string>((resolve) => this.asking.set(run.id, resolve));
    await this.wait(run, question, "ask");
    return answer;
  }

  async answer(runId: string, text: string): Promise<WorkflowRun> {
    const run = await this.runs.get(runId);
    const asking = this.asking.get(runId);
    if (run && asking && run.status === "waiting") {
      // The question came from inside a step: the answer goes back to that session's tool call.
      this.asking.delete(runId);
      run.status = "running";
      run.waiting = null;
      await this.save(run);
      this.tellLead(run, `The person answered a question in run ${run.id}: ${text.slice(0, 400)}`);
      asking(text.trim());
      return run;
    }
    if (!run || run.status !== "waiting" || !run.waiting || !run.currentNodeId) throw new Error("That run is not waiting for an answer");
    const node = this.node(run, run.currentNodeId);
    const reason = run.waiting.reason;
    const question = run.waiting.question;
    const limitKey = run.waiting.limitKey;
    run.waiting = null;
    if (reason === "limit" && /^\s*stop\s*$/i.test(text)) return this.finish(run, "stopped");

    const step = this.beginStep(run, node, reason === "human" ? node.label : "Your answer");
    this.endStep(step, reason === "human" ? "answered" : "next", `Question: ${question}\nAnswer: ${text.trim()}`);
    if (reason === "human") {
      const edge = run.workflow.edges.find((e) => e.from === node.id && e.outcome === "answered");
      if (!edge) return this.finish(run, "failed", `"${node.label}" has no "Answered" edge`);
      run.currentNodeId = edge.to;
    } else if (reason === "limit") {
      run.rounds[limitKey ?? node.id] = 0;
      // The person's direction is a fresh start for every loop that was handed up.
      run.escalated = {};
    }
    // "ask": the step that asked runs again, with the answer as its handoff.
    run.status = "running";
    await this.save(run);
    void this.drive(run);
    return run;
  }

  async stop(runId: string): Promise<WorkflowRun> {
    const run = await this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    const live = this.live.get(runId);
    if (live) {
      live.stopped = true;
      for (const sessionId of live.sessions) this.deps.pendingTurns.get(sessionId)?.abort();
    }
    if (run.status === "running" || run.status === "waiting") return this.finish(run, "stopped");
    return run;
  }

  // ── The loop ──────────────────────────────────────────────────────────

  private async drive(run: WorkflowRun): Promise<void> {
    const live = { stopped: false, sessions: new Set<string>() };
    this.live.set(run.id, live);
    try {
      while (run.status === "running" && run.currentNodeId && !live.stopped) {
        const node = this.node(run, run.currentNodeId);
        if (node.kind === "end") {
          await this.finish(run, node.config.result === "failed" ? "failed" : "done");
          return;
        }
        if (node.kind === "human") {
          const question = this.questionFor(run, node);
          // What a local-only step found goes to the person, not the Lead.
          const lead = node.config.askLeadFirst && !this.lastHeldBack(run) ? await this.leadOf(run) : null;
          if (lead) {
            // The Lead answers first; only what is the person's call reaches them.
            const step = this.beginStep(run, node, `${node.label} (Lead)`);
            await this.save(run);
            const reply = await consultLead(this.deps, lead, `the workflow "${run.workflow.name}" (run ${run.id})`, question);
            if ("answer" in reply) {
              this.endStep(step, "answered", `Question: ${question}\nLead's answer: ${reply.answer}`);
              const edge = run.workflow.edges.find((e) => e.from === node.id && e.outcome === "answered");
              if (!edge) {
                await this.finish(run, "failed", `"${node.label}" has no "Answered" edge`);
                return;
              }
              run.currentNodeId = edge.to;
              await this.save(run);
              continue;
            }
            this.endStep(step, null, `The Lead passed it to you: ${reply.escalate}`);
            await this.wait(run, reply.escalate, "human");
            return;
          }
          await this.wait(run, question, "human", undefined, this.lastHeldBack(run));
          return;
        }
        const step = this.beginStep(run, node, node.label);
        await this.save(run);
        let result: StepResult;
        try {
          result = await this.execute(run, node, live);
        } catch (error) {
          if (error instanceof RunStopped || live.stopped) return;
          this.endStep(step, null, "", error instanceof Error ? error.message : String(error));
          await this.finish(run, "failed", `"${node.label}" failed: ${step.error}`);
          return;
        }
        if (live.stopped) return;
        step.sessionIds = result.sessionIds;
        this.endStep(step, result.outcome, result.summary);
        if (run.escalation?.nodeId === node.id) run.escalation = null;
        if (result.followUps?.length) {
          run.followUps = [...(run.followUps ?? []), ...result.followUps.map((text) => ({ nodeId: node.id, label: node.label, text }))];
        }

        const edge = run.workflow.edges.find((e) => e.from === node.id && e.outcome === result.outcome);
        if (!edge) {
          // A question with nowhere to go comes to the person.
          if (result.outcome === "ask") await this.wait(run, result.summary || `"${node.label}" has a question.`, "ask", undefined, this.heldBack(run, node.id));
          else await this.finish(run, "failed", `"${node.label}" ended in "${result.outcome}", which leads nowhere`);
          return;
        }
        run.currentNodeId = edge.to;
        // Leaving a loop means it finished: a later stall there starts afresh.
        for (const cycle of cyclesOf(run.workflow, node.id)) {
          if (!cycle.nodeIds.includes(edge.to) && run.escalated?.[cycle.id]) delete run.escalated[cycle.id];
        }
        const stall = this.stall(run, node, step, result) ?? this.nextRound(run, node, edge.to);
        if (stall) {
          const loop = stall.loop ?? null;
          if (!loop) {
            // Not inside a loop at all: nothing to hand it up to.
            await this.wait(run, `${stall.reason}. Answer to go on (your note goes along).`, "limit", node.id);
            return;
          }
          if (await this.handUp(run, loop, stall.reason, step)) return;
        }
        await this.save(run);
      }
    } catch (error) {
      log(`workflow run ${run.id} broke: ${String(error)}`);
      await this.finish(run, "failed", String(error)).catch(() => undefined);
    } finally {
      if (this.live.get(run.id) === live) this.live.delete(run.id);
    }
  }

  private async execute(run: WorkflowRun, node: WorkflowNode, live: { stopped: boolean; sessions: Set<string> }): Promise<StepResult> {
    if (node.kind === "check" || (node.kind === "custom" && node.config.runner === "command")) {
      return this.runCommand(run, node);
    }
    const outcomes = workflowOutcomes(node);
    const prompt = this.prompt(run, node, outcomes);
    const maxAgents = node.config.runBy === "lead" ? 0 : Math.max(0, Math.min(16, node.config.maxAgents ?? 0));
    const step = stepOptions(node.config.tools, outcomes, maxAgents > 0);
    const guards = this.guardsFor(run, node);
    if (guards.length > 0) step.guards = guards;
    const dataDirs = await this.dataDirs(run, node);
    if (dataDirs.length > 0) step.additionalDirectories = dataDirs;
    const turn = async (sessionId: string, index: number): Promise<TurnResult> => {
      live.sessions.add(sessionId);
      try {
        const result = await this.deps.runStepTurn(sessionId, prompt, step);
        if (live.stopped) throw new RunStopped();
        // Another message in that chat (the person writing to the Lead mid-step) cuts the turn short.
        if (result.stopReason === "cancelled") throw new Error("The step's turn was cut short by another message in its chat");
        let parsed = parseVerdict(result.structured, outcomes) ?? parseVerdict(verdictInText(result.text), outcomes);
        if (!parsed && stepAgent(node)) {
          // Another agent that forgot the closing JSON is asked for it once, rather than guessed.
          const again = await this.deps.runStepTurn(sessionId, verdictReminder(outcomes), step);
          if (live.stopped) throw new RunStopped();
          parsed = parseVerdict(verdictInText(again.text), outcomes);
        }
        return { ...(parsed ?? { outcome: fallbackOutcome(outcomes), summary: result.text }), index };
      } finally {
        live.sessions.delete(sessionId);
      }
    };

    if (node.config.runBy === "lead") {
      // The Lead plans or checks in its own chat, after any turn it is already in.
      const lead = await this.leadOf(run);
      if (!lead) throw new Error(`"${node.label}" is run by the Lead, but the project has no Lead chat`);
      while (this.deps.pendingTurns.has(lead) && !live.stopped) await Bun.sleep(2000);
      if (live.stopped) throw new RunStopped();
      // The Lead works from its own checkout; the run's worktree is where the change is.
      const runPath = this.deps.workspaces.workspacePath(run.workspaceId);
      if (runPath) step.additionalDirectories = [runPath, ...dataDirs];
      const { index: _, ...result } = await turn(lead, 0);
      return { ...result, sessionIds: [lead] };
    }

    const count = Math.max(1, Math.min(8, node.config.parallel?.count ?? 1));
    const join = node.config.parallel?.join ?? "all";
    const workspaces = await this.stepWorkspaces(run, node, count);
    const keep = node.kind === "agent" ? (node.config.session ?? "keep") === "keep" : false;
    const kept = keep ? (run.sessionsByNode[node.id] ?? []) : [];
    const sessionIds = workspaces.map((ws, i) => {
      const existing = kept[i] && this.deps.sessions.get(kept[i]!);
      if (existing && existing.workspaceId === ws.id && (existing.agent ?? "claude") === (stepAgent(node) ?? "claude")) return existing.id;
      const record = this.deps.sessions.create({
        workspaceId: ws.id,
        cwd: ws.path,
        title: `${node.label}${count > 1 ? ` ${i + 1}` : ""} · ${run.workflow.name}`,
        ...(stepAgent(node) ? { agent: stepAgent(node) } : {}),
        // Agents edit their own worktree without asking each time; reviewers only read.
        options: { model: null, effort: null, permissionMode: node.kind === "review" ? "default" : "acceptEdits" },
      });
      return record.id;
    });
    if (keep) run.sessionsByNode[node.id] = sessionIds;
    await this.save(run);
    const helpers: string[] = [];
    if (maxAgents > 0) {
      const { outputFormat: _, ...helperStep } = step;
      const slots = new Slots(maxAgents);
      sessionIds.forEach((id, i) => this.spawners.set(id, { run, node, live, workspace: workspaces[i]!, step: helperStep, slots, helpers }));
    }
    try {
      return await this.runSessions(run, node, sessionIds, workspaces, turn, count, join, helpers);
    } finally {
      for (const id of sessionIds) this.spawners.delete(id);
    }
  }

  /** A limited outcome past the step's limit, or the same failure twice in a row. */
  private stall(run: WorkflowRun, node: WorkflowNode, step: WorkflowRunStep, result: StepResult): { loop?: WorkflowCycle; reason: string } | null {
    if (!LIMITED.includes(result.outcome)) return null;
    const loop = cyclesOf(run.workflow, node.id)[0];
    const limit = node.config.maxRounds;
    if (limit) {
      run.rounds[node.id] = (run.rounds[node.id] ?? 0) + 1;
      if (run.rounds[node.id]! > limit) return { loop, reason: `"${node.label}" sent it back ${limit} time${limit > 1 ? "s" : ""}` };
    }
    if (result.repeated) return { loop, reason: `"${node.label}" found the same blocking problem again` };
    const before = run.steps.filter((s) => s.nodeId === node.id && s !== step && s.endedAt !== null && s.outcome).at(-1);
    if (before && before.outcome === result.outcome && before.summary === step.summary && node.kind !== "review") {
      return { loop, reason: `"${node.label}" failed the same way twice in a row` };
    }
    return null;
  }

  /** Coming back to a loop's first step from inside it is the loop's next round; past its limit it stalls. */
  private nextRound(run: WorkflowRun, node: WorkflowNode, to: string): { loop: WorkflowCycle; reason: string } | null {
    for (const cycle of cyclesOf(run.workflow, to)) {
      if (cycle.id !== to || !cycle.nodeIds.includes(node.id)) continue;
      const key = `cycle:${cycle.id}`;
      run.rounds[key] = (run.rounds[key] ?? 0) + 1;
      if (cycle.maxRounds && run.rounds[key]! >= cycle.maxRounds) {
        return { loop: cycle, reason: `"${cycle.label}" used its ${cycle.maxRounds} round${cycle.maxRounds > 1 ? "s" : ""}` };
      }
    }
    return null;
  }

  /**
   * A loop that cannot finish goes to the loop around it: that loop's first step runs next, told why,
   * and the stalled loop starts its count afresh. A loop handed up once that stalls again before
   * finishing goes higher still; the outermost asks the person. True when the run now waits.
   */
  private async handUp(run: WorkflowRun, loop: WorkflowCycle, reason: string, step: WorkflowRunStep): Promise<boolean> {
    const cycles = cyclesOf(run.workflow, loop.id);
    let current = loop;
    let why = reason;
    for (;;) {
      run.rounds[`cycle:${current.id}`] = 0;
      for (const id of current.nodeIds) delete run.rounds[id];
      const parent = current.parentId ? cycles.find((c) => c.id === current.parentId) : undefined;
      const entry = this.node(run, current.id);
      if (!parent) {
        step.summary = `${step.summary}\n\n↑ Handed to you: ${why}.`.trim();
        run.currentNodeId = current.id;
        await this.wait(
          run,
          `The loop "${current.label}" cannot finish on its own: ${why}. Say how it should go on; your note goes to "${entry.label}", where the loop starts again.`,
          "limit",
          `cycle:${current.id}`,
        );
        return true;
      }
      if (run.escalated?.[current.id]) {
        why = `"${current.label}" stalled again after it was rethought (${why})`;
        current = parent;
        continue;
      }
      run.escalated = { ...run.escalated, [current.id]: why };
      const target = this.node(run, parent.id);
      const last = runsLocally(target) || !this.heldBack(run, step.nodeId) ? step.summary.slice(0, 1500) : withheld(step.label);
      run.escalation = {
        nodeId: parent.id,
        text: [
          `The loop "${current.label}" could not finish: ${why}.`,
          `Its last result ("${step.label}"): ${last}`,
          "Rethink it so the loop can finish: split or narrow the work, give concrete direction, or change what counts as done (say so plainly).",
        ].join("\n"),
      };
      step.summary = `${step.summary}\n\n↑ Handed up to "${target.label}": ${why}.`.trim();
      run.currentNodeId = parent.id;
      // Going back to the outer loop's first step is a round of that loop.
      const key = `cycle:${parent.id}`;
      run.rounds[key] = (run.rounds[key] ?? 0) + 1;
      if (parent.maxRounds && run.rounds[key]! >= parent.maxRounds) {
        why = `"${parent.label}" used its ${parent.maxRounds} rounds`;
        current = parent;
        continue;
      }
      this.tellLead(run, `Workflow "${run.workflow.name}" (run ${run.id}): the loop "${current.label}" was handed up to "${target.label}": ${why}.`);
      return false;
    }
  }

  private async runSessions(
    run: WorkflowRun,
    node: WorkflowNode,
    sessionIds: string[],
    workspaces: Workspace[],
    turn: (sessionId: string, index: number) => Promise<TurnResult>,
    count: number,
    join: "all" | "majority" | "any" | "first",
    helpers: string[],
  ): Promise<StepResult> {
    if (count > 1 && join === "first") {
      const winner = await Promise.any(sessionIds.map((id, i) => turn(id, i)));
      for (const [i, id] of sessionIds.entries()) if (i !== winner.index) this.deps.pendingTurns.get(id)?.abort();
      // The winner's worktree carries the run on.
      const ws = workspaces[winner.index];
      if (ws && node.config.workspace !== "main") run.workspaceId = ws.id;
      const { index: _, ...verdict } = winner;
      return { ...verdict, sessionIds: [...sessionIds, ...helpers] };
    }
    const results = await Promise.all(sessionIds.map((id, i) => turn(id, i)));
    const summary =
      results.length === 1
        ? results[0]!.summary
        : results
            .map((r) => `${node.label} ${r.index + 1} (${r.outcome}, in ${workspaces[r.index]?.path ?? "?"}): ${r.summary}`)
            .join("\n\n");
    const followUps = results.flatMap((r) => r.followUps ?? []);
    return {
      outcome: combine(node, results.map((r) => r.outcome), join),
      summary,
      sessionIds: [...sessionIds, ...helpers],
      ...(followUps.length > 0 ? { followUps } : {}),
      ...(results.some((r) => r.repeated) ? { repeated: true } : {}),
    };
  }

  /** spawn_agents: helpers on parts of a step, in the step's folder, at most the step's cap at once. */
  private async spawnAgents(caller: string, args: Record<string, unknown>): Promise<ManagerCallResult> {
    const spawner = this.spawners.get(caller);
    if (!spawner) return { result: "Only a workflow step that allows helper agents can spawn them.", isError: true };
    const tasks = (Array.isArray(args.tasks) ? args.tasks : []).flatMap((t: unknown) => {
      const entry = typeof t === "string" ? { task: t } : typeof t === "object" && t !== null ? (t as Record<string, unknown>) : {};
      const task = typeof entry.task === "string" ? entry.task.trim() : "";
      const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : task.slice(0, 40);
      return task ? [{ task, title }] : [];
    });
    if (tasks.length === 0) return { result: "Give at least one task.", isError: true };
    const reports = await Promise.all(tasks.map((t) => spawner.slots.run(() => this.runHelper(spawner, t))));
    return { result: reports.map((r, i) => `## ${i + 1}. ${tasks[i]!.title}\n${r}`).join("\n\n") };
  }

  private async runHelper(spawner: Spawner, part: { task: string; title: string }): Promise<string> {
    const { run, node, live, workspace } = spawner;
    if (live.stopped) return "Not run: the workflow was stopped.";
    const record = this.deps.sessions.create({
      workspaceId: workspace.id,
      cwd: workspace.path,
      title: `${node.label} · helper: ${part.title}`,
      ...(stepAgent(node) ? { agent: stepAgent(node) } : {}),
      options: { model: null, effort: null, permissionMode: node.kind === "review" ? "default" : "acceptEdits" },
    });
    spawner.helpers.push(record.id);
    run.steps.at(-1)?.sessionIds.push(record.id);
    await this.save(run);
    const text = [
      `You are a helper agent in the workflow "${run.workflow.name}", step "${node.label}", run by Zomfy.`,
      "Other helpers work in this same folder at the same time, each on its own part. Change only what your part needs, and do not commit; the step's agent integrates and commits.",
      "",
      "Task of the run:",
      run.task,
      "",
      `Your part (${part.title}):`,
      part.task,
      "",
      "Finish with a short report: what you changed (files), how you checked it, and anything left open.",
    ].join("\n");
    live.sessions.add(record.id);
    try {
      const result = await this.deps.runStepTurn(record.id, text, spawner.step);
      if (live.stopped) return "Stopped with the workflow.";
      return result.text.trim() || `Ended (${result.stopReason}) without a report.`;
    } catch (error) {
      return `Failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      live.sessions.delete(record.id);
    }
  }

  private prompt(run: WorkflowRun, node: WorkflowNode, outcomes: WorkflowOutcome[]): string {
    const handoff = run.steps
      .slice(0, -1)
      .reverse()
      .find((s) => s.endedAt !== null && s.summary.trim());
    const fields = node.config.fields ?? [];
    const fill = (text: string) =>
      text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (all, key: string) => {
        const field = fields.find((f) => f.key === key);
        return field ? String(field.value) : all;
      });
    const lines = [
      `You are the ${node.config.role?.trim() || node.label} in the workflow "${run.workflow.name}", step "${node.label}", run by Zomfy.`,
      "",
      "Task of this run:",
      run.task,
    ];
    if (handoff) {
      const summary = runsLocally(node) || !this.heldBack(run, handoff.nodeId) ? handoff.summary : withheld(handoff.label);
      lines.push("", `Handoff from "${handoff.label}" (${handoff.outcome ?? "no outcome"}):`, summary);
    }
    const data = this.dataOf(run, node);
    if (data.length > 0) {
      lines.push(
        "",
        "Data for this step (other files and folders the workflow lists are not yours to open):",
        ...data.map(
          ({ source, link }) =>
            `- ${source.name}: ${source.path} (${link.write ? "you may change it" : "read only"})${source.note?.trim() ? `. ${source.note.trim()}` : ""}${source.localOnly ? ". Local only: do not copy it into the workspace, commits or messages to others" : ""}`,
        ),
      );
    }
    if (node.config.prompt?.trim()) lines.push("", "Your instructions:", fill(node.config.prompt.trim()));
    if (fields.length > 0) lines.push("", "Settings:", ...fields.map((f) => `- ${f.label || f.key} (${f.key}): ${String(f.value)}`));
    const rounds = run.rounds[node.id];
    if (rounds) lines.push("", `This is round ${rounds + 1} of this step.`);
    if (run.escalation?.nodeId === node.id) lines.push("", "Handed up to you:", run.escalation.text);
    const earlier = run.steps.filter((s) => s.nodeId === node.id && s.endedAt !== null && s.outcome);
    if (node.kind === "review" && earlier.length > 0) {
      // Later rounds converge: only what blocks sends it back; the rest waits for the end.
      lines.push(
        "",
        `This is review round ${earlier.length + 1}. Choose "changes" only for blocking findings: wrong behaviour, a missing requirement, failing checks. Put anything else in "followUps"; the person gets those when the run ends.`,
        "Your findings last round:",
        earlier.at(-1)!.summary.slice(0, 2000),
        `Set "repeated" to true when a blocking finding you raise now is one of those and is still not fixed.`,
      );
    }
    const resultFields = `"outcome" is one of ${outcomes.map((o) => `"${o}"`).join(", ")}, and "summary" is what the next step needs (what you did or found, concretely)`;
    if (stepAgent(node)) {
      // Other agents have no structured output: the result is a JSON object closing their reply.
      const extra = outcomes.includes("changes") ? ', optionally "followUps" (strings) and "repeated" (true/false)' : "";
      lines.push("", `When you are done, end your reply with your result as one JSON object on its own lines: ${resultFields}${extra}.`);
    } else {
      lines.push("", `When you are done, give your result as the structured output: ${resultFields}.`);
    }
    if (this.heldBack(run, node.id)) {
      lines.push(`This step works with local-only data, which the project's Lead may not see: do not call ask_lead. If you cannot go on, choose the "ask" outcome; the person answers.`);
    } else {
      lines.push(
        "Need a decision or context mid-task? Call the harness tool ask_lead: the project's Lead answers (or passes it to the person), and you carry on with the answer.",
      );
    }
    const maxAgents = node.config.maxAgents ?? 0;
    if (maxAgents > 0 && node.config.runBy !== "lead") {
      lines.push(
        `You may split the work: the harness tool spawn_agents runs helper agents on parts you describe, up to ${maxAgents} at once, and returns their reports. Use it when parts are independent; integrate, verify and commit their work yourself.`,
      );
    }
    if (outcomes.includes("ask")) lines.push(`Choose the "ask" outcome only when you cannot go on at all; put the question in "summary".`);
    if (node.kind === "review") lines.push(`Choose "approve" when it is ready; "changes" with every finding the developer must address.`);
    return lines.join("\n");
  }

  // ── Steps that are not sessions ───────────────────────────────────────

  private async runCommand(run: WorkflowRun, node: WorkflowNode): Promise<StepResult> {
    const fields = node.config.fields ?? [];
    const command = (node.config.command ?? "").replace(/\{\{\s*([\w-]+)\s*\}\}/g, (all, key: string) => {
      const field = fields.find((f) => f.key === key);
      return field ? String(field.value) : all;
    });
    if (!command.trim()) throw new Error("No command to run");
    const cwd = this.workspacePath(node.config.workspace === "main" ? await this.mainWorkspace(run.projectId) : run.workspaceId);
    // cmd.exe reads its command line as typed: quoting it as an argument would mangle the command's own quotes.
    const windows = process.platform === "win32";
    const argv = windows ? ["cmd.exe", "/d", "/s", "/c", `"${command}"`] : ["bash", "-lc", command];
    const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true, windowsVerbatimArguments: windows });
    const timer = setTimeout(() => proc.kill(), CHECK_TIMEOUT_MS);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).finally(() => clearTimeout(timer));
    const output = `${stdout}${stderr}`.trim();
    const tail = output.length > OUTPUT_TAIL ? `…${output.slice(-OUTPUT_TAIL)}` : output;
    const own = (node.config.outcomes ?? []).filter((o) => o.trim());
    if (node.kind === "custom" && own.length > 0) {
      // A command with its own outcomes names one on its last line.
      const last = output.split("\n").at(-1)?.trim() ?? "";
      const outcome = own.find((o) => o === last);
      if (!outcome) throw new Error(`The command's last line "${last}" is none of ${own.join(", ")}`);
      return { outcome, summary: `$ ${command} (exit ${code})\n${tail}`, sessionIds: [] };
    }
    return { outcome: code === 0 ? "pass" : "fail", summary: `$ ${command} (exit ${code})\n${tail}`, sessionIds: [] };
  }

  // ── Workspaces ─────────────────────────────────────────────────────────

  /** A git project's runs get a worktree of their own; a folder project's run in its folder. */
  private async runWorkspace(projectId: string, workflow: Workflow, runId: string): Promise<Workspace> {
    const state = await this.deps.workspaces.snapshot();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) throw new Error(`Unknown project ${projectId}`);
    const usesWorktree = workflow.nodes.some((n) => n.kind !== "start" && n.kind !== "end" && (n.config.workspace ?? "run-worktree") === "run-worktree");
    if (project.kind !== "git" || !usesWorktree) return this.requireWorkspace(state.workspaces, await this.mainWorkspace(projectId));
    const name = sanitizeWorkspaceName(`${workflow.name}-${runId.slice(0, 6)}`);
    return this.deps.workspaces.createWorkspace({ projectId, name, comment: `Workflow run: ${workflow.name}`, runSetup: false });
  }

  /** One workspace per parallel session: the run's (or main), plus worktrees off its branch for the others. */
  private async stepWorkspaces(run: WorkflowRun, node: WorkflowNode, count: number): Promise<Workspace[]> {
    const state = await this.deps.workspaces.snapshot();
    const base = this.requireWorkspace(
      state.workspaces,
      node.config.workspace === "main" ? await this.mainWorkspace(run.projectId) : run.workspaceId,
    );
    // Reviewers only read, so they share; parallel writers each get a worktree.
    if (count === 1 || node.kind === "review") return Array.from({ length: count }, () => base);
    const project = state.projects.find((p) => p.id === run.projectId);
    if (project?.kind !== "git") return Array.from({ length: count }, () => base);
    const extra = await Promise.all(
      Array.from({ length: count - 1 }, (_, i) =>
        this.deps.workspaces.createWorkspace({
          projectId: run.projectId,
          name: sanitizeWorkspaceName(`${base.name}-${node.label}-${i + 2}-${run.steps.length}`),
          ...(base.branch ? { baseRef: base.branch } : {}),
          parentWorkspaceId: base.id,
          runSetup: false,
        }),
      ),
    );
    return [base, ...extra];
  }

  private async mainWorkspace(projectId: string): Promise<string> {
    const state = await this.deps.workspaces.snapshot();
    const main = state.workspaces.find((w) => w.projectId === projectId && w.isPrimary);
    if (!main) throw new Error("The project has no main workspace");
    return main.id;
  }

  private requireWorkspace(list: Workspace[], id: string): Workspace {
    const found = list.find((w) => w.id === id);
    if (!found) throw new Error(`The run's workspace ${id} is gone`);
    return found;
  }

  private workspacePath(id: string): string {
    const path = this.deps.workspaces.workspacePath(id);
    if (!path) throw new Error(`The run's workspace ${id} is gone`);
    return path;
  }

  // ── Data ───────────────────────────────────────────────────────────────

  /** The data sources linked to the step. */
  private dataOf(run: WorkflowRun, node: WorkflowNode): { source: WorkflowDataSource; link: WorkflowDataLink }[] {
    const sources = run.workflow.data ?? [];
    return (run.workflow.dataLinks ?? []).flatMap((link) => {
      const source = link.nodeId === node.id ? sources.find((d) => d.id === link.dataId) : undefined;
      return source ? [{ source, link }] : [];
    });
  }

  /** Every other source is out of bounds; one it may only read is not to be changed. */
  private guardsFor(run: WorkflowRun, node: WorkflowNode): PathGuard[] {
    const mine = this.dataOf(run, node);
    return (run.workflow.data ?? []).flatMap((source): PathGuard[] => {
      const link = mine.find((m) => m.source.id === source.id)?.link;
      if (link?.write || !source.path.trim()) return [];
      return [{ path: source.path.trim(), name: source.name, allow: link ? "read" : "none" }];
    });
  }

  /** Folders outside the workspace the step's data lives in, so reading them needs no approval. */
  private async dataDirs(run: WorkflowRun, node: WorkflowNode): Promise<string[]> {
    const paths = this.dataOf(run, node).map((d) => d.source.path.trim()).filter(isAbsolutePath);
    return Promise.all(paths.map(async (path) => ((await stat(path).catch(() => null))?.isFile() ? dirname(path) : path)));
  }

  /** The step may hold what was learned from local-only data. */
  private heldBack(run: WorkflowRun, nodeId: string): boolean {
    return localOnlySteps(run.workflow).has(nodeId);
  }

  /** The latest result handed on came from a step that may hold local-only data. */
  private lastHeldBack(run: WorkflowRun): boolean {
    const last = run.steps.filter((s) => s.endedAt !== null && s.summary.trim()).at(-1);
    return !!last && this.heldBack(run, last.nodeId);
  }

  // ── Bookkeeping ────────────────────────────────────────────────────────

  private node(run: WorkflowRun, id: string): WorkflowNode {
    const node = run.workflow.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`The workflow has no step ${id}`);
    return node;
  }

  private beginStep(run: WorkflowRun, node: WorkflowNode, label: string): WorkflowRunStep {
    const step: WorkflowRunStep = {
      id: crypto.randomUUID(),
      nodeId: node.id,
      label,
      startedAt: Date.now(),
      endedAt: null,
      outcome: null,
      summary: "",
      sessionIds: [],
    };
    run.steps.push(step);
    return step;
  }

  private endStep(step: WorkflowRunStep, outcome: WorkflowOutcome | null, summary: string, error?: string): void {
    step.endedAt = Date.now();
    step.outcome = outcome;
    step.summary = summary.trim();
    if (error) step.error = error;
  }

  /** An Ask step's question, with what the step before it handed on when the step has none of its own. */
  private questionFor(run: WorkflowRun, node: WorkflowNode): string {
    const last = run.steps.filter((s) => s.endedAt !== null && s.summary.trim()).at(-1);
    const own = node.config.question?.trim();
    if (own && last) return `${own}\n\nFrom "${last.label}": ${last.summary}`;
    return own || (last ? `From "${last.label}": ${last.summary}` : `"${node.label}" needs your decision.`);
  }

  private async leadOf(run: WorkflowRun): Promise<string | null> {
    const state = await this.deps.workspaces.snapshot();
    const ids = new Set(state.workspaces.filter((w) => w.projectId === run.projectId).map((w) => w.id));
    return this.deps.sessions.all().find((s) => s.role === "lead" && s.workspaceId !== null && ids.has(s.workspaceId))?.id ?? null;
  }

  /** `secret`: the question holds local-only work, so the Lead only hears that the run waits. */
  private async wait(run: WorkflowRun, question: string, reason: "human" | "ask" | "limit", limitKey?: string, secret = false): Promise<void> {
    run.status = "waiting";
    run.waiting = { question, reason, ...(limitKey ? { limitKey } : {}) };
    await this.save(run);
    this.tellLead(run, `Workflow "${run.workflow.name}" (run ${run.id}) is waiting for the person: ${secret ? "(the question is withheld: it holds local-only data)" : question}`);
  }

  private async finish(run: WorkflowRun, status: "done" | "failed" | "stopped", why?: string): Promise<WorkflowRun> {
    run.status = status;
    run.waiting = null;
    run.endedAt = Date.now();
    if (why) {
      const last = run.steps.at(-1);
      if (last && !last.error && status === "failed") last.error = why;
    }
    await this.save(run);
    const last = run.steps.filter((s) => s.summary && !this.heldBack(run, s.nodeId)).at(-1);
    const later = (run.followUps ?? []).filter((f) => !this.heldBack(run, f.nodeId));
    this.tellLead(
      run,
      `Workflow "${run.workflow.name}" (run ${run.id}) ${status === "done" ? "finished" : status}${why ? `: ${why}` : ""}.${last ? ` Last step "${last.label}": ${last.summary.slice(0, 400)}` : ""}${later.length > 0 ? `\nLeft for later (${later.length}):\n${later.map((f) => `- ${f.label}: ${f.text}`).join("\n").slice(0, 1500)}` : ""}`,
    );
    return run;
  }

  private async save(run: WorkflowRun): Promise<void> {
    await this.runs.save(run);
    this.deps.broadcast(WORKFLOW_NOTIFICATIONS.workflowRunChanged, run);
  }

  /** The project's Lead hears about its runs, as it hears about the person's prompts. */
  private tellLead(run: WorkflowRun, text: string): void {
    void this.leadOf(run)
      .then((lead) => {
        if (lead) noteActivity(this.deps.sessions, lead, text);
      })
      .catch(() => undefined);
  }
}

const withheld = (label: string) => `(withheld: "${label}" worked with local-only data, which this step may not see)`;

/** The structured result every session step must give. */
function verdictSchema(outcomes: WorkflowOutcome[]): Record<string, unknown> {
  // Steps that can send work back also report what can wait and whether they are going round in circles.
  const review = outcomes.includes("changes")
    ? {
        followUps: { type: "array", items: { type: "string" }, description: "Non-blocking findings for later." },
        repeated: { type: "boolean", description: "A blocking finding from last round is still not fixed." },
      }
    : {};
  return {
    type: "object",
    properties: {
      outcome: { type: "string", enum: outcomes },
      summary: { type: "string" },
      ...review,
    },
    required: ["outcome", "summary"],
    additionalProperties: false,
  };
}

function parseVerdict(value: unknown, outcomes: WorkflowOutcome[]): Verdict | null {
  if (!value || typeof value !== "object") return null;
  const outcome = "outcome" in value ? value.outcome : undefined;
  const summary = "summary" in value ? value.summary : undefined;
  if (typeof outcome !== "string" || !outcomes.includes(outcome)) return null;
  const followUps = "followUps" in value && Array.isArray(value.followUps) ? value.followUps.filter((f): f is string => typeof f === "string" && !!f.trim()) : [];
  return {
    outcome,
    summary: typeof summary === "string" ? summary : "",
    ...(followUps.length > 0 ? { followUps } : {}),
    ...("repeated" in value && value.repeated === true ? { repeated: true } : {}),
  };
}

/** The agent a session step runs on when not Claude; the Lead's own steps are always its chat. */
function stepAgent(node: WorkflowNode): ChatAgentId | undefined {
  const agent = node.config.agent;
  return node.config.runBy !== "lead" && agent && agent !== "claude" ? agent : undefined;
}

/** The last JSON object in an agent's reply that carries an "outcome", fenced or bare. */
export function verdictInText(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!).reverse();
  const end = text.lastIndexOf("}");
  const bare = end < 0 ? [] : [...text.slice(0, end).matchAll(/\{/g)].map((m) => text.slice(m.index, end + 1)).reverse().slice(0, 40);
  for (const candidate of [...fenced, ...bare]) {
    try {
      const value: unknown = JSON.parse(candidate.trim());
      if (value && typeof value === "object" && "outcome" in value) return value;
    } catch {
      // Not this one.
    }
  }
  return null;
}

function verdictReminder(outcomes: WorkflowOutcome[]): string {
  return `Your reply did not end with the result. Reply with only one JSON object: {"outcome": one of ${outcomes.map((o) => `"${o}"`).join(", ")}, "summary": what the next step needs}.`;
}

/** Without a usable verdict a step goes the plain way on (or fails a review, which must decide). */
function fallbackOutcome(outcomes: WorkflowOutcome[]): WorkflowOutcome {
  if (outcomes.includes("changes")) return "changes";
  return outcomes.find((o) => o !== "ask") ?? outcomes[0] ?? "next";
}

/** Several sessions' outcomes as the step's one. */
function combine(node: WorkflowNode, outcomes: WorkflowOutcome[], join: "all" | "majority" | "any" | "first"): WorkflowOutcome {
  if (outcomes.length === 1) return outcomes[0]!;
  if (node.kind === "review") {
    const approvals = outcomes.filter((o) => o === "approve").length;
    const approved = join === "any" ? approvals > 0 : join === "majority" ? approvals * 2 > outcomes.length : approvals === outcomes.length;
    if (approved) return "approve";
    return outcomes.includes("changes") ? "changes" : "ask";
  }
  // Work steps: a question from any session stops for it; otherwise the most common outcome.
  if (outcomes.includes("ask")) return "ask";
  const counts = new Map<WorkflowOutcome, number>();
  for (const o of outcomes) counts.set(o, (counts.get(o) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/** Claude's shell tool is PowerShell on Windows; a Bash(...) rule means the same command there. */
function withShellTwins(rules: string[]): string[] {
  if (process.platform !== "win32") return rules;
  return [...rules, ...rules.filter((r) => r.startsWith("Bash(")).map((r) => `PowerShell(${r.slice(5)}`)];
}

const PLAYWRIGHT_MCP = { type: "stdio" as const, command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless"] };

/** Claude's own subagent tool; a step that spawns through the harness (and its cap) goes without it. */
const BUILTIN_SUBAGENT_TOOLS = ["Agent", "Task"];

/** A step's tool policy as the options its turn runs with. */
function stepOptions(tools: WorkflowToolPolicy | undefined, outcomes: WorkflowOutcome[], spawns = false): StepOptions {
  const mcpServers: NonNullable<StepOptions["mcpServers"]> = {};
  const allowed: string[] = [];
  for (const server of tools?.mcp ?? []) {
    const name = server.name.trim() || server.preset || "server";
    if (server.preset === "playwright") {
      mcpServers[name] = PLAYWRIGHT_MCP;
      // Looking at the page is the point of giving a reviewer a browser; it should not ask each time.
      allowed.push(`mcp__${name}`);
    } else if (server.command?.trim()) {
      mcpServers[name] = { type: "stdio", command: server.command.trim(), args: server.args ?? [] };
    }
  }
  const deny = withShellTwins([
    ...(tools?.deny ?? []),
    ...(tools?.readOnly ? ["Edit", "Write", "NotebookEdit", "MultiEdit"] : []),
    ...(spawns ? BUILTIN_SUBAGENT_TOOLS : []),
  ]);
  const allow = withShellTwins([...allowed, ...(tools?.allow ?? [])]);
  return {
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    ...(tools?.strictMcp ? { strictMcpConfig: true } : {}),
    ...(tools?.skills ? { skills: tools.skills } : {}),
    ...(allow.length ? { allowedTools: allow } : {}),
    ...(deny.length ? { disallowedTools: deny } : {}),
    outputFormat: { type: "json_schema", schema: verdictSchema(outcomes) },
  };
}
