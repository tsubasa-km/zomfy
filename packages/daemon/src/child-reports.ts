import type * as acp from "@agentclientprotocol/sdk";
import {
  CHAT_META,
  MANAGER_MCP_SERVER_NAME,
  agentStepsOf,
  normalizeWrapUp,
  personActionsOf,
  type PromptOrigin,
  type SessionInfo,
  type SessionStatus,
  type WrapUpCard,
} from "@zomfy/protocol";
import type { SessionRecord } from "./session-registry.ts";

// A chat an agent prompted (send_prompt, create_session, create_workspace) reports to the chat that
// prompted it, its launcher, when that turn stops: the daemon starts a turn in the launcher with a
// note, or keeps the note for the launcher's next turn (docs/specs/child-threads-report-home.md).
// wait_for_session on this host's chats waits here too, so it needs no window.

export interface ChildReportsDeps {
  sessions: {
    get(id: string): SessionRecord | undefined;
    update(id: string, patch: Partial<SessionRecord>): void;
    transcript(id: string): Promise<acp.SessionUpdate[]>;
    onChange(listener: (list: SessionInfo[]) => void): () => void;
  };
  /** A turn runs in the chat now. */
  busy(sessionId: string): boolean;
  /** No turn can start in the chat now (its conversation is open in a Claude terminal). */
  blocked(sessionId: string): boolean;
  /** Starts a turn; resolves with its stop reason once it ends, or "not-sent" when none ran. */
  startTurn(sessionId: string, text: string, origin: PromptOrigin): Promise<string>;
  /** Titles of the chat's unanswered approvals and questions. */
  waitingOn(sessionId: string): string[];
  log(text: string): void;
  /** Quiet time after the last stop before a report goes out. */
  batchMs?: number;
  /** The longest a report waits for more stops. */
  maxBatchMs?: number;
  /** How long a chat just prompted reads as working before its turn starts. */
  inFlightMs?: number;
  /** Delay after the launcher's own turn ends before a kept report starts its turn. */
  afterTurnMs?: number;
  pollMs?: number;
  now?: () => number;
}

type Outcome = "finished" | "needs-you" | "failed";
interface Stop {
  childId: string;
  outcome: Outcome;
  waitingOn: string[];
}
interface Queue {
  stops: Map<string, Stop>;
  timer: ReturnType<typeof setTimeout> | null;
  firstAt: number;
  /** Set while the launcher's turn runs: the report goes once that turn ends. */
  afterTurn: boolean;
}

export interface WaitReport {
  sessionId: string;
  title?: string;
  status: SessionStatus | "gone" | "working";
  lastReply?: string;
  waitingOn?: string[];
}

export const REPORT_HEADING = "[Chats you started have stopped]";
const WITHHELD = "(withheld: it holds local-only data)";
const WRAP_UP_TOOL = `mcp__${MANAGER_MCP_SERVER_NAME}__wrap_up`;
const MAX_REPLY = 3000;

/** A wrap_up as one line for the launching chat: what it asks of the person, then what it will do. */
export function wrapUpLine(card: WrapUpCard): string {
  const person = personActionsOf(card).map((step) => (step.owner === "person" ? step.text : `${step.owner}: ${step.text}`));
  const agent = agentStepsOf(card).map((step) => step.text);
  const parts = [
    person.length > 0 ? `for the person: ${person.join("; ")}` : card.question ? "" : "nothing for the person",
    card.question ? `asks: ${card.question.text} (${card.question.options.join(" / ")})` : "",
    agent.length > 0 ? `it will next: ${agent.join("; ")}` : "",
    // Older calls carried a summary.
    card.summary ? `summary: ${card.summary}` : "",
  ];
  return parts.filter(Boolean).join(". ");
}
const TURN_LIMIT = 10;
const TURN_LIMIT_WINDOW_MS = 10 * 60_000;

