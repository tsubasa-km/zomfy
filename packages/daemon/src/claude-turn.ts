import { mkdir } from "node:fs/promises";
import * as acp from "@agentclientprotocol/sdk";
import {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  CHAT_META,
  TURN_RECOVERY_META,
  type ChatPermissionMode,
  type ContextUsageMeta,
  type SessionOptions,
  type TurnEndMeta,
} from "@acp-harness/protocol";
import { resolveClaudeExecutable } from "./claude-executable.ts";
import { CHAT_ATTACHMENT_DIR, deferAttachmentMentions } from "./chat-attachment-files.ts";
import { detectUsageLimit } from "./usage-limit.ts";
import { log } from "./log.ts";

export interface ClaudeSessionState {
  cwd: string;
  /** Claude's own session id; set after the first turn so later turns resume it. */
  claudeSessionId: string | null;
  options: SessionOptions;
}

interface TurnInput {
  acpSessionId: string;
  state: ClaudeSessionState;
  prompt: acp.ContentBlock[];
  /** Becomes the Claude transcript entry's uuid, so rewind can find this prompt. */
  messageId: ReturnType<typeof crypto.randomUUID>;
  abort: AbortController;
  /** Delivers one update to whoever watches the session (recorded and broadcast by the caller). */
  emit: (update: acp.SessionUpdate) => Promise<void>;
  askPermission: (
    request: acp.RequestPermissionRequest,
  ) => Promise<acp.RequestPermissionResponse>;
  /** The running query while the turn lasts (null after), for option changes mid-turn. */
  onQuery?: (query: Query | null) => void;
  /** Claude changed its own permission mode (plan approved, a mode tool). */
  onPermissionMode?: (mode: ChatPermissionMode) => void;
  /** The `/` menu Claude reported at the start of the turn. */
  onSlashCommands?: (names: string[]) => void;
  /** This host's Claude variables from the Agents settings (an account's CLAUDE_CONFIG_DIR…). */
  env?: Record<string, string>;
  /** MCP servers the daemon provides (the manager tools). */
  mcpServers?: Options["mcpServers"];
  /** Tools that run without asking (the read-only manager tools). */
  allowedTools?: string[];
  /** Added to Claude Code's own system prompt (the Manager chat's instructions). */
  appendSystemPrompt?: string;
  /** How a turn that did not finish cleanly ended (a usage limit, an error), for recovery. */
  onTurnEnd?: (end: TurnEndMeta) => void;
  /** Claude's predicted next prompt; arrives after the turn has already returned. */
  onPromptSuggestion?: (suggestion: string) => void;
  /** A workflow step's tool policy and the shape its result must take. */
  step?: StepOptions;
  /** The turn's final text and, with step.outputFormat, its structured result. */
  onResult?: (result: { text: string; structured: unknown }) => void;
}

export interface StepOptions {
  mcpServers?: Options["mcpServers"];
  strictMcpConfig?: boolean;
  skills?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  outputFormat?: Options["outputFormat"];
}

// The CLI sends its prompt suggestion after the result; past this the process is let go without one.
const SUGGESTION_WAIT_MS = 15_000;

/** Per chat, the previous turn's process still waiting on a suggestion: lets it go, and when it has. */
const lingering = new Map<string, { release: () => void; exited: Promise<void> }>();

/** Ends a finished turn's process early and waits for it, before anything moves its files. */
export async function releaseFinishedTurn(acpSessionId: string): Promise<void> {
  const turn = lingering.get(acpSessionId);
  turn?.release();
  await turn?.exited;
}

const CHAT_PERMISSION_MODES: readonly ChatPermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
];

/** Everything a turn learns that outlives one SDK message. */
interface TurnProgress {
  lastMainUsage: number | null;
  agentTextSent: boolean;
  compactions: number;
  /** Usage-limit signals; read only if the turn fails. */
  assistantError: string | null;
  rejected: { resetsAt?: number } | null;
}

