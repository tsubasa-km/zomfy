import type { SessionWakeUp } from "@zomfy/protocol";

// Wake-ups whose Claude process went before they fired (a Stop, a relaunch, the daemon's restart):
// the daemon fires the one-shot ones itself, as a turn in the chat (docs/specs/scheduled-wake-ups.md).

/** A wake-up this late (the daemon was down) is dropped rather than fired. */
export const WAKE_UP_LATE_MS = 60 * 60_000;
/** How soon a wake-up that found its chat busy tries again. */
const BUSY_RETRY_MS = 30_000;

export type WakeUpFire = (sessionId: string, wakeUp: SessionWakeUp) => Promise<"started" | "busy" | "gone">;

interface Held {
  wakeUp: SessionWakeUp;
  timer: ReturnType<typeof setTimeout>;
}

export class HeldWakeUps {
  private readonly held = new Map<string, Map<string, Held>>();

  constructor(
    private readonly deps: {
      fire: WakeUpFire;
      /** Says in the chat that a wake-up will not fire. */
      notice: (sessionId: string, title: string) => void;
      /** The chat's held wake-ups changed. */
      changed: (sessionId: string) => void;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The chat's wake-ups the daemon holds, soonest first. */
  list(sessionId: string): SessionWakeUp[] {
    return [...(this.held.get(sessionId)?.values() ?? [])].map((h) => h.wakeUp).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  }

  /**
   * Takes over wake-ups their process can no longer fire. `why` ends the notice for the ones that
   * cannot be kept: a recurring one, one with no time, or one too late.
   */
  hold(sessionId: string, wakeUps: SessionWakeUp[], why: string): void {
    const now = this.now();
    for (const wakeUp of wakeUps) {
      const what = wakeUp.prompt ? `"${wakeUp.prompt.replace(/\s+/g, " ").slice(0, 80)}"` : wakeUp.id;
      if (wakeUp.recurring || wakeUp.at === null) {
        this.deps.notice(sessionId, `Stopped the scheduled task ${what}: ${why}`);
        continue;
      }
      if (wakeUp.at < now - WAKE_UP_LATE_MS) {
        this.deps.notice(sessionId, `Dropped the scheduled wake-up ${what}: it was due over an hour ago`);
        continue;
      }
      this.arm(sessionId, wakeUp, Math.max(0, wakeUp.at - now));
    }
    this.deps.changed(sessionId);
  }

  /** Forgets the chat's wake-ups (it was deleted, or handed elsewhere). */
  drop(sessionId: string): void {
    const mine = this.held.get(sessionId);
    if (!mine) return;
    for (const h of mine.values()) clearTimeout(h.timer);
    this.held.delete(sessionId);
    this.deps.changed(sessionId);
  }

  private arm(sessionId: string, wakeUp: SessionWakeUp, ms: number): void {
    const mine = this.held.get(sessionId) ?? new Map<string, Held>();
    this.held.set(sessionId, mine);
    const existing = mine.get(wakeUp.id);
    if (existing) clearTimeout(existing.timer);
    mine.set(wakeUp.id, { wakeUp, timer: setTimeout(() => void this.fire(sessionId, wakeUp), ms) });
  }

  private async fire(sessionId: string, wakeUp: SessionWakeUp): Promise<void> {
    const mine = this.held.get(sessionId);
    if (!mine?.has(wakeUp.id)) return;
    const outcome = await this.deps.fire(sessionId, wakeUp).catch(() => "gone" as const);
    if (outcome === "busy") return this.arm(sessionId, wakeUp, BUSY_RETRY_MS);
    mine.delete(wakeUp.id);
    if (mine.size === 0) this.held.delete(sessionId);
    this.deps.changed(sessionId);
  }
}