export class ChildReports {
  /** The chat that prompted each chat's current turn. */
  private readonly launchers = new Map<string, { caller: string; at: number }>();
  private readonly turnStarts = new Map<string, number>();
  private readonly statuses = new Map<string, SessionStatus>();
  private readonly queues = new Map<string, Queue>();
  /** When report turns started, per launcher, for the loop guard. */
  private readonly reportTurns = new Map<string, number[]>();
  private readonly batchMs: number;
  private readonly maxBatchMs: number;
  private readonly inFlightMs: number;
  private readonly afterTurnMs: number;
  private readonly pollMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: ChildReportsDeps) {
    this.batchMs = deps.batchMs ?? 3000;
    this.maxBatchMs = deps.maxBatchMs ?? 15_000;
    this.inFlightMs = deps.inFlightMs ?? 30_000;
    this.afterTurnMs = deps.afterTurnMs ?? 1000;
    this.pollMs = deps.pollMs ?? 250;
    this.now = deps.now ?? Date.now;
    deps.sessions.onChange((list) => this.sessionsChanged(list));
  }

  /**
   * `caller` prompted `target` (a manager tool call that succeeded; `at` is when the call began).
   * Never set up toward the chat that launched the caller, or the caller's parent: no report loops.
   */
  launched(caller: string, target: string, at = this.now()): void {
    const child = this.deps.sessions.get(target);
    const lead = this.deps.sessions.get(caller);
    if (!child || !lead || target === caller) return;
    if (this.launchers.get(caller)?.caller === target || lead.parentId === target || lead.sideOf === target) return;
    // split_work's helpers and a workflow's chats are reported by their own coordinators.
    if (child.origin === "workflow") return;
    this.launchers.set(target, { caller, at });
  }

  /** A turn started in the chat. */
  turnStarted(sessionId: string): void {
    this.turnStarts.set(sessionId, this.now());
  }

  /** The chat's turn ended: a report kept for it goes now. */
  turnEnded(sessionId: string): void {
    const queue = this.queues.get(sessionId);
    if (!queue?.afterTurn) return;
    queue.afterTurn = false;
    this.arm(sessionId, queue, this.afterTurnMs);
  }

  /** The chat was prompted and its turn has not started yet. */
  inFlight(sessionId: string): boolean {
    const launch = this.launchers.get(sessionId);
    if (!launch) return false;
    return launch.at >= (this.turnStarts.get(sessionId) ?? -Infinity) && this.now() - launch.at < this.inFlightMs;
  }

  /** wait_for_session told the caller these chats stopped: they leave its report. */
  delivered(caller: string, childIds: string[]): void {
    const queue = this.queues.get(caller);
    if (!queue) return;
    for (const id of childIds) queue.stops.delete(id);
    if (queue.stops.size === 0) this.drop(caller);
  }

  /** How a chat reads to wait_for_session: null while it works. */
  settled(sessionId: string): SessionStatus | "gone" | null {
    const session = this.deps.sessions.get(sessionId);
    if (!session) return "gone";
    if (session.status === "needs-you") return "needs-you";
    if (session.status === "working" || this.deps.busy(sessionId) || this.inFlight(sessionId)) return null;
    return session.status;
  }

  /** wait_for_session on this host's chats: until one (or every one) stops, the timeout, or the caller's turn stops. */
  async wait(caller: string, ids: string[], options: { timeoutMs: number; all: boolean; active: () => boolean }): Promise<{ timedOut: boolean; sessions: WaitReport[]; next?: string }> {
    const deadline = this.now() + options.timeoutMs;
    const done = () => (options.all ? ids.every((id) => this.settled(id) !== null) : ids.some((id) => this.settled(id) !== null));
    while (!done() && this.now() < deadline && options.active()) await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    const sessions = await Promise.all(
      ids.map(async (id): Promise<WaitReport> => {
        const status = this.settled(id);
        const session = this.deps.sessions.get(id);
        if (!session) return { sessionId: id, status: "gone" };
        const { lastReply } = await this.said(session);
        const waitingOn = this.deps.waitingOn(id);
        return {
          sessionId: id,
          title: session.title,
          status: status ?? "working",
          ...(lastReply ? { lastReply } : {}),
          ...(waitingOn.length > 0 ? { waitingOn } : {}),
        };
      }),
    );
    const finished = sessions.filter((s) => s.status !== "working").map((s) => s.sessionId);
    this.delivered(caller, finished);
    const timedOut = !done();
    return { timedOut, sessions, ...(timedOut ? { next: "Still working: wait again, read_session, or end your turn; you will be told when they stop." } : {}) };
  }

  private sessionsChanged(list: SessionInfo[]): void {
    const ids = new Set(list.map((s) => s.id));
    for (const session of list) {
      const before = this.statuses.get(session.id);
      this.statuses.set(session.id, session.status);
      if (before === "working" && session.status !== "working") this.stopped(session.id, session.status);
    }
    for (const id of [...this.statuses.keys()]) {
      if (ids.has(id)) continue;
      this.statuses.delete(id);
      this.turnStarts.delete(id);
      this.drop(id);
      this.reportTurns.delete(id);
      const launch = this.launchers.get(id);
      this.launchers.delete(id);
      // A closed sibling no longer holds the others' report back.
      const queue = launch ? this.queues.get(launch.caller) : undefined;
      if (launch && queue && !queue.afterTurn && !queue.timer) this.arm(launch.caller, queue, 0);
    }
  }

  private stopped(childId: string, status: SessionStatus): void {
    const launch = this.launchers.get(childId);
    if (!launch) return;
    const outcome: Outcome = status === "needs-you" ? "needs-you" : status === "error" ? "failed" : "finished";
    // A turn the person or the chat itself starts next is not the launcher's to hear about.
    if (outcome !== "needs-you") this.launchers.delete(childId);
    if (!this.deps.sessions.get(launch.caller)) return;
    let queue = this.queues.get(launch.caller);
    if (!queue) {
      queue = { stops: new Map(), timer: null, firstAt: this.now(), afterTurn: false };
      this.queues.set(launch.caller, queue);
    }
    queue.stops.set(childId, { childId, outcome, waitingOn: outcome === "needs-you" ? this.deps.waitingOn(childId) : [] });
    if (!queue.afterTurn) this.arm(launch.caller, queue, Math.max(0, Math.min(this.batchMs, queue.firstAt + this.maxBatchMs - this.now())));
  }

  private arm(caller: string, queue: Queue, delay: number): void {
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = setTimeout(() => {
      queue.timer = null;
      void this.flush(caller).catch((error) => this.deps.log(`reporting to ${caller} failed: ${String(error)}`));
    }, delay);
  }

  private drop(caller: string): void {
    const queue = this.queues.get(caller);
    if (queue?.timer) clearTimeout(queue.timer);
    this.queues.delete(caller);
  }

  /** Other chats the caller prompted that still work. */
  private stillWorking(caller: string, except: Map<string, Stop>): string[] {
    return [...this.launchers]
      .filter(([id, launch]) => launch.caller === caller && !except.has(id) && (this.deps.sessions.get(id)?.status === "working" || this.inFlight(id)))
      .map(([id]) => id);
  }

  private async flush(caller: string): Promise<void> {
    const queue = this.queues.get(caller);
    if (!queue || queue.stops.size === 0) return this.drop(caller);
    const lead = this.deps.sessions.get(caller);
    if (!lead) return this.drop(caller);
    const working = this.stillWorking(caller, queue.stops);
    // Finished work waits for its siblings: one turn when the last is done. A child that needs the person or failed goes now.
    if (working.length > 0 && [...queue.stops.values()].every((s) => s.outcome === "finished")) {
      // Looked at again later too, in case a sibling's prompt never started a turn.
      this.arm(caller, queue, this.inFlightMs);
      return;
    }
    if (this.deps.busy(caller)) {
      queue.afterTurn = true;
      return;
    }
    const stops = [...queue.stops.values()];
    this.drop(caller);
    const text = await this.reportText(stops, working.length);
    const origin = this.originOf(stops);
    const recent = (this.reportTurns.get(caller) ?? []).filter((at) => this.now() - at < TURN_LIMIT_WINDOW_MS);
    if (lead.archived || this.deps.blocked(caller) || lead.status === "error" || recent.length >= TURN_LIMIT) {
      if (recent.length >= TURN_LIMIT) this.deps.log(`${caller} had ${recent.length} report turns in ten minutes; the next report waits for its next turn`);
      return this.keepForNextTurn(caller, text);
    }
    this.reportTurns.set(caller, [...recent, this.now()]);
    const stop = await this.deps.startTurn(caller, text, origin).catch((error) => {
      this.deps.log(`report turn for ${caller} did not run: ${String(error)}`);
      return "not-sent";
    });
    if (stop !== "not-sent") return;
    // Another turn took the chat first: the report goes after it, or with the next one.
    if (this.deps.busy(caller) && this.deps.sessions.get(caller)) {
      const again = this.queues.get(caller) ?? { stops: new Map(), timer: null, firstAt: this.now(), afterTurn: true };
      for (const s of stops) if (!again.stops.has(s.childId)) again.stops.set(s.childId, s);
      again.afterTurn = true;
      this.queues.set(caller, again);
      return;
    }
    if (this.deps.sessions.get(caller)) this.keepForNextTurn(caller, text);
  }

  private keepForNextTurn(caller: string, text: string): void {
    const seed = this.deps.sessions.get(caller)?.seedContext;
    this.deps.sessions.update(caller, { seedContext: [seed, text].filter(Boolean).join("\n\n") });
  }

  private originOf(stops: Stop[]): PromptOrigin {
    if (stops.length > 1) return { kind: "harness-note", title: `Helpers reported: ${stops.length} chats stopped` };
    const stop = stops[0]!;
    const title = this.deps.sessions.get(stop.childId)?.title ?? "a chat";
    const what = stop.outcome === "finished" ? "Helper finished" : stop.outcome === "failed" ? "Helper failed" : "Helper needs the person";
    return { kind: "harness-note", title: `${what}: ${title}` };
  }

  private async reportText(stops: Stop[], working: number): Promise<string> {
    const lines = [REPORT_HEADING];
    for (const stop of stops) {
      const session = this.deps.sessions.get(stop.childId);
      if (!session) {
        lines.push(`- A chat you started (sessionId ${stop.childId}) stopped and was closed.`);
        continue;
      }
      const what =
        stop.outcome === "finished"
          ? "finished."
          : stop.outcome === "failed"
            ? "stopped with an error."
            : `needs the person${stop.waitingOn.length > 0 ? `: waiting on ${stop.waitingOn.join(", ")}` : ""}. If you can decide, answer with answer_approval (list_approvals gives the ids); otherwise tell the person, who sees the question in this thread.`;
      lines.push(`- "${session.title}" (sessionId ${session.id}) ${what}`);
      const { lastReply, wrapUp } = await this.said(session);
      if (wrapUp) lines.push(`  Its wrap-up: ${wrapUp}`);
      if (lastReply) lines.push("  Its last reply:", ...lastReply.split("\n").map((line) => `  > ${line}`));
    }
    if (working > 0) lines.push(`${working} other chat${working === 1 ? "" : "s"} you started ${working === 1 ? "is" : "are"} still working; you will be told when ${working === 1 ? "it stops" : "they stop"}.`);
    return lines.join("\n");
  }

  /** What the chat said in its last turn, and what its wrap_up asks of the person. */
  private async said(session: SessionRecord): Promise<{ lastReply: string; wrapUp: string }> {
    if (session.localOnly) return { lastReply: WITHHELD, wrapUp: "" };
    const transcript = await this.deps.sessions.transcript(session.id);
    const start = transcript.findLastIndex((u) => u.sessionUpdate === "user_message_chunk") + 1;
    let reply = "";
    let wrapUp = "";
    for (const update of transcript.slice(start)) {
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") reply += update.content.text;
      if (update.sessionUpdate === "tool_call" && update._meta?.[CHAT_META.toolName] === WRAP_UP_TOOL) {
        const card = normalizeWrapUp(update.rawInput);
        if (card) wrapUp = wrapUpLine(card).replace(/\s+/g, " ").trim().slice(0, 1000);
      }
    }
    reply = reply.trim();
    // The end of the turn holds its answer.
    return { lastReply: reply.length > MAX_REPLY ? `…${reply.slice(-MAX_REPLY)}` : reply, wrapUp };
  }
}
