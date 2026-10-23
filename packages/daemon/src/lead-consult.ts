import type { LeadConsultResult } from "@acp-harness/protocol";
import type { HandlerContext } from "./handlers/handler-context.ts";

// A session's question put to its project's Lead as a turn of its own. The Lead answers, or says
// it is the person's call and words the question for them. Questions to one Lead take turns, and
// wait for a turn the Lead is already in rather than cutting it short.

type Deps = Pick<HandlerContext, "sessions" | "pendingTurns" | "runStepTurn">;

const BUSY_WAIT_MS = 15 * 60_000;
const queues = new Map<string, Promise<unknown>>();

const SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["answer", "escalate"] },
    text: { type: "string" },
  },
  required: ["decision", "text"],
  additionalProperties: false,
};

export function consultLead(deps: Deps, leadSessionId: string, from: string, question: string): Promise<LeadConsultResult> {
  const previous = queues.get(leadSessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => ask(deps, leadSessionId, from, question));
  queues.set(leadSessionId, next);
  void next.finally(() => {
    if (queues.get(leadSessionId) === next) queues.delete(leadSessionId);
  });
  return next;
}

async function ask(deps: Deps, leadSessionId: string, from: string, question: string): Promise<LeadConsultResult> {
  if (!deps.sessions.get(leadSessionId)) return { escalate: question };
  const deadline = Date.now() + BUSY_WAIT_MS;
  while (deps.pendingTurns.has(leadSessionId)) {
    if (Date.now() > deadline) return { escalate: question };
    await Bun.sleep(2000);
  }
  const prompt = [
    `[Question from ${from}]`,
    question,
    "",
    "Answer it if you can from what you know of this project and the person's intent (look things up if that helps).",
    'Give your result as the structured output: "decision" is "answer" with the answer in "text", or "escalate" when it is the person\'s call, with the question for them in "text" (sharpened, with the options you see).',
  ].join("\n");
  const result = await deps.runStepTurn(leadSessionId, prompt, { outputFormat: { type: "json_schema", schema: SCHEMA } });
  const value = result.structured;
  if (value && typeof value === "object" && "decision" in value && "text" in value && typeof value.text === "string") {
    return value.decision === "escalate" ? { escalate: value.text || question } : { answer: value.text };
  }
  return result.text.trim() ? { answer: result.text.trim() } : { escalate: question };
}
