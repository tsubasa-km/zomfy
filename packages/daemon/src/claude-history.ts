import type * as acp from "@agentclientprotocol/sdk";
import {
  forkSession,
  getSessionMessages,
  listSessions,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { CHAT_META } from "@acp-harness/protocol";
import { toolKind, toolResultText, toolTitle } from "./claude-turn.ts";

export interface ClaudeConversation {
  claudeSessionId: string;
  title: string;
  lastModified: number;
  gitBranch: string | null;
}

/** Claude's conversations recorded for this folder, newest first. */
export async function listConversations(cwd: string): Promise<ClaudeConversation[]> {
  const sessions = await listSessions({ dir: cwd, includeWorktrees: false, limit: 100 });
  return sessions
    .map((s) => ({
      claudeSessionId: s.sessionId,
      title: (s.customTitle ?? s.summary ?? s.firstPrompt ?? "").replace(/\s+/g, " ").trim() || "Untitled",
      lastModified: s.lastModified,
      gitBranch: s.gitBranch ?? null,
    }))
    .sort((a, b) => b.lastModified - a.lastModified);
}

export async function forkConversation(
  claudeSessionId: string,
  cwd: string,
  upToMessageId?: string,
): Promise<string> {
  const { sessionId } = await forkSession(claudeSessionId, {
    dir: cwd,
    ...(upToMessageId ? { upToMessageId } : {}),
  });
  return sessionId;
}

/**
 * The conversation before one prompt: a fork that stops just ahead of it, or null when the prompt
 * opened the conversation. `ordinal` finds prompts sent before their uuid was recorded.
 */
export async function conversationBefore(
  claudeSessionId: string,
  cwd: string,
  messageId: string,
  ordinal: number,
): Promise<string | null> {
  const messages = await getSessionMessages(claudeSessionId, { dir: cwd });
  let index = messages.findIndex((m) => m.uuid === messageId);
  if (index === -1) index = promptIndexes(messages)[ordinal] ?? -1;
  if (index === -1) throw new Error("This message is no longer in Claude's transcript");
  const previous = messages[index - 1];
  return previous ? forkConversation(claudeSessionId, cwd, previous.uuid) : null;
}

/** A conversation on disk as the ACP updates a live turn would have sent. */
export async function conversationUpdates(claudeSessionId: string, cwd: string): Promise<acp.SessionUpdate[]> {
  const messages = await getSessionMessages(claudeSessionId, { dir: cwd });
  const updates: acp.SessionUpdate[] = [];
  for (const message of messages) {
    const content = messageContent(message);
    if (message.type === "user") {
      if (typeof content === "string") {
        if (isPromptText(content)) {
          updates.push({ sessionUpdate: "user_message_chunk", messageId: message.uuid, content: { type: "text", text: content } });
        }
        continue;
      }
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string" && isPromptText(block.text)) {
          updates.push({ sessionUpdate: "user_message_chunk", messageId: message.uuid, content: { type: "text", text: block.text } });
        } else if (block.type === "image" && isRecord(block.source) && typeof block.source.data === "string") {
          const mimeType = typeof block.source.media_type === "string" ? block.source.media_type : "image/png";
          updates.push({ sessionUpdate: "user_message_chunk", messageId: message.uuid, content: { type: "image", data: block.source.data, mimeType } });
        } else if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          updates.push({
            sessionUpdate: "tool_call_update",
            toolCallId: block.tool_use_id,
            status: block.is_error === true ? "failed" : "completed",
            content: [{ type: "content", content: { type: "text", text: toolResultText(block.content) } }],
          });
        }
      }
    } else if (message.type === "assistant" && typeof content !== "string") {
      for (const block of content) {
        if (message.parent_tool_use_id && block.type !== "tool_use") continue;
        if (block.type === "text" && typeof block.text === "string") {
          updates.push({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: block.text } });
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          updates.push({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: block.thinking } });
        } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
          updates.push({
            sessionUpdate: "tool_call",
            toolCallId: block.id,
            title: toolTitle(block.name, block.input),
            kind: toolKind(block.name),
            status: "in_progress",
            rawInput: block.input,
            _meta: {
              [CHAT_META.toolName]: block.name,
              ...(message.parent_tool_use_id ? { [CHAT_META.parentToolCallId]: message.parent_tool_use_id } : {}),
            },
          });
        }
      }
    }
  }
  return updates;
}

type ContentPart = Record<string, unknown> & { type?: unknown };

function messageContent(message: SessionMessage): string | ContentPart[] {
  const body = isRecord(message.message) ? message.message.content : undefined;
  if (typeof body === "string") return body;
  return Array.isArray(body) ? body.filter(isRecord) : [];
}

/** Indexes of the person's own prompts, in order. */
function promptIndexes(messages: SessionMessage[]): number[] {
  const indexes: number[] = [];
  messages.forEach((message, index) => {
    if (message.type !== "user" || message.parent_tool_use_id) return;
    const content = messageContent(message);
    const isPrompt =
      typeof content === "string"
        ? isPromptText(content)
        : content.some((b) => (b.type === "text" && typeof b.text === "string" && isPromptText(b.text)) || b.type === "image");
    if (isPrompt) indexes.push(index);
  });
  return indexes;
}

// Command echoes and caveats the CLI records as user turns are not the person's words.
function isPromptText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.length > 0 && !/^<(command-|local-command|system-reminder)/.test(trimmed) && !trimmed.startsWith("Caveat:");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
