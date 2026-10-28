import {
  cyclesOf,
  isAbsolutePath,
  localOnlySteps,
  resolveWorkflowAgents,
  runsLocally,
  withoutSkills,
  workflowAccessIssues,
  WORKFLOW_META,
  WORKFLOW_NOTIFICATIONS,
  workflowOutcomes,
  type ManagerCallResult,
  type Workflow,
  type ChatAgentId,
  type WorkflowContextRemoval,
  type WorkflowCycle,
  type WorkflowDataLink,
  type WorkflowDataSource,
  type WorkflowNode,
  type WorkflowOutcome,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowStepContext,
  type WorkflowStepUsage,
  type WorkflowToolPolicy,
  type Workspace,
} from "@acp-harness/protocol";
import type { StepOptions } from "./claude-turn.ts";
import type { HandlerContext, StepToolUse } from "./handlers/handler-context.ts";
import { noteActivity } from "./session-activity.ts";
import { consultRequester } from "./requester-consult.ts";
import type { WorkflowRunStore } from "./workflow-run-store.ts";
import type { WorkflowStore } from "./workflow-store.ts";
import type { WorkflowAgentStore } from "./workflow-agent-store.ts";
import { expandHome, type PathGuard } from "./step-path-guard.ts";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { sanitizeWorkspaceName } from "./worktree-naming.ts";
import { log } from "./log.ts";
import { killTree, trackChild } from "./process-tree.ts";
import { git, GitError } from "./git-cli.ts";

// Runs a workflow graph: the engine, not a model, picks each next step. Agent steps are chat
// sessions whose turn must end in a structured {outcome, summary}; the edge labelled with that
// outcome is taken. Checks are commands (exit code), "Ask the person" waits for an answer, and
// limited outcomes (a review's "changes", a check's "fail") count rounds. A loop that cannot finish (its
// limit reached, or stuck on the same failure) is never just dropped: it is handed up to the loop around
// it to rethink, and only the outermost loop asks the person.

type Deps = Pick<
  HandlerContext,
  "workspaces" | "sessions" | "pendingTurns" | "broadcast" | "runStepTurn" | "emit" | "serveTool" | "autoApprove" | "acpAgents"
>;

/** Outcomes counted against a step's round limit. */
const LIMITED: WorkflowOutcome[] = ["changes", "fail"];
const CHECK_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_TAIL = 4000;
/** Files and commands kept per step for its scorecard. */
const TOOL_LOG_CAP = 400;

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
  /** The step's own chats, without the helpers it spawned. */
  ownSessionIds: string[];
}

type TurnResult = Verdict & { index: number };

class RunStopped extends Error {}

/** A run being driven: Stop aborts its sessions' turns and kills its check commands. */
interface LiveRun {
  stopped: boolean;
  sessions: Set<string>;
  commands: Set<Bun.Subprocess>;
}

/** A step session that may spawn helpers, sharing its step's cap with the step's other sessions. */
interface Spawner {
  run: WorkflowRun;
  node: WorkflowNode;
  live: LiveRun;
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
  private readonly live = new Map<string, LiveRun>();
  /** A step's session waiting mid-turn on the person (ask_requester escalated), by run id. */
  private readonly asking = new Map<string, (answer: string) => void>();
  /** Step sessions that may spawn helpers now, by session id. */
  private readonly spawners = new Map<string, Spawner>();
  /** Waiting for a run to end, by run id. */
  private readonly endings = new Map<string, ((run: WorkflowRun) => void)[]>();

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

  async start(
    projectId: string,
    workflowId: string,
    task: string,
    originSessionId?: string,
    options: { experimentId?: string; autoApprove?: boolean; without?: WorkflowContextRemoval } = {},
  ): Promise<WorkflowRun> {
    const saved = (await this.workflows.list(projectId)).find((w) => w.id === workflowId);
    if (!saved) throw new Error("Save the workflow before running it");
    // The run keeps each step's agent as it is now, so editing an agent later does not change it.
    const profiles = await this.agents.list();
    const broken = workflowAccessIssues(saved, profiles).find((i) => i.level === "error");
    if (broken) throw new Error(broken.message);
    const resolved = resolveWorkflowAgents(saved, profiles);
    // Taken away after the agents are filled in, so a step's agent cannot bring it back.
    const workflow = options.without === "skills" ? withoutSkills(resolved) : resolved;
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
      ...(options.experimentId ? { experimentId: options.experimentId } : {}),
      ...(options.autoApprove ? { autoApprove: true } : {}),
      ...(options.without ? { without: options.without } : {}),
      ...(originSessionId && this.deps.sessions.get(originSessionId) ? { originSessionId } : {}),
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
    void this.drive(run);
    return run;
  }

