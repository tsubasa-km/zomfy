import type * as acp from "@agentclientprotocol/sdk";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CreateWorkspaceParams, Project, PromptOrigin, RemoveWorkspaceParams, Workspace } from "@acp-harness/protocol";
import { git } from "./git-cli.ts";
import { log } from "./log.ts";
import type { SessionRecord, SessionRegistry } from "./session-registry.ts";
import { interruptedSplitNote, type SplitStore } from "./split-store.ts";
import {
  Gate,
  HELPERS_AT_ONCE,
  planSplit,
  reportIn,
  runSplit,
  runningSplitNote,
  splitDonePrompt,
  SPLIT_REPORT_HEADING,
  type SplitDeps,
  type SplitPlan,
} from "./split-work.ts";

// The harness side of split_work (split-work.ts runs one split): which chats may split, one split
// at a time per folder, helpers that may not touch other worktrees, holding every chat in the
// folder while parts are merged into it, the report that starts the chat's next turn, what a
// restart leaves, and tidying away kept parts once the chat has brought them in.

export interface SplitCoordinatorDeps {
  sessions: {
    get(id: string): SessionRecord | undefined;
    all(): SessionRecord[];
    create(fields: Parameters<SessionRegistry["create"]>[0]): SessionRecord;
    update(id: string, patch: Partial<SessionRecord>): void;
    transcript(id: string): Promise<acp.SessionUpdate[]>;
    removeWorkspace(workspaceId: string): Promise<void>;
    /** Resolves once every change so far is on disk. */
    flushed?(): Promise<void>;
  };
  workspaces: {
    requireWorkspace(id: string): { workspace: Workspace; project: Project };
    isScratch(id: string | null): boolean;
    createWorkspace(params: CreateWorkspaceParams): Promise<Workspace>;
    removeWorkspace(params: RemoveWorkspaceParams): Promise<void>;
  };
  /** Running turns by session id. */
  pendingTurns: Map<string, AbortController>;
  /** A workflow step's turn: steps split with spawn_agents instead. */
  isStepTurn(sessionId: string): boolean;
  /** The chat moves to another folder when its turn ends (a move or finish_worktree it asked for). */
  leaving(sessionId: string): boolean;
  /** Sessions whose asks are answered "allow" (a workflow comparison); helpers of such a chat are too. */
  autoApprove: Set<string>;
  /** The chat's conversation runs in a `claude` terminal ("Continue in Terminal"). */
  cliHasConversation(sessionId: string): boolean;
  notice(sessionId: string, title: string): void;
  /**
   * Asks the person in the chat whether to go ahead with this split (the tool's input), whatever
   * the chat's permission mode; true when they agree.
   */
  confirm(sessionId: string, input: Record<string, unknown>): Promise<boolean>;
  /** Starts a turn in the chat; resolves with its stop reason once it ends, or "not-sent" when no turn ran. */
  startTurn(sessionId: string, text: string, origin: PromptOrigin): Promise<string>;
  /**
   * One helper turn: its report, stop reason, and whether the helper said its part is done (absent
   * for agents that cannot say). `why` names how a turn that ended short ended (a usage limit, say).
   */
  runHelperTurn(sessionId: string, text: string, origin: PromptOrigin): Promise<{ text: string; stopReason: string; done?: boolean; why?: string }>;
  releaseFinishedTurn(sessionId: string): Promise<void>;
  closeTerminals(workspaceId: string): void;
  runSetupHook(project: Project, path: string): Promise<string | null>;
  runArchiveHook(project: Project, path: string): Promise<void>;
  store: SplitStore;
  pollMs?: number;
}

interface Job {
  caller: string;
  workspaceId: string;
  titles: string[];
  abort: AbortController;
  /** The helper working in each part's worktree, by workspace id. */
  helpers: Map<string, string>;
  created: Workspace[];
  /** What every turn of the chat hears while the parts run. */
  note: string;
  /** Where each part is, by title, for manage_split's status. */
  states: Map<string, string>;
  /** Parts that have ended, however they ended. */
  ended: number;
  /** Settles when the split has ended and its report has been handed over. */
  done: Promise<void>;
  /** Ends the hold on the folder (set while parts are merged into it). */
  release?: () => void;
}

/** The report's turn: what it says, as the person sees it in the thread. */
const REPORT_ORIGIN: PromptOrigin = { kind: "harness-note", title: "Split work: every part has finished" };

