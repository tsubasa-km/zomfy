import type { AutoResumeState, TurnEndMeta } from "@acp-harness/protocol";
import type { SessionRegistry } from "./session-registry.ts";
import { log } from "./log.ts";

// "Resume automatically when the limit resets": the daemon, which runs the turns, owns the
// schedule, so it fires with every window closed. The state sits on the session record, which the
// registry persists under the harness home, so a restarted daemon re-arms it.

/** Limits reset on the minute; a little slack keeps the first try from landing just before. */
const RESET_GRACE_MS = 60_000;
/** No reset time known: try again after 15, 30, then every 60 minutes. */
const BACKOFF_MS = [15, 30, 60].map((minutes) => minutes * 60_000);
/** About half a day of hourly tries, then give up rather than retry forever. */
export const MAX_AUTO_RESUME_ATTEMPTS = 12;
/** A schedule already due when the daemon starts waits this long, so clients can connect first. */
const STARTUP_DELAY_MS = 10_000;
/** setTimeout's ceiling; weekly limits can reset further out, so long waits are chained. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function nextAutoResume(resetsAt: number | null, attempt: number, now: number): AutoResumeState {
  if (resetsAt !== null && resetsAt > now) return { fireAt: resetsAt + RESET_GRACE_MS, resetKnown: true, attempt };
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 60 * 60_000;
  return { fireAt: now + delay, resetKnown: false, attempt };
}

export type AutoResumeFire = (sessionId: string) => Promise<"started" | "busy" | "gone">;

export class TurnAutoResume {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly fire: AutoResumeFire,
    private readonly gaveUp: (sessionId: string) => void,
  ) {}

  /** Re-arms what a previous daemon scheduled. */
  start(): void {
    for (const session of this.sessions.all()) {
      if (session.autoResume) this.arm(session.id, session.autoResume, STARTUP_DELAY_MS);
    }
  }

  enable(sessionId: string, resetsAt: number | null, now = Date.now()): void {
    this.set(sessionId, nextAutoResume(resetsAt, 0, now));
  }

  disable(sessionId: string): void {
    this.clearTimer(sessionId);
    if (this.sessions.get(sessionId)?.autoResume) this.sessions.update(sessionId, { autoResume: null });
  }

  /** After every turn: another usage limit schedules the next try; any other ending stops it. */
  turnEnded(sessionId: string, end: TurnEndMeta | null, now = Date.now()): void {
    const current = this.sessions.get(sessionId)?.autoResume;
    if (!current) return;
    if (end?.reason !== "usage-limit") {
      this.disable(sessionId);
      return;
    }
    const attempt = current.attempt + 1;
    if (attempt >= MAX_AUTO_RESUME_ATTEMPTS) {
      this.disable(sessionId);
      this.gaveUp(sessionId);
      return;
    }
    this.set(sessionId, nextAutoResume(end.resetsAt, attempt, now));
  }

  private set(sessionId: string, state: AutoResumeState): void {
    this.sessions.update(sessionId, { autoResume: state });
    this.arm(sessionId, state, 0);
  }

  private arm(sessionId: string, state: AutoResumeState, minDelay: number): void {
    this.clearTimer(sessionId);
    const delay = Math.max(minDelay, state.fireAt - Date.now());
    if (delay > MAX_TIMER_MS) {
      this.timers.set(sessionId, setTimeout(() => this.arm(sessionId, state, 0), MAX_TIMER_MS));
      return;
    }
    this.timers.set(
      sessionId,
      setTimeout(() => {
        this.timers.delete(sessionId);
        void this.run(sessionId);
      }, delay),
    );
  }

  private async run(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)?.autoResume;
    if (!state) return;
    try {
      const outcome = await this.fire(sessionId);
      if (outcome === "gone") this.timers.delete(sessionId);
      // A turn the user started is running; its end decides, but check back in case it never ends.
      else if (outcome === "busy") this.arm(sessionId, { ...state, fireAt: Date.now() + 2 * 60_000 }, 0);
    } catch (error) {
      log(`auto-resume of ${sessionId} failed: ${String(error)}`);
      this.turnEnded(sessionId, { reason: "usage-limit", resetsAt: null });
    }
  }

  private clearTimer(sessionId: string): void {
    clearTimeout(this.timers.get(sessionId));
    this.timers.delete(sessionId);
  }
}