  /** A step's session asks the person mid-turn; the run waits until they answer. Null: no run has that session. */
  async askPerson(sessionId: string, question: string): Promise<string | null> {
    const runId = [...this.live.entries()].find(([, live]) => live.sessions.has(sessionId))?.[0];
    const run = runId ? await this.runs.get(runId) : null;
    if (!run || run.status !== "running") return null;
    // Nobody watches a comparison's run: it decides for itself rather than wait.
    if (run.experimentId) return "No one is here to answer: this run is part of an unattended comparison. Decide yourself, and say in your result what you assumed.";
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
      this.tellRequester(run, `The person answered a question in run ${run.id}: ${text.slice(0, 400)}`);
      asking(text.trim());
      return run;
    }
    if (!run || run.status !== "waiting" || !run.waiting || !run.currentNodeId) throw new Error("That run is not waiting for an answer");
    const node = this.node(run, run.currentNodeId);
    const reason = run.waiting.reason;
    const question = run.waiting.question;
    const limitKey = run.waiting.limitKey;
    const secret = run.waiting.secret === true;
    run.waiting = null;
    if (reason === "limit" && /^\s*stop\s*$/i.test(text)) return this.finish(run, "stopped");

    const step = this.beginStep(run, node, reason === "human" ? node.label : "Your answer");
    // A question that showed local-only work stays with the person; only the answer goes on.
    this.endStep(step, reason === "human" ? "answered" : "next", secret ? `Answer: ${text.trim()}` : `Question: ${question}\nAnswer: ${text.trim()}`);
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
      const abortTurns = () => {
        for (const sessionId of live.sessions) this.deps.pendingTurns.get(sessionId)?.abort();
      };
      abortTurns();
      for (const proc of live.commands) killTree(proc);
      // A step turn still starting has no abort to reach yet: sweep again until the run's turns are gone.
      void (async () => {
        for (let i = 0; i < 40 && live.sessions.size > 0; i++) {
          await Bun.sleep(250);
          abortTurns();
        }
      })();
    }
    if (run.status === "running" || run.status === "waiting") return this.finish(run, "stopped");
    return run;
  }

  /** Brings a done run's work home: its branch merged into the main checkout, or why it could not be. */
  async merge(runId: string): Promise<WorkflowRun> {
    const run = await this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    if (run.status !== "done") throw new Error("Only a finished run can be merged");
    if (run.mergedInto) return run;
    const state = await this.deps.workspaces.snapshot();
    const from = state.workspaces.find((w) => w.id === run.workspaceId);
    const into = state.workspaces.find((w) => w.projectId === run.projectId && w.isPrimary);
    if (!from?.branch || !into || from.id === into.id) throw new Error("This run worked in the main checkout; there is nothing to merge");
    if (!into.branch) throw new Error("The main checkout is not on a branch");
    const ahead = Number(await git(into.path, ["rev-list", "--count", `${into.branch}..${from.branch}`]));
    if (ahead === 0) throw new Error(`${from.branch} has no commits that ${into.branch} lacks`);
    try {
      await git(into.path, ["merge", "--no-ff", "--no-edit", from.branch], { timeoutMs: 120_000 });
    } catch (error) {
      const conflicted = await git(into.path, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { quiet: true }).then(() => true, () => false);
      if (conflicted) {
        await git(into.path, ["merge", "--abort"], { quiet: true }).catch(() => undefined);
        throw new Error(`${from.branch} conflicts with ${into.branch}; nothing was changed. Ask an agent to merge it and resolve the conflicts.`);
      }
      const detail = error instanceof GitError ? error.stderr.trim() : String(error);
      throw new Error(`git refused the merge (nothing was changed): ${detail}`);
    }
    run.mergedInto = into.branch;
    await this.save(run);
    return run;
  }

  // ── The loop ──────────────────────────────────────────────────────────

  private async drive(run: WorkflowRun): Promise<void> {
    const live: LiveRun = { stopped: false, sessions: new Set(), commands: new Set() };
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
          // What a local-only step found goes to the person, not to a chat on Claude.
          const requester = node.config.askLeadFirst && !this.lastHeldBack(run) ? this.requesterOf(run) : null;
          if (requester) {
            // The chat that started the run answers first; only what is the person's call reaches them.
            const step = this.beginStep(run, node, `${node.label} (starting chat)`);
            await this.save(run);
            const reply = await consultRequester(this.deps, requester, `the workflow "${run.workflow.name}" (run ${run.id})`, question);
            if ("answer" in reply) {
              this.endStep(step, "answered", `Question: ${question}\nAnswer from the starting chat: ${reply.answer}`);
              const edge = run.workflow.edges.find((e) => e.from === node.id && e.outcome === "answered");
              if (!edge) {
                await this.finish(run, "failed", `"${node.label}" has no "Answered" edge`);
                return;
              }
              run.currentNodeId = edge.to;
              await this.save(run);
              continue;
            }
            this.endStep(step, null, `The starting chat passed it to you: ${reply.escalate}`);
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
        run.handover = edge.session === "continue" ? { nodeId: node.id, sessionIds: result.ownSessionIds } : null;
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

  private async execute(run: WorkflowRun, node: WorkflowNode, live: LiveRun): Promise<StepResult> {
    if (node.kind === "check" || (node.kind === "custom" && node.config.runner === "command")) {
      return this.runCommand(run, node, live);
    }
    const outcomes = workflowOutcomes(node);
    const count = Math.max(1, Math.min(8, node.config.parallel?.count ?? 1));
    // Along a "continue" arrow the step goes on in the chat the step before it ran in.
    const carried = await this.carried(run, node, count);
    run.handover = null;
    const current = run.steps.at(-1);
    if (carried && current) current.continued = true;
    const prompt = this.prompt(run, node, outcomes, !!carried);
    const maxAgents = node.config.runBy === "lead" ? 0 : Math.max(0, Math.min(16, node.config.maxAgents ?? 0));
    const step = stepOptions(node.config.tools, outcomes, maxAgents > 0);
    const guards = this.guardsFor(run, node);
    if (guards.length > 0) step.guards = guards;
    const dataDirs = await this.dataDirs(run, node);
    if (dataDirs.length > 0) step.additionalDirectories = dataDirs;
    const turn = async (sessionId: string, index: number): Promise<TurnResult> => {
      if (live.stopped) throw new RunStopped();
      live.sessions.add(sessionId);
      // The starting chat is the person's: its asks are never answered for them.
      if (run.autoApprove && node.config.runBy !== "lead") this.deps.autoApprove.add(sessionId);
      try {
        const result = await this.deps.runStepTurn(sessionId, prompt, step);
        this.tally(run, result);
        if (live.stopped) throw new RunStopped();
        // Another message in that chat (the person writing to it mid-step) cuts the turn short.
        if (result.stopReason === "cancelled") throw new Error("The step's turn was cut short by another message in its chat");
        let parsed = parseVerdict(result.structured, outcomes) ?? parseVerdict(verdictInText(result.text), outcomes);
        if (!parsed && stepAgent(node)) {
          // Another agent that forgot the closing JSON is asked for it once, rather than guessed.
          const again = await this.deps.runStepTurn(sessionId, verdictReminder(outcomes), step);
          this.tally(run, again);
          if (live.stopped) throw new RunStopped();
          parsed = parseVerdict(verdictInText(again.text), outcomes);
        }
        return { ...(parsed ?? { outcome: fallbackOutcome(outcomes), summary: result.text }), index };
      } finally {
        live.sessions.delete(sessionId);
      }
    };

    if (node.config.runBy === "lead") {
      // The chat that started the run plans or checks itself, after any turn it is already in.
      const lead = this.requesterOf(run);
      if (!lead) throw new Error(`"${node.label}" runs in the chat that started the run, but this run was not started from a Claude chat`);
      while (this.deps.pendingTurns.has(lead) && !live.stopped) await Bun.sleep(2000);
      if (live.stopped) throw new RunStopped();
      // That chat works from its own folder; the run's worktree is where the change is.
      const runPath = this.deps.workspaces.workspacePath(run.workspaceId);
      if (runPath) step.additionalDirectories = [runPath, ...dataDirs];
      const { index: _, ...result } = await turn(lead, 0);
      return { ...result, sessionIds: [lead], ownSessionIds: [lead] };
    }

    const join = node.config.parallel?.join ?? "all";
    const workspaces = carried ? [carried.workspace] : await this.stepWorkspaces(run, node, count);
    const keep = node.kind === "agent" ? (node.config.session ?? "keep") === "keep" : false;
    const kept = carried ? [carried.sessionId] : keep ? (run.sessionsByNode[node.id] ?? []) : [];
    const sessionIds = workspaces.map((ws, i) => {
      const existing = kept[i] && this.deps.sessions.get(kept[i]!);
      if (existing && existing.workspaceId === ws.id && (existing.agent ?? "claude") === (stepAgent(node) ?? "claude")) return existing.id;
      const record = this.deps.sessions.create({
        workspaceId: ws.id,
        cwd: ws.path,
        title: `${node.label}${count > 1 ? ` ${i + 1}` : ""} · ${run.workflow.name}`,
        ...(stepAgent(node) ? { agent: stepAgent(node) } : {}),
        // Agents edit their own worktree without asking each time; reviewers only read.
        options: {
          model: !stepAgent(node) && node.config.model ? node.config.model : null,
          effort: null,
          permissionMode: node.kind === "review" ? "default" : "acceptEdits",
        },
      });
      return record.id;
    });
    // A chat carried into a step that holds local-only data holds it from now on too.
    if (this.heldBack(run, node.id)) for (const id of sessionIds) this.deps.sessions.update(id, { localOnly: true });
    // Known from the start, so the run view can open a working step's chat and see it waiting on the person.
    const open = run.steps.at(-1);
    if (open && open.nodeId === node.id && open.endedAt === null) {
      open.sessionIds = [...sessionIds];
      await this.save(run);
    }
    // Other agents are put on the step's model before they start, and the step fails if they will not take it.
    const model = stepAgent(node) ? node.config.model : undefined;
    if (model) {
      for (const id of sessionIds) {
        const record = this.deps.sessions.get(id);
        const agent = record ? this.deps.acpAgents.for(record) : null;
        if (agent) await agent.useModel(model);
      }
    }
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
      this.tellRequester(run, `Workflow "${run.workflow.name}" (run ${run.id}): the loop "${current.label}" was handed up to "${target.label}": ${why}.`);
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
      return { ...verdict, sessionIds: [...sessionIds, ...helpers], ownSessionIds: sessionIds };
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
      ownSessionIds: sessionIds,
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
      ...(this.heldBack(run, node.id) ? { localOnly: true } : {}),
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
    if (live.stopped) return "Not run: the workflow was stopped.";
    live.sessions.add(record.id);
    if (run.autoApprove) this.deps.autoApprove.add(record.id);
    try {
      const result = await this.deps.runStepTurn(record.id, text, spawner.step);
      this.tally(run, result);
      if (live.stopped) return "Stopped with the workflow.";
      return result.text.trim() || `Ended (${result.stopReason}) without a report.`;
    } catch (error) {
      return `Failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      live.sessions.delete(record.id);
    }
  }

  /** The chat a "continue" arrow carries into this step: one session, on the agent this step runs on. */
  private async carried(run: WorkflowRun, node: WorkflowNode, count: number): Promise<{ sessionId: string; workspace: Workspace } | null> {
    const id = run.handover?.sessionIds.length === 1 ? run.handover.sessionIds[0] : undefined;
    const session = id ? this.deps.sessions.get(id) : undefined;
    if (!session || count > 1 || node.config.runBy === "lead") return null;
    if ((session.agent ?? "claude") !== (stepAgent(node) ?? "claude")) return null;
    const workspace = (await this.deps.workspaces.snapshot()).workspaces.find((w) => w.id === session.workspaceId);
    return workspace ? { sessionId: session.id, workspace } : null;
  }

  private prompt(run: WorkflowRun, node: WorkflowNode, outcomes: WorkflowOutcome[], continued = false): string {
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
    const lines = continued
      ? [
          // The chat already holds the task and what was done; only the new step is news.
          `Next step in the workflow "${run.workflow.name}": "${node.label}". You are now the ${node.config.role?.trim() || node.label}; carry on from where this conversation is.`,
        ]
      : [
          `You are the ${node.config.role?.trim() || node.label} in the workflow "${run.workflow.name}", step "${node.label}", run by Zomfy.`,
          "",
          "Task of this run:",
          run.task,
        ];
    if (handoff && !continued) {
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
      lines.push(`This step works with local-only data, which may not reach a chat on Claude: do not call ask_requester. If you cannot go on, choose the "ask" outcome; the person answers.`);
    } else {
      lines.push(
        "Need a decision or context mid-task? Call the harness tool ask_requester: the chat that started this run answers (or passes it to the person), and you carry on with the answer.",
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

  private async runCommand(run: WorkflowRun, node: WorkflowNode, live: LiveRun): Promise<StepResult> {
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
    if (live.stopped) throw new RunStopped();
    const proc = Bun.spawn(argv, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: windows,
      // Its own process group, so a Stop or the timeout ends what the command started too.
      detached: !windows,
    });
    trackChild(proc);
    live.commands.add(proc);
    const timer = setTimeout(() => killTree(proc), CHECK_TIMEOUT_MS);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).finally(() => {
      clearTimeout(timer);
      live.commands.delete(proc);
    });
    if (live.stopped) throw new RunStopped();
    const output = `${stdout}${stderr}`.trim();
    const tail = output.length > OUTPUT_TAIL ? `…${output.slice(-OUTPUT_TAIL)}` : output;
    const own = (node.config.outcomes ?? []).filter((o) => o.trim());
    if (node.kind === "custom" && own.length > 0) {
      // A command with its own outcomes names one on its last line.
      const last = output.split("\n").at(-1)?.trim() ?? "";
      const outcome = own.find((o) => o === last);
      if (!outcome) throw new Error(`The command's last line "${last}" is none of ${own.join(", ")}`);
      return { outcome, summary: `$ ${command} (exit ${code})\n${tail}`, sessionIds: [], ownSessionIds: [] };
    }
    return { outcome: code === 0 ? "pass" : "fail", summary: `$ ${command} (exit ${code})\n${tail}`, sessionIds: [], ownSessionIds: [] };
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
    const paths = this.dataOf(run, node).map((d) => d.source.path.trim()).filter(isAbsolutePath).map(expandHome);
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

  /** Adds a turn's tokens, files and commands to the step running now (the run's last), for its scorecard. */
  private tally(run: WorkflowRun, turn: { usage?: WorkflowStepUsage; context?: WorkflowStepContext; tools: StepToolUse }): void {
    const step = run.steps.at(-1);
    if (!step) return;
    if (turn.context) step.context = turn.context;
    if (turn.usage) {
      const had = step.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
      const cost = had.costUsd !== undefined || turn.usage.costUsd !== undefined ? (had.costUsd ?? 0) + (turn.usage.costUsd ?? 0) : undefined;
      step.usage = {
        inputTokens: had.inputTokens + turn.usage.inputTokens,
        outputTokens: had.outputTokens + turn.usage.outputTokens,
        cacheReadTokens: had.cacheReadTokens + turn.usage.cacheReadTokens,
        ...(cost !== undefined ? { costUsd: cost } : {}),
      };
    }
    const add = (had: string[] | undefined, more: string[]) => (more.length ? [...(had ?? []), ...more].slice(-TOOL_LOG_CAP) : had);
    const reads = add(step.reads, turn.tools.reads);
    const edits = add(step.edits, turn.tools.edits);
    const commands = add(step.commands, turn.tools.commands);
    if (reads) step.reads = reads;
    if (edits) step.edits = edits;
    if (commands) step.commands = commands;
    const skillsUsed = add(step.skillsUsed, turn.tools.skills);
    const mcpUsed = add(step.mcpUsed, turn.tools.mcp);
    const agentsUsed = add(step.agentsUsed, turn.tools.agents);
    if (skillsUsed) step.skillsUsed = skillsUsed;
    if (mcpUsed) step.mcpUsed = mcpUsed;
    if (agentsUsed) step.agentsUsed = agentsUsed;
  }

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

  /** The Claude chat the run was started from, which answers its questions and hears how it goes. */
  private requesterOf(run: WorkflowRun): string | null {
    const session = run.originSessionId ? this.deps.sessions.get(run.originSessionId) : undefined;
    return session && (session.agent ?? "claude") === "claude" && !session.localOnly ? session.id : null;
  }

  /** `secret`: the question holds local-only work, so the starting chat only hears that the run waits. */
  private async wait(run: WorkflowRun, question: string, reason: "human" | "ask" | "limit", limitKey?: string, secret = false): Promise<void> {
    if (run.experimentId) {
      // A comparison's run that would wait for the person ends instead, saying why, so the comparison goes on.
      await this.finish(run, "failed", `It would have waited for the person: ${secret ? "(a question about local-only work)" : question.slice(0, 300)}`);
      return;
    }
    run.status = "waiting";
    run.waiting = { question, reason, ...(limitKey ? { limitKey } : {}), ...(secret ? { secret: true } : {}) };
    await this.save(run);
    this.tellRequester(run, `Workflow "${run.workflow.name}" (run ${run.id}) is waiting for the person: ${secret ? "(the question is withheld: it holds local-only data)" : question}`);
  }

  private async finish(run: WorkflowRun, status: "done" | "failed" | "stopped", why?: string): Promise<WorkflowRun> {
    run.status = status;
    run.waiting = null;
    run.endedAt = Date.now();
    // A step cut off by the Stop ends with the run, not left "running".
    if (status === "stopped") {
      for (const step of run.steps) {
        if (step.endedAt !== null) continue;
        step.endedAt = run.endedAt;
        step.error ??= "Stopped";
      }
    }
    if (why) {
      run.endReason = why;
      const last = run.steps.at(-1);
      if (last && !last.error && status === "failed") last.error = why;
    }
    await this.save(run);
    const last = run.steps.filter((s) => s.summary && !this.heldBack(run, s.nodeId)).at(-1);
    const later = (run.followUps ?? []).filter((f) => !this.heldBack(run, f.nodeId));
    this.tellRequester(
      run,
      `Workflow "${run.workflow.name}" (run ${run.id}) ${status === "done" ? "finished" : status}${why ? `: ${why}` : ""}.${last ? ` Last step "${last.label}": ${last.summary.slice(0, 400)}` : ""}${later.length > 0 ? `\nLeft for later (${later.length}):\n${later.map((f) => `- ${f.label}: ${f.text}`).join("\n").slice(0, 1500)}` : ""}`,
    );
    return run;
  }

  private async save(run: WorkflowRun): Promise<void> {
    await this.runs.save(run);
    this.deps.broadcast(WORKFLOW_NOTIFICATIONS.workflowRunChanged, run);
    if (run.status === "done" || run.status === "failed" || run.status === "stopped") {
      for (const step of run.steps) for (const id of step.sessionIds) this.deps.autoApprove.delete(id);
      for (const resolve of this.endings.get(run.id) ?? []) resolve(run);
      this.endings.delete(run.id);
    }
  }

  /**
   * Why the workflow's runs would not be isolated from the person's own work, so its asks must not be
   * answered for them: it runs in the project's own checkout, or in the chat that started it. Null when isolated.
   */
  async sharesPersonsWork(projectId: string, workflowId: string): Promise<string | null> {
    const workflow = (await this.workflows.list(projectId)).find((w) => w.id === workflowId);
    if (!workflow) return "it is not saved";
    const project = (await this.deps.workspaces.snapshot()).projects.find((p) => p.id === projectId);
    if (project?.kind !== "git") return "the project is a folder, so its runs work in the folder itself";
    const lead = workflow.nodes.find((n) => n.config.runBy === "lead");
    if (lead) return `"${lead.label}" runs in the chat that started the run`;
    const main = workflow.nodes.find((n) => n.kind !== "start" && n.kind !== "end" && n.kind !== "human" && n.config.workspace === "main");
    return main ? `"${main.label}" runs in the project's main workspace` : null;
  }

  /** Resolves when the run is done, failed or stopped (a waiting run is not over). */
  async ended(runId: string): Promise<WorkflowRun> {
    const run = await this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    if (run.status === "done" || run.status === "failed" || run.status === "stopped") return run;
    return new Promise((resolve) => this.endings.set(runId, [...(this.endings.get(runId) ?? []), resolve]));
  }

  /** The chat that started the run hears how it goes, on its next turn. */
  private tellRequester(run: WorkflowRun, text: string): void {
    // A comparison's runs would only fill that chat.
    if (run.experimentId) return;
    const requester = this.requesterOf(run);
    if (requester) noteActivity(this.deps.sessions, requester, text);
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

/** The agent a session step runs on when not Claude; steps run in the starting chat are always Claude. */
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