export interface ToolResult {
  result: string;
  isError?: boolean;
}

const fail = (result: string): ToolResult => ({ result, isError: true });

export class SplitCoordinator {
  /** Splits running, by the folder (workspace) they merge into: one at a time per folder. */
  private readonly jobs = new Map<string, Job>();
  private readonly helpers = new Set<string>();
  /** Folders parts are being merged into, by workspace id: a turn there waits until it resolves. */
  private readonly holds = new Map<string, Promise<void>>();
  private readonly gate = new Gate(HELPERS_AT_ONCE);

  constructor(private readonly deps: SplitCoordinatorDeps) {}

  /** Picks up what a previous daemon left: its helpers, and the splits a restart cut short. */
  async recover(): Promise<void> {
    const { interrupted, helpers } = await this.deps.store.load();
    for (const id of helpers) this.helpers.add(id);
    for (const session of this.deps.sessions.all()) {
      if (session.seedContext?.includes(SPLIT_REPORT_HEADING)) void this.startReportTurn(session.id, session.workspaceId);
    }
    for (const split of interrupted) {
      // Saved just before the restart: the report says it all.
      if (this.deps.sessions.get(split.sessionId)?.seedContext?.includes(SPLIT_REPORT_HEADING)) continue;
      let aborted = false;
      if (split.merging && (await mergingOneOf(split.parentPath, split.worktrees.map((w) => w.branch)))) {
        await git(split.parentPath, ["merge", "--abort"], { quiet: true }).catch((error) => log(`could not abort the merge in ${split.parentPath}: ${String(error)}`));
        aborted = true;
      }
      // A chat that is gone has no one to tell: what was recorded for it goes too.
      if (!this.deps.sessions.get(split.sessionId)) {
        await this.deps.store.forget(split.sessionId);
        continue;
      }
      const note = interruptedSplitNote(split, aborted);
      this.deps.notice(split.sessionId, "Parts split off were cut short by a restart");
      void this.startNoteTurn(split.sessionId, `[split_work] ${note}`);
    }
  }

  /** A turn that starts with `text` once the chat's folder is idle; saved for its next turn if it cannot run. */
  private async startNoteTurn(sessionId: string, text: string): Promise<void> {
    const workspaceId = this.deps.sessions.get(sessionId)?.workspaceId;
    if (workspaceId) await this.untilIdle(workspaceId);
    if (!this.deps.sessions.get(sessionId)) return;
    const stop = await this.deps.startTurn(sessionId, text, { kind: "harness-note", title: "Split work: cut short by a restart" }).catch(() => null);
    if (stop === null || stop === "not-sent") this.appendSeed(sessionId, text);
  }

  isHelper(sessionId: string): boolean {
    return this.helpers.has(sessionId);
  }

  /** A worktree a split made for one of its parts (left out of the chat's list of sibling worktrees). */
  isPartWorktree(workspaceId: string): boolean {
    return this.deps.store.isKept(workspaceId) || [...this.jobs.values()].some((j) => j.created.some((w) => w.id === workspaceId));
  }

  /**
   * split_work is for the person's own chat in a worktree of a git project: not a manager, a side
   * chat, a workflow step or a helper, and not the main checkout, which is the person's own.
   */
  offered(sessionId: string): boolean {
    const session = this.deps.sessions.get(sessionId);
    if (!session?.workspaceId || this.helpers.has(sessionId) || this.deps.isStepTurn(sessionId)) return false;
    if (session.role === "manager" || session.origin === "workflow" || session.sideOf || this.deps.workspaces.isScratch(session.workspaceId)) return false;
    // Helpers say whether their part is done through Claude's structured result; other agents cannot.
    if (session.agent && session.agent !== "claude") return false;
    try {
      const { workspace, project } = this.deps.workspaces.requireWorkspace(session.workspaceId);
      return project.kind === "git" && !workspace.isPrimary;
    } catch {
      return false;
    }
  }

  /** manage_split is for a chat with parts running or kept, wherever it works now. */
  manageOffered(sessionId: string): boolean {
    if (this.helpers.has(sessionId) || !this.deps.sessions.get(sessionId)) return false;
    return this.running(sessionId) || this.keptParts(sessionId) > 0;
  }

  /** Kept parts the chat has still to bring in or tidy away. */
  keptParts(sessionId: string): number {
    return this.deps.store.keptFor(sessionId).filter((k) => this.exists(k.workspaceId)).length;
  }

