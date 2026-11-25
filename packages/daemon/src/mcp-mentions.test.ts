import { expect, test } from "bun:test";
import { claudeToolPrefix, decodeMcpServer, expandMcpMentions, expandMcpMentionsInPrompt } from "./mcp-mentions.ts";

test("a mention is spelled out and the server named once in an instruction", () => {
  const text = expandMcpMentions("check @mcp:notion and again @mcp:notion please", "other");
  expect(text).toBe(
    "check `notion` (MCP server) and again `notion` (MCP server) please\n\nUse the `notion` MCP server's tools for this.",
  );
});

test("names with spaces are percent-encoded in the mention", () => {
  const text = expandMcpMentions("@mcp:claude.ai%20Google%20Calendar what is on today?", "claude");
  expect(text).toStartWith("`claude.ai Google Calendar` (MCP server) what is on today?\n\n");
  expect(text).toContain("`mcp__claude_ai_Google_Calendar__*`");
  expect(text).toContain("ToolSearch");
});

test("one line per distinct server, in the order they appear", () => {
  const text = expandMcpMentions("@mcp:b then @mcp:a", "other");
  expect(text.split("\n").slice(-2)).toEqual([
    "Use the `b` MCP server's tools for this.",
    "Use the `a` MCP server's tools for this.",
  ]);
});

test("text without a mention, an email, or broken encoding stays as it is", () => {
  expect(expandMcpMentions("mail me@mcp:x.com", "claude")).toBe("mail me@mcp:x.com");
  expect(expandMcpMentions("see @mcp:%E0%A4%A", "claude")).toBe("see @mcp:%E0%A4%A");
  expect(expandMcpMentions("plain @src/file.ts", "claude")).toBe("plain @src/file.ts");
  expect(decodeMcpServer("%20")).toBeNull();
});

test("Claude's tool prefix normalizes the name", () => {
  expect(claudeToolPrefix("plugin:deploy-on-aws:awsiac")).toBe("mcp__plugin_deploy-on-aws_awsiac__");
});

test("only text blocks change, and an untouched prompt is the same array", () => {
  const image = { type: "image" as const, data: "x", mimeType: "image/png" };
  const prompt = [image, { type: "text" as const, text: "@mcp:github list PRs" }];
  const out = expandMcpMentionsInPrompt(prompt, "other");
  expect(out[0]).toBe(image);
  expect(out[1]).toEqual({ type: "text", text: "`github` (MCP server) list PRs\n\nUse the `github` MCP server's tools for this." });
  const plain = [{ type: "text" as const, text: "hello" }];
  expect(expandMcpMentionsInPrompt(plain, "claude")).toBe(plain);
});
