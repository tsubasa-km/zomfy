import * as acp from "@agentclientprotocol/sdk";
import {
  CHAT_META,
  PERMISSION_ASK_META,
  PERMISSION_ASK_NOTIFICATIONS,
  type PermissionAskResolved,
  type QuestionAnswers,
} from "@zomfy/protocol";

// A permission ask goes to every connected client at once (windows, paired phones) and the first
// answer wins; the rest hear `_harness/permissions/resolved` and close their card. A client that
// connects while an ask waits is asked too. With no client holding the ask, it is denied after
// `waitMs` (a window that drops usually comes back). See docs/specs/mobile/overview.md (M0).

export interface AskEveryClientDeps {
  /** The clients connected now, as their connections made them. */
  clients: () => Iterable<acp.AgentContext>;
  /** Settles when that client's connection closes. */
  closed: (client: acp.AgentContext) => Promise<void>;
  broadcast: (method: string, params: unknown) => void;
  waitMs: number;
}

export type AskOutcome = { response: acp.RequestPermissionResponse; unanswered: boolean };

interface PendingAsk {
  askId: string;
  params: acp.RequestPermissionRequest;
  holders: Set<acp.AgentContext>;
  asked: Set<acp.AgentContext>;
  /** A client answered "cancelled" while others still held the ask; it wins only if they all go. */
  cancelledBy: acp.RequestPermissionResponse | null;
  timer: ReturnType<typeof setTimeout> | null;
  settle: (outcome: AskOutcome) => void;
}

const CANCELLED: acp.RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

export class AskEveryClient {
  private readonly pending = new Map<string, PendingAsk>();
  constructor(private readonly deps: AskEveryClientDeps) {}

  /** Asks every client; `unanswered` is true when nobody held the ask long enough to answer it. */
  ask(request: acp.RequestPermissionRequest, signal?: AbortSignal): Promise<AskOutcome> {
    const askId = crypto.randomUUID();
    const params: acp.RequestPermissionRequest = {
      ...request,
      _meta: { ...request._meta, [PERMISSION_ASK_META.askId]: askId },
    };
    return new Promise<AskOutcome>((resolve) => {
      const entry: PendingAsk = {
        askId,
        params,
        holders: new Set(),
        asked: new Set(),
        cancelledBy: null,
        timer: null,
        settle: (outcome) => {
          if (!this.pending.delete(askId)) return;
          if (entry.timer) clearTimeout(entry.timer);
          signal?.removeEventListener("abort", onAbort);
          const selected = outcome.response.outcome.outcome === "selected" ? outcome.response.outcome.optionId : null;
          const answers = (outcome.response._meta?.[CHAT_META.answers] as QuestionAnswers | undefined)?.answers;
          this.deps.broadcast(PERMISSION_ASK_NOTIFICATIONS.resolved, {
            sessionId: request.sessionId,
            askId,
            optionId: selected,
            ...(selected && answers ? { answers } : {}),
          } satisfies PermissionAskResolved);
          resolve(outcome);
        },
      };
      const onAbort = () => entry.settle({ response: CANCELLED, unanswered: false });
      if (signal?.aborted) return resolve({ response: CANCELLED, unanswered: false });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(askId, entry);
      for (const client of this.deps.clients()) this.send(entry, client);
      this.waitIfUnheld(entry);
    });
  }

  /** A client connected: it gets every ask still waiting. */
  connected(client: acp.AgentContext): void {
    for (const entry of [...this.pending.values()]) this.send(entry, client);
  }

  /** Withdraws every ask of a chat (its turn ended), as if it had been cancelled. */
  withdraw(sessionId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.params.sessionId === sessionId) entry.settle({ response: CANCELLED, unanswered: false });
    }
  }

  /** Asks waiting for an answer, for clients that list them. */
  waiting(): acp.RequestPermissionRequest[] {
    return [...this.pending.values()].map((e) => e.params);
  }

  private send(entry: PendingAsk, client: acp.AgentContext): void {
    if (entry.asked.has(client)) return;
    entry.asked.add(client);
    entry.holders.add(client);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const gone = this.deps.closed(client).then((): null => null);
    Promise.race([client.request(acp.methods.client.session.requestPermission, entry.params), gone]).then(
      (response) => {
        if (!this.pending.has(entry.askId)) return;
        entry.holders.delete(client);
        if (response === null) return this.stepOut(entry);
        if (response.outcome.outcome === "cancelled") {
          // A window that stopped showing the card (its chat went idle) does not speak for the rest.
          entry.cancelledBy = response;
          return this.stepOut(entry);
        }
        entry.settle({ response, unanswered: false });
      },
      () => {
        // A client that does not answer asks (the dashboard pop-out, a phone without the scope).
        entry.holders.delete(client);
        this.stepOut(entry);
      },
    );
  }

  private stepOut(entry: PendingAsk): void {
    if (entry.holders.size > 0 || !this.pending.has(entry.askId)) return;
    if (entry.cancelledBy) return entry.settle({ response: entry.cancelledBy, unanswered: false });
    this.waitIfUnheld(entry);
  }

  private waitIfUnheld(entry: PendingAsk): void {
    if (entry.holders.size > 0 || entry.timer || !this.pending.has(entry.askId)) return;
    entry.timer = setTimeout(() => entry.settle({ response: CANCELLED, unanswered: true }), this.deps.waitMs);
  }
}
