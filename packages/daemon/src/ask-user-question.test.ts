import { expect, test } from "bun:test";
import { CHAT_META, QUESTION_OPTION_IDS } from "@acp-harness/protocol";
import { questionResult } from "./ask-user-question.ts";

// An AskUserQuestion is answered with the person's picks as the tool's `answers`, or declined.

const input = { questions: [{ question: "Which one?", header: "Pick", options: [], multiSelect: false }] };

test("answers go back to Claude as the tool's answers", () => {
  const result = questionResult(input, {
    outcome: { outcome: "selected", optionId: QUESTION_OPTION_IDS.answer },
    _meta: { [CHAT_META.answers]: { answers: { "Which one?": "The first" } } },
  });
  expect(result).toEqual({ behavior: "allow", updatedInput: { ...input, answers: { "Which one?": "The first" } } });
});

test("a skip, or an answer with nothing in it, declines the tool", () => {
  for (const response of [
    { outcome: { outcome: "selected" as const, optionId: QUESTION_OPTION_IDS.skip } },
    { outcome: { outcome: "selected" as const, optionId: QUESTION_OPTION_IDS.answer } },
    {
      outcome: { outcome: "selected" as const, optionId: QUESTION_OPTION_IDS.answer },
      _meta: { [CHAT_META.answers]: { answers: { "Which one?": "  " } } },
    },
  ]) {
    expect(questionResult(input, response).behavior).toBe("deny");
  }
});

test("a cancel stops the turn", () => {
  expect(questionResult(input, { outcome: { outcome: "cancelled" } })).toMatchObject({ behavior: "deny", interrupt: true });
});
