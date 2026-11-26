import type * as acp from "@agentclientprotocol/sdk";

// `@mcp:<server>` in a prompt is the composer's connector chip (composer-skills-and-connectors.md).
// The transcript keeps it as typed, so the person's bubble shows the chip; the agent is handed plain
// words instead, and a line asking it to use the server.

/** The name's whitespace and `%` are percent-encoded, so a name with spaces is one word. */
const MCP_MENTION = /(?<=^|\s)@mcp:([^\s@`]+)/g;

/** The server a mention's text names, or null when it is not valid percent-encoding. */
export function decodeMcpServer(encoded: string): string | null {
  try {
    const name = decodeURIComponent(encoded);
    return name.trim() ? name : null;
  } catch {
    return null;
  }
}

/** Claude Code's form of a server name in its tools' names (`mcp__<this>__<tool>`). */
export function claudeToolPrefix(server: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, "_")}__`;
}

/** The text with each `@mcp:` mention spelled out and one instruction per server after it. */
export function expandMcpMentions(text: string, agent: "claude" | "other"): string {
  const servers: string[] = [];
  const spelled = text.replace(MCP_MENTION, (whole, encoded: string) => {
    const server = decodeMcpServer(encoded);
    if (!server) return whole;
    if (!servers.includes(server)) servers.push(server);
    return `\`${server}\` (MCP server)`;
  });
  if (servers.length === 0) return text;
  const lines = servers.map((server) =>
    agent === "claude"
      ? `Use the \`${server}\` MCP server's tools for this (named \`${claudeToolPrefix(server)}*\`; load them with ToolSearch if they are deferred).`
      : `Use the \`${server}\` MCP server's tools for this.`,
  );
  return `${spelled}\n\n${lines.join("\n")}`;
}

/** A prompt's text blocks with their mentions expanded; other blocks as they were. */
export function expandMcpMentionsInPrompt(prompt: acp.ContentBlock[], agent: "claude" | "other"): acp.ContentBlock[] {
  let changed = false;
  const out = prompt.map((block) => {
    if (block.type !== "text") return block;
    const text = expandMcpMentions(block.text, agent);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? out : prompt;
}
