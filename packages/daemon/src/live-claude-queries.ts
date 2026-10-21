import type { Query } from "@anthropic-ai/claude-agent-sdk";

/** The Claude query behind each running turn, by harness session id, for mid-turn option changes. */
export const liveClaudeQueries = new Map<string, Query>();