  /** What a turn in this folder must wait for first (parts being merged into it), if anything. */
  hold(workspaceId: string | null): Promise<void> | undefined {
    return workspaceId ? this.holds.get(workspaceId) : undefined;
  }

  /** Why the chat's folder is not the chat's alone right now (parts running or merging), or null. */
  busy(sessionId: string): string | null {
    const job = this.jobOf(sessionId);
    if (!job) return null;
    if (this.holds.has(job.workspaceId)) return "Parts split off are being merged into this folder.";
    if (job.titles.length === 0) return "A split of the work in this folder is being set up.";
    return `Parts split off are still running (${job.titles.join(", ")}); wait for their report.`;
  }

  /** Whether a split is running for this chat's folder (finish_worktree waits for it). */
  running(sessionId: string): boolean {
    return !!this.jobOf(sessionId);
  }

  /** A chat is gone: its split stops (its worktrees stay), and what was recorded for it goes. */
  forget(sessionId: string): void {
    for (const job of this.jobs.values()) if (job.caller === sessionId) job.abort.abort();
    this.helpers.delete(sessionId);
    void this.deps.store.forget(sessionId);
  }

  /** What a turn of this chat must know about parts it split off that are still running, or null. */
  turnNote(sessionId: string): string | null {
    return this.jobOf(sessionId)?.note || null;
  }

  /** Resolves once every split running now has ended. */
  async settled(): Promise<void> {
    await Promise.all([...this.jobs.values()].map((j) => j.done));
  }

  /** The split this chat started, or one merging into the folder it works in. */
  private jobOf(sessionId: string): Job | undefined {
    const workspaceId = this.deps.sessions.get(sessionId)?.workspaceId;
    return [...this.jobs.values()].find((j) => j.caller === sessionId) ?? (workspaceId ? this.jobs.get(workspaceId) : undefined);
  }