export async function runClaudeTurn(input: TurnInput): Promise<acp.StopReason> {
  const { acpSessionId, state, abort } = input;
  const update = input.emit;
  const { model, permissionMode, effort } = state.options;

  // Streaming input keeps the process alive past the result, so context usage can still be read.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  abort.signal.addEventListener("abort", () => release());
  lingering.get(acpSessionId)?.release();
  const userMessage: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: promptContent(input.prompt) },
    parent_tool_use_id: null,
    uuid: input.messageId,
  };
  async function* promptStream(): AsyncGenerator<SDKUserMessage> {
    yield userMessage;
    await released;
  }

  await mkdir(CHAT_ATTACHMENT_DIR, { recursive: true }).catch(() => undefined);
  const mcpServers = { ...input.mcpServers, ...input.step?.mcpServers };
  const allowedTools = [...(input.allowedTools ?? []), ...(input.step?.allowedTools ?? [])];
  const stream = query({
    prompt: promptStream(),
    options: {
      cwd: state.cwd,
      // Snapshots messages point at (terminal screens, other chats); reading them needs no approval.
      additionalDirectories: [CHAT_ATTACHMENT_DIR],
      resume: state.claudeSessionId ?? undefined,
      pathToClaudeCodeExecutable: await resolveClaudeExecutable(),
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      abortController: abort,
      canUseTool: permissionBridge(acpSessionId, input.askPermission, input.onPermissionMode),
      stderr: (line) => log(`[claude] ${line}`),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      permissionMode,
      promptSuggestions: true,
      // Headless runs on current models drop the task tools the TUI keeps; the chat draws their list.
      env: { ...process.env, ...input.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" },
      ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
      ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      ...(allowedTools.length ? { allowedTools } : {}),
      ...(input.step?.disallowedTools?.length ? { disallowedTools: input.step.disallowedTools } : {}),
      ...(input.step?.skills ? { skills: input.step.skills } : {}),
      ...(input.step?.strictMcpConfig ? { strictMcpConfig: true } : {}),
      ...(input.step?.outputFormat ? { outputFormat: input.step.outputFormat } : {}),
      ...(input.appendSystemPrompt
        ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: input.appendSystemPrompt } }
        : {}),
    },
  });
  input.onQuery?.(stream);

  const progress: TurnProgress = {
    lastMainUsage: null,
    agentTextSent: false,
    compactions: 0,
    assistantError: null,
    rejected: null,
  };
  // The turn returns at its result; the stream is drained past it only for the prompt suggestion.
  let settle: ((reason: acp.StopReason) => void) | null = null;
  let fail!: (error: unknown) => void;
  const done = new Promise<acp.StopReason>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const finish = (reason: acp.StopReason): void => {
    if (!settle) return;
    input.onQuery?.(null);
    settle(reason);
    settle = null;
  };
  let exited!: () => void;
  const lingeringTurn = { release, exited: new Promise<void>((resolve) => (exited = resolve)) };
  void (async () => {
    let stopReason: acp.StopReason = "end_turn";
    try {
      for await (const message of stream) {
        if (abort.signal.aborted) break;
        if (message.type === "result") {
          stopReason = await finishTurn(message, stream, progress, update, input.onTurnEnd);
          if (message.subtype === "success") {
            input.onResult?.({ text: message.result, structured: message.structured_output });
          }
          lingering.set(acpSessionId, lingeringTurn);
          finish(stopReason);
          setTimeout(release, SUGGESTION_WAIT_MS);
        } else if (message.type === "prompt_suggestion") {
          if (message.suggestion.trim()) input.onPromptSuggestion?.(message.suggestion.trim());
          release();
        } else if (settle) {
          await forwardMessage(message, input, progress);
        }
      }
    } catch (error) {
      if (settle) {
        input.onQuery?.(null);
        settle = null;
        fail(error);
      } else log(`after the turn: ${String(error)}`);
    } finally {
      finish(abort.signal.aborted ? "cancelled" : stopReason);
      release();
      if (lingering.get(acpSessionId) === lingeringTurn) lingering.delete(acpSessionId);
      exited();
    }
  })();
  return done;
}

