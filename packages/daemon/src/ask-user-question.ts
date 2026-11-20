import type * as acp from "@agentclientprotocol/sdk";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { CHAT_META, QUESTION_OPTION_IDS, type QuestionAnswers } from "@acp-harness/protocol";

// Claude's AskUserQuestion reaches the host as a permission ask, as every tool does. It is a question,
// not a tool to allow: the window shows its choices, and the person's picks go back to Claude as the
// tool's `answers` (the Claude apps answer it the same way).

export const QUESTION_TOOL = "AskUserQuestion";

/** What the window offers for a question: answer it (with the answers on `_meta`) or skip it. */
export const QUESTION_OPTIONS: acp.PermissionOption[] = [
  { kind: "allow_once", name: "Answer", optionId: QUESTION_OPTION_IDS.answer },
  { kind: "reject_once", name: "Skip", optionId: QUESTION_OPTION_IDS.skip },
];

/** The answers on a permission response, when it carries any. */
export function answersOf(response: acp.RequestPermissionResponse): Record<string, string> | null {
  const meta = response._meta?.[CHAT_META.answers] as Partial<QuestionAnswers> | undefined;
  const answers = meta?.answers;
  if (typeof answers !== "object" || answers === null) return null;
  const clean = Object.fromEntries(
    Object.entries(answers).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== ""),
  );
  return Object.keys(clean).length > 0 ? clean : null;
}

/** Claude's tool result for the person's reply to its questions. */
export function questionResult(input: Record<string, unknown>, response: acp.RequestPermissionResponse): PermissionResult {
  if (response.outcome.outcome === "cancelled") {
    return { behavior: "deny", message: "Cancelled by user", interrupt: true };
  }
  const answers = response.outcome.optionId === QUESTION_OPTION_IDS.answer ? answersOf(response) : null;
  if (!answers) {
    return { behavior: "deny", message: "The user skipped these questions without answering. Ask in your reply instead, or carry on with your best judgment and say what you chose." };
  }
  return { behavior: "allow", updatedInput: { ...input, answers } };
}