  /**
   * The person's answer to the split, given while the tool call that asked still waits: no answer
   * once that turn is stopped or the call would have timed out, so a late "yes" starts nothing.
   */
  private async askPerson(caller: string, args: Record<string, unknown>): Promise<boolean> {
    const turn = this.deps.pendingTurns.get(caller)?.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), CONFIRM_TIMEOUT_MS);
      turn?.addEventListener("abort", () => resolve(false), { once: true });
    });
    try {
      return await Promise.race([this.deps.confirm(caller, args).catch(() => false), gaveUp]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The manage_split tool: stop running parts, or tidy away kept ones. */
  async manage(caller: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.manageOffered(caller)) return fail("You have no parts split off, running or kept.");
    if (args.action === "tidy") return { result: await this.tidy(caller) };
    if (args.action === "status") {
      const job = this.jobOf(caller);
      const kept = this.keptParts(caller);
      if (!job) return { result: `None of your parts are running.${kept > 0 ? ` ${kept} kept part(s) wait to be brought in or tidied.` : ""}` };
      return { result: [...job.states].map(([title, state]) => `- ${title}: ${state}`).join("\n") };
    }
    if (args.action !== "stop") return fail('Give action "status", "stop" or "tidy".');
    const running = [...this.jobs.values()].find((j) => j.caller === caller);
    if (!running) return { result: "None of your parts are running." };
    running.abort.abort();
    return { result: `Stopping ${running.titles.join(", ")}. What they did so far stays in their worktrees; their report starts your next turn.` };
  }

  /** The split_work tool. */
  async call(caller: string, args: Record<string, unknown>): Promise<ToolResult> {
    const session = this.deps.sessions.get(caller);
    if (!session?.workspaceId || !this.offered(caller)) return fail("split_work works only in a chat in a worktree of a git project.");
    const workspaceId = session.workspaceId;
    const running = this.jobs.get(workspaceId);
    if (this.deps.leaving(caller)) {
      return fail("This chat moves to another folder when this turn ends (a move or finish_worktree was asked for): split the work there, after the move.");
    }
    if (running) return fail(`Parts split off from this folder are still running (${running.titles.join(", ")}); wait for their report, or stop them with manage_split.`);
    if (session.options.permissionMode === "plan") {
      return fail("The person asked for a plan first (plan mode): propose the split in your plan instead of starting it.");
    }
    const others = this.chatsIn(workspaceId).filter((s) => s.id !== caller && (this.deps.pendingTurns.has(s.id) || this.deps.cliHasConversation(s.id)));
    if (others.length > 0) return fail("Another chat is working in this folder; split the work once it is idle, so nothing changes under the parts.");

    // Taken before anything is awaited, so two calls at once cannot both start.
    const job: Job = { caller, workspaceId, titles: [], abort: new AbortController(), helpers: new Map(), created: [], note: "", states: new Map(), ended: 0, done: Promise.resolve() };
    this.jobs.set(workspaceId, job);
    let plan: SplitPlan;
    try {
      plan = await planSplit({ requireWorkspace: (id) => this.deps.workspaces.requireWorkspace(id) }, workspaceId, args);
    } catch (error) {
      this.jobs.delete(workspaceId);
      return fail(error instanceof Error ? error.message : String(error));
    }
    // Asked here, once the plan is known to be workable, in every permission mode (the tool itself
    // is not gated): this approval is what lets the helpers edit without asking.
    const agreed = this.deps.autoApprove.has(caller) || (await this.askPerson(caller, args));
    if (!agreed) {
      this.jobs.delete(workspaceId);
      return fail("The person did not want this split. Do the work yourself, or ask them how they want it split.");
    }
    job.titles = plan.request.parts.map((p) => p.title);
    for (const title of job.titles) job.states.set(title, "waiting to start");
    // Stopping the split stops its helpers' turns; their worktrees stay, with whatever they did.
    job.abort.signal.addEventListener("abort", () => {
      for (const id of job.helpers.values()) this.deps.pendingTurns.get(id)?.abort();
    });
    await this.deps.store.start({ sessionId: caller, parentPath: plan.parent.path, titles: job.titles, startedAt: Date.now(), worktrees: [] });
    this.deps.notice(caller, `Working on ${job.titles.length} parts at once: ${job.titles.join(", ")}`);
    job.note = `[split_work] ${runningSplitNote(job.titles, plan.request.parts.flatMap((p) => p.owns))}`;
    job.done = this.run(job, session, plan).catch((error) => log(`split_work for ${caller} failed: ${String(error)}`));
    const left = plan.untracked.length > 0 ? ` Note: new files you have not committed are not in the parts' worktrees: ${plan.untracked.slice(0, 10).join(", ")}${plan.untracked.length > 10 ? ", ..." : ""}.` : "";
    return {
      result: `Started ${job.titles.length} parts at once: ${job.titles.join(", ")}. End your turn now with one short line telling the person; when every part is done, Zomfy merges them into your branch and starts your next turn with the report.${left}`,
    };
  }

  private async run(job: Job, session: SessionRecord, plan: SplitPlan): Promise<void> {
    let report: string;
    try {
      try {
        report = await runSplit(this.splitDeps(job, session, plan), plan);
      } catch (error) {
        const kept = job.created.map((w) => `${w.branch ?? w.name} (${w.path})`);
        report = `split_work failed: ${error instanceof Error ? error.message : String(error)}${kept.length > 0 ? `\nWorktrees it made: ${kept.join("; ")}.` : ""}`;
      }
      // Part worktrees still standing hold work the chat has to bring in (or tidy away); a chat that
      // is gone has no one to keep them for.
      const standing = job.created.filter((w) => this.exists(w.id));
      if (this.deps.sessions.get(job.caller)) {
        await this.deps.store.keep(standing.map((w) => ({ sessionId: job.caller, workspaceId: w.id })));
        // Saved with the chat before the split is marked over, so a restart in between cannot lose it:
        // whichever turn of the chat comes next reads it.
        this.appendSeed(job.caller, splitDonePrompt(report));
        // On disk before the split is marked over, or a crash in between would lose it.
        await this.deps.sessions.flushed?.();
      }
      await this.deps.store.end(job.caller);
    } finally {
      // Only now may a turn that waited on the merge start: it reads the report, not "still running".
      this.jobs.delete(job.workspaceId);
      this.holds.delete(job.workspaceId);
      job.release?.();
    }
    await this.startReportTurn(job.caller, job.workspaceId);
  }

  /**
   * Starts the turn that reads the report once the folder is idle. A turn the person starts first
   * reads it instead, and then there is nothing left to start.
   */
  private async startReportTurn(caller: string, workspaceId: string | null): Promise<void> {
    if (workspaceId) await this.untilIdle(workspaceId);
    const seed = this.deps.sessions.get(caller)?.seedContext ?? "";
    const report = reportIn(seed);
    if (!report) return;
    // Out of the saved context and into the turn's own prompt, where the person sees it too; back
    // into the saved context if the turn does not run after all.
    const rest = seed.replace(report, "").replace(/\n{3,}/g, "\n\n").trim();
    this.deps.sessions.update(caller, { seedContext: rest || null });
    const stop = await this.deps.startTurn(caller, report, REPORT_ORIGIN).catch((error) => {
      log(`split_work report turn for ${caller} did not run: ${String(error)}`);
      return null;
    });
    if (stop === null || stop === "not-sent") this.appendSeed(caller, report);
  }

  private splitDeps(job: Job, session: SessionRecord, plan: SplitPlan): SplitDeps {
    return {
      requireWorkspace: (id) => this.deps.workspaces.requireWorkspace(id),
      createWorktree: async (parent, project, name, base) => {
        const workspace = await this.deps.workspaces.createWorkspace({ projectId: project.id, name, baseRef: base, parentWorkspaceId: parent.id });
        job.created.push(workspace);
        await copyLocalSettings(project.path, parent.path, workspace.path);
        await this.deps.store.update(job.caller, (s) => s.worktrees.push({ workspaceId: workspace.id, name: workspace.name, branch: workspace.branch, path: workspace.path }));
        return workspace;
      },
      prepare: (project, workspace) => this.deps.runSetupHook(project, workspace.path),
      runHelper: (workspace, part, text) =>
        this.gate.run(async () => {
          if (job.abort.signal.aborted) return { text: "", finished: false, why: "the split was stopped" };
          const record = this.deps.sessions.create({
            workspaceId: workspace.id,
            cwd: workspace.path,
            title: part.title,
            // Folded under the chat in the sidebar: the person talks to the chat that split the work.
            origin: "workflow",
            parentId: job.caller,
            // The person approved the split (split_work asks), so its helpers' edits, which stay in
            // their own worktrees, need not be approved one by one; commands still ask as the chat's do.
            options: { ...session.options, permissionMode: session.options.permissionMode === "default" ? "acceptEdits" : session.options.permissionMode },
          });
          job.helpers.set(workspace.id, record.id);
          this.helpers.add(record.id);
          await this.deps.store.addHelper(record.id);
          if (this.deps.autoApprove.has(job.caller)) this.deps.autoApprove.add(record.id);
          // A stop that lands before the turn has registered itself still reaches it.
          const watch = setInterval(() => {
            if (job.abort.signal.aborted) this.deps.pendingTurns.get(record.id)?.abort();
          }, this.deps.pollMs ?? 500);
          try {
            const turn = await this.deps.runHelperTurn(record.id, text, { kind: "step-task", workflow: "Split work", step: part.title });
            // Done only when the turn ended on its own and the helper said so: a stop, an error, a
            // usage limit, running out of turns, or "I could not finish" all keep the part out.
            const failed = this.deps.sessions.get(record.id)?.status === "error";
            const ended = turn.stopReason === "end_turn" && !failed && !job.abort.signal.aborted;
            const finished = ended && turn.done === true;
            const why = finished
              ? undefined
              : !ended
                ? (turn.why ?? (failed ? "its turn ended with an error" : `its turn ended: ${turn.stopReason}`))
                : turn.done === false
                  ? "its helper said the part is not done"
                  : "its helper did not say whether the part is done";
            return { text: turn.text, finished, ...(why ? { why } : {}) };
          } finally {
            clearInterval(watch);
            this.deps.autoApprove.delete(record.id);
          }
        }),
      removeWorktree: (workspace, project) => this.removePart(workspace, project, plan.parent.path, job.helpers.get(workspace.id)),
      stopped: () => job.abort.signal.aborted,
      // Every chat in the folder has ended its turn before anything is merged, and until the merges
      // are done a new turn there waits (the harness awaits hold() before starting one).
      beforeMerge: async () => {
        // The parts are done: no turn from here on is told they are still running.
        job.note = "";
        for (let asked = 0; ; ) {
          await this.untilIdle(job.workspaceId);
          // Stopped: nothing will be merged, so the chat is neither asked to commit nor told of a merge.
          if (job.abort.signal.aborted) return;
          // The chat's uncommitted changes would keep every part out: it gets a turn to commit them.
          // Asked once: a chat that leaves them (they are the person's, say) is not asked again.
          if (asked < 1 && this.deps.sessions.get(job.caller) && (await trackedChanges(plan.parent.path))) {
            asked++;
            await this.deps
              .startTurn(job.caller, COMMIT_FIRST_PROMPT, { kind: "harness-note", title: "Split work: commit before merging" })
              .catch((error) => log(`split_work commit turn for ${job.caller} did not run: ${String(error)}`));
            continue;
          }
          // Checked and held in one step, with nothing awaited between: no turn can start in between.
          if (this.folderBusy(job.workspaceId)) continue;
          // Held until the report is saved (run() releases it), so a waiting turn reads the report.
          this.holds.set(job.workspaceId, new Promise<void>((resolve) => (job.release = resolve)));
          break;
        }
        await this.deps.store.update(job.caller, (s) => (s.merging = true));
        this.deps.notice(job.caller, "Merging the finished parts into this branch");
      },
      afterMerge: () => {
        void this.deps.store.update(job.caller, (s) => (s.merging = false));
      },
      progress: (line) => this.deps.notice(job.caller, line),
      partStarted: (part) => void job.states.set(part.title, "working"),
      partEnded: (part, workspace, status) => {
        job.states.set(part.title, status === "ready" ? "finished, waiting to be merged" : status);
        // Every part has ended: no turn from here on is told they are still running.
        if (++job.ended >= job.titles.length) job.note = "";
        if (!workspace) return;
        void this.deps.store.update(job.caller, (s) => {
          const worktree = s.worktrees.find((w) => w.workspaceId === workspace.id);
          if (worktree) worktree.finished = status === "ready";
        });
      },
    };
  }

  /** Removes a part's worktree, its branch (merged into the chat's, so checked from the chat's folder) and its helper. */
  private async removePart(workspace: Workspace, project: Project, parentPath: string, helper: string | undefined): Promise<void> {
    // A finished turn may still hold the folder open; on Windows the removal would fail.
    if (this.chatsIn(workspace.id).some((chat) => this.deps.pendingTurns.has(chat.id))) {
      throw new Error(`a chat is working in ${workspace.path}, so it was kept.`);
    }
    if (helper) await this.deps.releaseFinishedTurn(helper);
    for (const chat of this.chatsIn(workspace.id)) await this.deps.releaseFinishedTurn(chat.id);
    // Checked before the archive hook tears anything down: git would refuse to remove it anyway.
    if ((await git(workspace.path, ["status", "--porcelain"])).trim()) throw new Error(`${workspace.path} has uncommitted changes, so it was kept.`);
    // A commit made there after the merge (the person asked its chat for more) is not in the chat's
    // branch: the worktree stays rather than leaving that commit on a branch no one looks at.
    if (workspace.branch) {
      const merged = await git(parentPath, ["merge-base", "--is-ancestor", workspace.branch, "HEAD"], { quiet: true }).then(() => true, () => false);
      if (!merged) throw new Error(`${workspace.branch} has commits your branch does not have, so its worktree was kept.`);
    }
    this.deps.closeTerminals(workspace.id);
    await this.deps.runArchiveHook(project, workspace.path);
    await this.deps.workspaces.removeWorkspace({ workspaceId: workspace.id });
    await this.deps.sessions.removeWorkspace(workspace.id);
    if (workspace.branch) {
      // -d refuses a branch that is not merged into the chat's branch: nothing is ever lost this way.
      await git(parentPath, ["branch", "-d", "--", workspace.branch], { quiet: true }).catch((error) => log(`kept branch ${workspace.branch}: ${String(error)}`));
    }
    await this.deps.store.unkeep(workspace.id);
    await this.deps.store.forgetWorktree(workspace.id);
  }

  /** Removes the kept parts the chat has since brought into its branch; says what is left. */
  private async tidy(caller: string): Promise<string> {
    const session = this.deps.sessions.get(caller);
    if (!session?.workspaceId) return "Nothing to tidy.";
    const { workspace: parent, project } = this.deps.workspaces.requireWorkspace(session.workspaceId);
    const removed: string[] = [];
    const left: string[] = [];
    for (const part of this.deps.store.keptFor(caller)) {
      if (!this.exists(part.workspaceId)) {
        await this.deps.store.unkeep(part.workspaceId);
        continue;
      }
      const { workspace } = this.deps.workspaces.requireWorkspace(part.workspaceId);
      const helperBusy = this.chatsIn(workspace.id).some((s) => this.deps.pendingTurns.has(s.id));
      const merged =
        !!workspace.branch &&
        (await git(parent.path, ["merge-base", "--is-ancestor", workspace.branch, "HEAD"], { quiet: true }).then(
          () => true,
          () => false,
        ));
      const clean = !(await git(workspace.path, ["status", "--porcelain"]).then((s) => s.trim().length > 0, () => true));
      if (merged && clean && !helperBusy) {
        await this.removePart(workspace, project, parent.path, undefined);
        removed.push(workspace.branch ?? workspace.name);
      } else {
        left.push(`${workspace.branch ?? workspace.name} (${workspace.path}): ${!merged ? "not in your branch yet" : !clean ? "has uncommitted changes" : "its helper is working"}`);
      }
    }
    if (removed.length === 0 && left.length === 0) return "No kept parts to tidy.";
    return [
      removed.length > 0 ? `Removed ${removed.join(", ")}: their work is in your branch.` : "",
      left.length > 0 ? `Kept, because they hold work your branch does not have yet:\n${left.map((l) => `- ${l}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private chatsIn(workspaceId: string): SessionRecord[] {
    return this.deps.sessions.all().filter((s) => s.workspaceId === workspaceId);
  }

  private exists(workspaceId: string): boolean {
    try {
      this.deps.workspaces.requireWorkspace(workspaceId);
      return true;
    } catch {
      return false;
    }
  }

  /** Resolves once no chat in the folder has a turn running or its conversation in a terminal. */
  private async untilIdle(workspaceId: string): Promise<void> {
    while (this.folderBusy(workspaceId)) await Bun.sleep(this.deps.pollMs ?? 500);
  }

  private folderBusy(workspaceId: string): boolean {
    return this.chatsIn(workspaceId).some((s) => this.deps.pendingTurns.has(s.id) || this.deps.cliHasConversation(s.id));
  }

  /** Text the chat's next turn starts with, kept whole (seedContext is read and cleared by that turn). */
  private appendSeed(sessionId: string, text: string): void {
    const session = this.deps.sessions.get(sessionId);
    if (!session) return;
    this.deps.sessions.update(sessionId, { seedContext: [session.seedContext, text].filter(Boolean).join("\n\n") });
  }
}

/** A merge under way in `path` of one of `branches` (not one the person started by hand). */
async function mergingOneOf(path: string, branches: (string | null)[]): Promise<boolean> {
  const head = await git(path, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { quiet: true }).then((s) => s.trim(), () => null);
  if (!head) return false;
  for (const branch of branches) {
    if (!branch) continue;
    const tip = await git(path, ["rev-parse", "-q", "--verify", branch], { quiet: true }).then((s) => s.trim(), () => null);
    if (tip === head) return true;
  }
  return false;
}

async function trackedChanges(path: string): Promise<boolean> {
  return (await git(path, ["status", "--porcelain", "--untracked-files=no"])).trim().length > 0;
}

/** Under the agent's own timeout for a harness tool call (MANAGER_TOOL_TIMEOUT_MS, 35 minutes). */
const CONFIRM_TIMEOUT_MS = 30 * 60_000;

const COMMIT_FIRST_PROMPT =
  "[split_work] The parts you split off are done, but your folder has uncommitted changes, so they cannot be merged into it. Commit the changes you made, then end your turn; the merge follows. Never undo or discard changes you did not make yourself (the person may be editing): if there are any, ask the person what to do instead.";

/**
 * The person's own permission rules for the chat's folder (`.claude/settings.local.json`, which git
 * ignores) go with each part, so a helper is not asked again for what they already allowed there.
 */
async function copyLocalSettings(repo: string, from: string, to: string): Promise<void> {
  const source = join(from, ".claude", "settings.local.json");
  const target = join(to, ".claude", "settings.local.json");
  if (!existsSync(source) || existsSync(target)) return;
  // Only where git ignores it: a file git would see would make every part look unfinished.
  const ignored = await git(repo, ["check-ignore", "-q", "--", ".claude/settings.local.json"], { quiet: true }).then(
    () => true,
    () => false,
  );
  if (!ignored) return;
  try {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  } catch (error) {
    log(`could not copy ${source}: ${String(error)}`);
  }
}

