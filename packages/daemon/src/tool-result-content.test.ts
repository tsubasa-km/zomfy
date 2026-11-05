import { describe, expect, test } from "bun:test";
import { toolResultContent } from "./claude-turn.ts";

describe("tool result content", () => {
  test("keeps a tool's images after its text", () => {
    const parts = toolResultContent([
      { type: "text", text: "Took a screenshot" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
    ]);
    expect(parts).toEqual([
      { type: "content", content: { type: "text", text: "Took a screenshot" } },
      { type: "content", content: { type: "image", data: "AAAA", mimeType: "image/jpeg" } },
    ]);
  });

  test("plain text results stay one text part", () => {
    expect(toolResultContent("done")).toEqual([{ type: "content", content: { type: "text", text: "done" } }]);
  });
});
