import { expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { repliedThisTurn } from "./wrap-up-reply.ts";

const user = (text: string) => ({ sessionUpdate: "user_message_chunk", content: { type: "text", text } }) as acp.SessionUpdate;
const said = (text: string) => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } }) as acp.SessionUpdate;
const thought = (text: string) => ({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text } }) as acp.SessionUpdate;
const tool = { sessionUpdate: "tool_call", toolCallId: "t", title: "Bash" } as acp.SessionUpdate;

test("a turn with reply text before wrap_up has answered", () => {
  expect(repliedThisTurn([user("go"), tool, said("Here is the list."), tool])).toBe(true);
});

test("a turn whose answer is only in thinking has not, whatever earlier turns said", () => {
  expect(repliedThisTurn([user("before"), said("Earlier answer."), user("go"), tool, thought("The answer…"), said("  \n")])).toBe(false);
  expect(repliedThisTurn([])).toBe(false);
});
