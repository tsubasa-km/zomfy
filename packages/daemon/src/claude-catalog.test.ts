import { expect, test } from "bun:test";
import type { ChatCatalog } from "@zomfy/protocol";
import { commandKind, withSlashCommands } from "./claude-catalog.ts";

const skills = new Set(["okf-generate", "deploy-on-aws:deploy", "code-review"]);

test("skills, MCP prompts and commands are told apart", () => {
  expect(commandKind({ name: "okf-generate" }, skills)).toBe("skill");
  expect(commandKind({ name: "deploy-on-aws:deploy" }, skills)).toBe("skill");
  // A bundled skill is Claude Code's own and a skill.
  expect(commandKind({ name: "code-review", builtin: true }, skills)).toBe("skill");
  expect(commandKind({ name: "compact", builtin: true }, skills)).toBe("command");
  expect(commandKind({ name: "mcp__github__review_pr" }, skills)).toBe("mcp-prompt");
  expect(commandKind({ name: "my-project-command" }, skills)).toBe("command");
  expect(commandKind({ name: "anything" }, new Set())).toBe("command");
});

test("an init frame adds new commands and marks the skills it names", () => {
  const catalog: ChatCatalog = {
    models: [],
    commands: [
      { name: "compact", description: "", argumentHint: "", builtin: true, kind: "command" },
      { name: "fresh-skill", description: "d", argumentHint: "", kind: "command" },
    ],
  };
  const next = withSlashCommands(catalog, ["compact", "fresh-skill", "late-skill", "late-command"], ["fresh-skill", "late-skill"]);
  expect(next.commands.map((c) => [c.name, c.kind])).toEqual([
    ["compact", "command"],
    ["fresh-skill", "skill"],
    ["late-skill", "skill"],
    ["late-command", "command"],
  ]);
  expect(withSlashCommands(catalog, ["compact"], [])).toBe(catalog);
});
