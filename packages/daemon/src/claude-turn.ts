import * as acp from "@agentclientprotocol/sdk";
import {
  query,
  type CanUseTool,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { log } from "./log.ts";

export interface ClaudeSessionState {
  cwd: string;
  /** Claude's own session id; set after the first turn so later turns resume it. */
  claudeSessionId: string | null;
}

interface TurnInput {
  acpSessionId: string;
  state: ClaudeSessionState;
  prompt: acp.ContentBlock[];
  abort: AbortController;
  /** Delivers one update to whoever watches the session (recorded and broadcast by the caller). */
  emit: (update: acp.SessionUpdate) => Promise<void>;
  askPermission: (
    request: acp.RequestPermissionRequest,
  ) => Promise<acp.RequestPermissionResponse>;
}

// Why: the user's installed CLI carries their login and settings; the SDK's bundled copy would not.
const claudeExecutable =
  process.env.HARNESS_CLAUDE_PATH ?? Bun.which("claude") ?? undefined;

export async function runClaudeTurn(input: TurnInput): Promise<acp.StopReason> {
  const { acpSessionId, state, abort } = input;
  const update = input.emit;

  const stream = query({
    prompt: promptText(input.prompt),
    options: {
      cwd: state.cwd,
      resume: state.claudeSessionId ?? undefined,
      pathToClaudeCodeExecutable: claudeExecutable,
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      abortController: abort,
      canUseTool: permissionBridge(acpSessionId, input.askPermission),
      stderr: (line) => log(`[claude] ${line}`),
    },
  });

  let stopReason: acp.StopReason = "end_turn";
  for await (const message of stream) {
    if (abort.signal.aborted) return "cancelled";
    const result = await forwardMessage(message, state, update);
    if (result) stopReason = result;
  }
  return abort.signal.aborted ? "cancelled" : stopReason;
}

async function forwardMessage(
  message: SDKMessage,
  state: ClaudeSessionState,
  update: (u: acp.SessionUpdate) => Promise<void>,
): Promise<acp.StopReason | null> {
  switch (message.type) {
    case "system":
      if (message.subtype === "init") state.claudeSessionId = message.session_id;
      return null;
    case "stream_event": {
      // Text and thinking stream as deltas; tool calls come whole from the assistant message.
      const event = message.event;
      if (event.type !== "content_block_delta") return null;
      if (event.delta.type === "text_delta") {
        await update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: event.delta.text },
        });
      } else if (event.delta.type === "thinking_delta") {
        await update({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: event.delta.thinking },
        });
      }
      return null;
    }
    case "assistant":
      for (const block of message.message.content) {
        if (block.type !== "tool_use") continue;
        await update({
          sessionUpdate: "tool_call",
          toolCallId: block.id,
          title: toolTitle(block.name, block.input),
          kind: toolKind(block.name),
          status: "in_progress",
          rawInput: block.input,
        });
      }
      return null;
    case "user": {
      const content = message.message.content;
      if (typeof content === "string") return null;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        await update({
          sessionUpdate: "tool_call_update",
          toolCallId: block.tool_use_id,
          status: block.is_error ? "failed" : "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: toolResultText(block.content) },
            },
          ],
        });
      }
      return null;
    }
    case "result":
      if (message.subtype === "success") return "end_turn";
      log(`turn ended with ${message.subtype}`);
      return message.subtype === "error_max_turns" ? "max_turn_requests" : "end_turn";
    default:
      return null;
  }
}

function permissionBridge(
  acpSessionId: string,
  askPermission: TurnInput["askPermission"],
): CanUseTool {
  return async (toolName, input, options) => {
    const response = await askPermission(
      {
        sessionId: acpSessionId,
        toolCall: {
          toolCallId: options.toolUseID,
          title: options.title ?? toolTitle(toolName, input),
          kind: toolKind(toolName),
          status: "pending",
          rawInput: input,
        },
        options: [
          { kind: "allow_once", name: "Allow", optionId: "allow" },
          { kind: "allow_always", name: "Always allow", optionId: "always" },
          { kind: "reject_once", name: "Reject", optionId: "reject" },
        ],
      },
    );
    if (response.outcome.outcome === "cancelled") {
      return { behavior: "deny", message: "Cancelled by user", interrupt: true };
    }
    switch (response.outcome.optionId) {
      case "allow":
        return { behavior: "allow", updatedInput: input };
      case "always":
        return {
          behavior: "allow",
          updatedInput: input,
          updatedPermissions: options.suggestions,
        };
      default:
        return { behavior: "deny", message: "Rejected by user" };
    }
  };
}

function promptText(blocks: acp.ContentBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "resource_link":
          return `@${block.uri}`;
        case "resource":
          return "text" in block.resource
            ? `<context uri="${block.resource.uri}">\n${block.resource.text}\n</context>`
            : `@${block.resource.uri}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

function toolKind(toolName: string): acp.ToolKind {
  switch (toolName) {
    case "Read":
      return "read";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return "edit";
    case "Bash":
    case "PowerShell":
      return "execute";
    case "Grep":
    case "Glob":
      return "search";
    case "WebFetch":
    case "WebSearch":
      return "fetch";
    default:
      return "other";
  }
}

function toolTitle(toolName: string, input: unknown): string {
  if (typeof input !== "object" || input === null) return toolName;
  const fields = Object.fromEntries(Object.entries(input));
  const target = fields.file_path ?? fields.command ?? fields.pattern ?? fields.url;
  return typeof target === "string" ? `${toolName}: ${target}` : toolName;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part?.type === "text" ? String(part.text) : ""))
    .join("\n");
}
