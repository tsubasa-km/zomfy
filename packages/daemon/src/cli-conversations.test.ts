import { describe, expect, test } from "bun:test";
import { CliConversations } from "./cli-conversations.ts";

describe("CliConversations", () => {
  test("a reservation holds the conversation until the terminal opens, and the terminal until it exits", () => {
    const exited = new Set<string>();
    const cli = new CliConversations((id) => exited.has(id));
    expect(cli.reserve("c1")).toBe(true);
    expect(cli.has("c1")).toBe(true);
    expect(cli.reserve("c1")).toBe(false);
    cli.settle("c1", "t1");
    expect(cli.has("c1")).toBe(true);
    exited.add("t1");
    expect(cli.has("c1")).toBe(false);
    expect(cli.reserve("c1")).toBe(true);
  });

  test("a terminal that did not open hands the conversation straight back", () => {
    const cli = new CliConversations(() => false);
    cli.reserve("c1");
    cli.settle("c1", null);
    expect(cli.has("c1")).toBe(false);
  });
});
