import {
  cyclesOf,
  WORKFLOW_META,
  WORKFLOW_NOTIFICATIONS,
  workflowOutcomes,
  type Workflow,
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
import { sanitizeWorkspaceName } from "./worktree-naming.ts";
import { log } from "./log.ts";

// Runs a workflow graph: the engine, not a model, picks each next step. Agent steps are chat
// sessions whose turn must end in a structured {outcome, summary}; the edge labelled with that
// outcome is taken. Checks are commands (exit code), "Ask the person" waits for an answer, and
// limited outcomes (a review's "changes", a check's "fail") count rounds and stop at the limit.

type Deps = Pick<HandlerContext, "workspaces" | "sessions" | "pendingTurns" | "broadcast" | "runStepTurn" | "emit">;

/** Outcomes counted against a step's round limit. */
const LIMITED: WorkflowOutcome[] = ["changes", "fail"];
const CHECK_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_TAIL = 4000;

interface StepResult {
  outcome: WorkflowOutcome;
  summary: string;
  sessionIds: string[];
}

class RunStopped extends Error {}

export class WorkflowEngine {
  /** Runs this daemon is driving now, so Stop can reach their turns. */
  private readonly live = new Map<string, { stopped: boolean; sessions: Set<string> }>();
  /** A step's session waiting mid-turn on the person (ask_lead escalated), by run id. */
  private readonly asking = new Map<string, (answer: string) => void>();

  constructor(
    private readonly deps: Deps,
    private readonly runs: WorkflowRunStore,
    private readonly workflows: WorkflowStore,
  ) {}

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
    const workflow = (await this.workflows.list(projectId)).find((w) => w.id === workflowId);
    if (!workflow) throw new Error("Save the workflow before running it");
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
          const lead = node.config.askLeadFirst ? await this.leadOf(run) : null;
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
          await this.wait(run, question, "human");
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

        const edge = run.workflow.edges.find((e) => e.from === node.id && e.outcome === result.outcome);
        if (!edge) {
          // A question with nowhere to go comes to the person.
          if (result.outcome === "ask") await this.wait(run, result.summary || `"${node.label}" has a question.`, "ask");
          else await this.finish(run, "failed", `"${node.label}" ended in "${result.outcome}", which leads nowhere`);
          return;
        }
        run.currentNodeId = edge.to;
        const limit = node.config.maxRounds;
        if (limit && LIMITED.includes(result.outcome)) {
          run.rounds[node.id] = (run.rounds[node.id] ?? 0) + 1;
          if (run.rounds[node.id]! > limit) {
            await this.wait(
              run,
              `"${node.label}" reached its limit of ${limit} round${limit > 1 ? "s" : ""}. Answer to go on (your note goes along), or "stop".`,
              "limit",
              node.id,
            );
            return;
          }
        }
        // Coming back to a cycle's first step from inside it starts the cycle's next round.
        const target = this.node(run, edge.to);
        let stopped = false;
        for (const cycle of cyclesOf(run.workflow, target.id)) {
          if (cycle.id !== target.id || !cycle.nodeIds.includes(node.id)) continue;
          const key = `cycle:${cycle.id}`;
          run.rounds[key] = (run.rounds[key] ?? 0) + 1;
          if (run.rounds[key]! >= cycle.maxRounds) {
            await this.wait(
              run,
              `The cycle "${cycle.label}" used all ${cycle.maxRounds} rounds. Answer to run another (your note goes along), or "stop".`,
              "limit",
              key,
            );
            stopped = true;
            break;
          }
        }
        if (stopped) return;
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
    const step = stepOptions(node.config.tools, outcomes);
    const turn = async (sessionId: string, index: number): Promise<{ outcome: WorkflowOutcome; summary: string; index: number }> => {
      live.sessions.add(sessionId);
      try {
        const result = await this.deps.runStepTurn(sessionId, prompt, step);
        if (live.stopped) throw new RunStopped();
        // Another message in that chat (the person writing to the Lead mid-step) cuts the turn short.
        if (result.stopReason === "cancelled") throw new Error("The step's turn was cut short by another message in its chat");
        const parsed = parseVerdict(result.structured, outcomes);
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
      if (runPath) step.additionalDirectories = [runPath];
      const result = await turn(lead, 0);
      return { outcome: result.outcome, summary: result.summary, sessionIds: [lead] };
    }

    const count = Math.max(1, Math.min(8, node.config.parallel?.count ?? 1));
    const join = node.config.parallel?.join ?? "all";
    const workspaces = await this.stepWorkspaces(run, node, count);
    const keep = node.kind === "agent" ? (node.config.session ?? "keep") === "keep" : false;
    const kept = keep ? (run.sessionsByNode[node.id] ?? []) : [];
    const sessionIds = workspaces.map((ws, i) => {
      const existing = kept[i] && this.deps.sessions.get(kept[i]!);
      if (existing && existing.workspaceId === ws.id) return existing.id;
      const record = this.deps.sessions.create({
        workspaceId: ws.id,
        cwd: ws.path,
        title: `${node.label}${count > 1 ? ` ${i + 1}` : ""} · ${run.workflow.name}`,
        // Agents edit their own worktree without asking each time; reviewers only read.
        options: { model: null, effort: null, permissionMode: node.kind === "review" ? "default" : "acceptEdits" },
      });
      return record.id;
    });
    if (keep) run.sessionsByNode[node.id] = sessionIds;
    await this.save(run);
    if (count > 1 && join === "first") {
      const winner = await Promise.any(sessionIds.map((id, i) => turn(id, i)));
      for (const [i, id] of sessionIds.entries()) if (i !== winner.index) this.deps.pendingTurns.get(id)?.abort();
      // The winner's worktree carries the run on.
      const ws = workspaces[winner.index];
      if (ws && node.config.workspace !== "main") run.workspaceId = ws.id;
      return { outcome: winner.outcome, summary: winner.summary, sessionIds };
    }
    const results = await Promise.all(sessionIds.map((id, i) => turn(id, i)));
    const summary =
      results.length === 1
        ? results[0]!.summary
        : results
            .map((r) => `${node.label} ${r.index + 1} (${r.outcome}, in ${workspaces[r.index]?.path ?? "?"}): ${r.summary}`)
            .join("\n\n");
    return { outcome: combine(node, results.map((r) => r.outcome), join), summary, sessionIds };
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
    if (handoff) lines.push("", `Handoff from "${handoff.label}" (${handoff.outcome ?? "no outcome"}):`, handoff.summary);
    if (node.config.prompt?.trim()) lines.push("", "Your instructions:", fill(node.config.prompt.trim()));
    if (fields.length > 0) lines.push("", "Settings:", ...fields.map((f) => `- ${f.label || f.key} (${f.key}): ${String(f.value)}`));
    const rounds = run.rounds[node.id];
    if (rounds) lines.push("", `This is round ${rounds + 1} of this step.`);
    lines.push(
      "",
      `When you are done, give your result as the structured output: "outcome" is one of ${outcomes.map((o) => `"${o}"`).join(", ")}, and "summary" is what the next step needs (what you did or found, concretely).`,
    );
    lines.push(
      "Need a decision or context mid-task? Call the harness tool ask_lead: the project's Lead answers (or passes it to the person), and you carry on with the answer.",
    );
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
    const argv = process.platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", command] : ["bash", "-lc", command];
    const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true });
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

  private async wait(run: WorkflowRun, question: string, reason: "human" | "ask" | "limit", limitKey?: string): Promise<void> {
    run.status = "waiting";
    run.waiting = { question, reason, ...(limitKey ? { limitKey } : {}) };
    await this.save(run);
    this.tellLead(run, `Workflow "${run.workflow.name}" (run ${run.id}) is waiting for the person: ${question}`);
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
    const last = run.steps.filter((s) => s.summary).at(-1);
    this.tellLead(
      run,
      `Workflow "${run.workflow.name}" (run ${run.id}) ${status === "done" ? "finished" : status}${why ? `: ${why}` : ""}.${last ? ` Last step "${last.label}": ${last.summary.slice(0, 400)}` : ""}`,
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

/** The structured result every session step must give. */
function verdictSchema(outcomes: WorkflowOutcome[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      outcome: { type: "string", enum: outcomes },
      summary: { type: "string" },
    },
    required: ["outcome", "summary"],
    additionalProperties: false,
  };
}

function parseVerdict(value: unknown, outcomes: WorkflowOutcome[]): { outcome: WorkflowOutcome; summary: string } | null {
  if (!value || typeof value !== "object") return null;
  const outcome = "outcome" in value ? value.outcome : undefined;
  const summary = "summary" in value ? value.summary : undefined;
  if (typeof outcome !== "string" || !outcomes.includes(outcome)) return null;
  return { outcome, summary: typeof summary === "string" ? summary : "" };
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

/** A step's tool policy as the options its turn runs with. */
function stepOptions(tools: WorkflowToolPolicy | undefined, outcomes: WorkflowOutcome[]): StepOptions {
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
  const deny = withShellTwins([...(tools?.deny ?? []), ...(tools?.readOnly ? ["Edit", "Write", "NotebookEdit", "MultiEdit"] : [])]);
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