async function forwardMessage(
  message: SDKMessage,
  input: TurnInput,
  progress: TurnProgress,
): Promise<void> {
  const { state } = input;
  const update = input.emit;
  switch (message.type) {
    case "system":
      if (message.subtype === "init") {
        state.claudeSessionId = message.session_id;
        input.onSlashCommands?.(message.slash_commands);
        noteMode(message.permissionMode, input);
      } else if (message.subtype === "status") {
        if (message.permissionMode) noteMode(message.permissionMode, input);
        if (message.status === "compacting") {
          await update({
            sessionUpdate: "compaction_update",
            compactionId: `${input.messageId}:${progress.compactions}`,
            status: "in_progress",
          });
        }
      } else if (message.subtype === "compact_boundary") {
        await update({
          sessionUpdate: "compaction_update",
          compactionId: `${input.messageId}:${progress.compactions++}`,
          status: "completed",
          _meta: { trigger: message.compact_metadata.trigger, preTokens: message.compact_metadata.pre_tokens },
        });
      }
      return;
    case "stream_event": {
      // A subagent's own prose stays inside its Task row; only its tool calls are shown.
      if (message.parent_tool_use_id) return;
      const event = message.event;
      if (event.type !== "content_block_delta") return;
      if (event.delta.type === "text_delta") {
        progress.agentTextSent = true;
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
      return;
    }
    case "rate_limit_event":
      if (message.rate_limit_info.status === "rejected") progress.rejected = message.rate_limit_info;
      return;
    case "assistant": {
      if (message.error) progress.assistantError = message.error;
      if (!message.parent_tool_use_id) {
        const usage = message.message.usage;
        progress.lastMainUsage =
          usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          usage.output_tokens;
      }
      for (const block of message.message.content) {
        if (block.type !== "tool_use") continue;
        await update({
          sessionUpdate: "tool_call",
          toolCallId: block.id,
          title: toolTitle(block.name, block.input),
          kind: toolKind(block.name),
          status: "in_progress",
          rawInput: block.input,
          _meta: {
            [CHAT_META.toolName]: block.name,
            ...(message.parent_tool_use_id
              ? { [CHAT_META.parentToolCallId]: message.parent_tool_use_id }
              : {}),
          },
        });
      }
      return;
    }
    case "user": {
      const content = message.message.content;
      if (typeof content === "string") return;
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
      return;
    }
    default:
      return;
  }
}

function noteMode(mode: PermissionMode, input: TurnInput): void {
  const known = CHAT_PERMISSION_MODES.find((m) => m === mode);
  if (known && known !== input.state.options.permissionMode) input.onPermissionMode?.(known);
}

/** Reports the turn's outcome, its context usage, and the text of a turn that ran a local command. */
async function finishTurn(
  message: Extract<SDKMessage, { type: "result" }>,
  stream: Query,
  progress: TurnProgress,
  update: (u: acp.SessionUpdate) => Promise<void>,
  onTurnEnd: TurnInput["onTurnEnd"],
): Promise<acp.StopReason> {
  const failed = async (title: string, errorText: string): Promise<void> => {
    const limit = detectUsageLimit({ text: errorText, assistantError: progress.assistantError, rejected: progress.rejected });
    const end: TurnEndMeta = limit ? { reason: "usage-limit", resetsAt: limit.resetsAt } : { reason: "error" };
    onTurnEnd?.(end);
    await update({ sessionUpdate: "notice", severity: "error", title, _meta: { [TURN_RECOVERY_META.turnEnd]: end } });
  };
  if (message.subtype === "success") {
    // Local commands (/context, /cost…) answer only in the result.
    if (!progress.agentTextSent && message.result.trim() && !message.is_error) {
      await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: message.result } });
    }
    if (message.is_error) await failed(message.result || "The turn failed", message.result);
  } else {
    log(`turn ended with ${message.subtype}`);
    await failed(resultErrorTitle(message.subtype), message.errors.join("\n"));
  }
  await reportContextUsage(message, stream, progress, update).catch((error) =>
    log(`context usage failed: ${String(error)}`),
  );
  return message.subtype === "error_max_turns" ? "max_turn_requests" : "end_turn";
}

function resultErrorTitle(subtype: string): string {
  switch (subtype) {
    case "error_max_turns":
      return "Stopped: the turn hit its step limit";
    case "error_max_budget_usd":
      return "Stopped: the turn hit its budget";
    default:
      return "The turn ended with an error";
  }
}

async function reportContextUsage(
  message: Extract<SDKMessage, { type: "result" }>,
  stream: Query,
  progress: TurnProgress,
  update: (u: acp.SessionUpdate) => Promise<void>,
): Promise<void> {
  const cost = { amount: message.total_cost_usd, currency: "USD" };
  const exact = await Promise.race([
    stream.getContextUsage({ detail: "summary" }).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
  if (exact && exact.maxTokens > 0) {
    const meta: ContextUsageMeta = {
      estimated: false,
      categories: exact.categories
        .filter((c) => c.kind === "used" && c.tokens > 0)
        .map((c) => ({ name: c.name, tokens: c.tokens })),
    };
    await update({
      sessionUpdate: "usage_update",
      used: exact.totalTokens,
      size: exact.maxTokens,
      cost,
      _meta: { [CHAT_META.contextUsage]: meta },
    });
    return;
  }
  const window = Math.max(0, ...Object.values(message.modelUsage).map((m) => m.contextWindow));
  if (progress.lastMainUsage === null || window === 0) return;
  const meta: ContextUsageMeta = { estimated: true, categories: [] };
  await update({
    sessionUpdate: "usage_update",
    used: progress.lastMainUsage,
    size: window,
    cost,
    _meta: { [CHAT_META.contextUsage]: meta },
  });
}

function permissionBridge(
  acpSessionId: string,
  askPermission: TurnInput["askPermission"],
  onPermissionMode: TurnInput["onPermissionMode"],
): CanUseTool {
  return async (toolName, input, options) => {
    const planExit = toolName === "ExitPlanMode";
    const response = await askPermission({
      sessionId: acpSessionId,
      toolCall: {
        toolCallId: options.toolUseID,
        title: planExit ? "Plan ready: start building?" : (options.title ?? toolTitle(toolName, input)),
        kind: planExit ? "switch_mode" : toolKind(toolName),
        status: "pending",
        rawInput: input,
        _meta: { [CHAT_META.toolName]: toolName },
      },
      // Claude Code's own plan-approval choices.
      options: planExit
        ? [
            { kind: "allow_always", name: "Yes, auto-accept edits", optionId: "plan:acceptEdits" },
            { kind: "allow_once", name: "Yes, approve each edit", optionId: "plan:default" },
            { kind: "reject_once", name: "No, keep planning", optionId: "reject" },
          ]
        : [
            { kind: "allow_once", name: "Allow", optionId: "allow" },
            { kind: "allow_always", name: "Always allow", optionId: "always" },
            { kind: "reject_once", name: "Reject", optionId: "reject" },
          ],
    });
    if (response.outcome.outcome === "cancelled") {
      return { behavior: "deny", message: "Cancelled by user", interrupt: true };
    }
    const choice = response.outcome.optionId;
    if (choice === "plan:acceptEdits" || choice === "plan:default") {
      const mode = choice === "plan:acceptEdits" ? "acceptEdits" : "default";
      onPermissionMode?.(mode);
      return {
        behavior: "allow",
        updatedInput: input,
        updatedPermissions: [{ type: "setMode", mode, destination: "session" }],
      };
    }
    switch (choice) {
      case "allow":
        return { behavior: "allow", updatedInput: input };
      case "always":
        return { behavior: "allow", updatedInput: input, updatedPermissions: options.suggestions };
      default:
        return { behavior: "deny", message: "Rejected by user" };
    }
  };
}

type PromptContent = Exclude<SDKUserMessage["message"]["content"], string>;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/** ACP prompt blocks as Messages API content: text and context inline, images as base64 sources. */
function promptContent(blocks: acp.ContentBlock[]): PromptContent {
  const content: PromptContent = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (block.text) content.push({ type: "text", text: deferAttachmentMentions(block.text) });
        break;
      case "image": {
        const mediaType = IMAGE_TYPES.find((t) => t === block.mimeType);
        if (mediaType) content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: block.data } });
        break;
      }
      case "resource_link":
        content.push({ type: "text", text: `@${block.uri}` });
        break;
      case "resource":
        content.push({
          type: "text",
          text:
            "text" in block.resource
              ? `<context uri="${block.resource.uri}">\n${block.resource.text}\n</context>`
              : `@${block.resource.uri}`,
        });
        break;
    }
  }
  return content;
}

export function toolKind(toolName: string): acp.ToolKind {
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
    case "Task":
    case "Agent":
    case "TodoWrite":
      return "think";
    default:
      return "other";
  }
}

export function toolTitle(toolName: string, input: unknown): string {
  // The harness's own manager tools read as "Harness: list sessions", not their MCP id.
  const manager = /^mcp__harness__(.+)$/.exec(toolName);
  if (manager) return `Harness: ${manager[1]!.replaceAll("_", " ")}`;
  if (typeof input !== "object" || input === null) return toolName;
  const fields = Object.fromEntries(Object.entries(input));
  const target =
    fields.file_path ?? fields.command ?? fields.pattern ?? fields.url ?? fields.description ?? fields.query;
  return typeof target === "string" ? `${toolName}: ${target}` : toolName;
}

export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part?.type === "text" ? String(part.text) : ""))
    .join("\n");
}
