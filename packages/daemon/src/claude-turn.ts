import { mkdir } from "node:fs/promises";
import * as acp from "@agentclientprotocol/sdk";
import {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type Query,
  type SDKControlGetContextUsageResponse,
  type SDKMessage,
  type SDKTaskNotificationMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  CHAT_META,
  TURN_RECOVERY_META,
  type ChatEffort,
  type ChatPermissionMode,
  type ContextUsageMeta,
  type SessionOptions,
  type SessionWakeUp,
  type TurnEndMeta,
  type WorkflowStepContext,
  type WorkflowStepUsage,
} from "@zomfy/protocol";
import { CLAUDE_CHROME_ARGS, explainClaudeFailure, isClaudeSignedOut, resolveClaudeExecutable, signedOutNotice } from "./claude-executable.ts";
import { CHAT_ATTACHMENT_DIR, deferAttachmentMentions } from "./chat-attachment-files.ts";
import { detectUsageLimit } from "./usage-limit.ts";
import { noteClaudeTurnEnded } from "./usage-limits.ts";
import { log } from "./log.ts";
import { PROCESS_GONE_META } from "./stopped-tool-calls.ts";
import { QUESTION_OPTIONS, QUESTION_TOOL, questionResult } from "./ask-user-question.ts";
import { pathGuardHooks, type PathGuard } from "./step-path-guard.ts";
import { nextCronTime } from "./cron-next.ts";

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
  onSlashCommands?: (names: string[], skills?: string[]) => void;
  /** The CLI's transcript path also covers non-default Claude profiles. */
  onTranscript?: (path: string) => void;
  /** This host's Claude variables from the Agents settings (an account's CLAUDE_CONFIG_DIR…). */
  env?: Record<string, string>;
  /** MCP servers the daemon provides (the manager tools). */
  mcpServers?: Options["mcpServers"];
  /** Start Claude Code with Claude in Chrome (`--chrome`), from the Agents or project settings. */
  chrome?: boolean;
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
  /** The project's other worktrees this chat may only read (worktree-claims.ts), read on every tool call. */
  worktreeGuards?: () => PathGuard[];
  /** The turn's final text and, with step.outputFormat, its structured result. */
  onResult?: (result: { text: string; structured: unknown; usage: WorkflowStepUsage; context?: WorkflowStepContext }) => void;
  /**
   * Take the turn the chat's process started on its own (a background task finished): the prompt
   * is not sent, it only says what woke the chat.
   */
  attach?: boolean;
  /**
   * The process started a turn between the chat's turns; `notification` is what the CLI got (may be
   * empty), `wakeUp` the scheduled wake-up that was due when it started with none.
   */
  onWake?: (notification: string, wakeUp?: SessionWakeUp) => void;
  /** The chat's scheduled wake-ups changed, as the Stop hook reports them (scheduled-wake-ups.md). */
  onWakeUps?: (wakeUps: SessionWakeUp[]) => void;
  /** The process ended with wake-ups it would still have fired: the daemon keeps them from here. */
  onWakeUpsOrphaned?: (wakeUps: SessionWakeUp[]) => void;
  /** The chat's live background tasks changed (their descriptions; empty when none run any more). */
  onBackgroundTasks?: (tasks: string[]) => void;
  /** A turn run with no effort picked ended at this level: Claude's default for `model` (null: the default model). */
  onDefaultEffort?: (found: { model: string | null; effort: ChatEffort }) => void;
}

const EFFORT_LEVELS: readonly ChatEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** What a Stop hook's input says is scheduled to wake the chat, soonest first; null when it does not say. */
export function wakeUpsOf(hookInput: unknown, now = Date.now()): SessionWakeUp[] | null {
  const crons = (hookInput as { session_crons?: unknown } | null)?.session_crons;
  if (!Array.isArray(crons)) return null;
  return crons
    .flatMap((c: { id?: unknown; schedule?: unknown; recurring?: unknown; prompt?: unknown }) =>
      typeof c?.id === "string" && typeof c.schedule === "string"
        ? [{ id: c.id, at: nextCronTime(c.schedule, now), recurring: c.recurring === true, prompt: typeof c.prompt === "string" ? c.prompt : "" }]
        : [],
    )
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
}

/** The effort a hook's input says the turn ran at, when it is one Zomfy knows. */
export function turnEffort(hookInput: unknown): ChatEffort | null {
  const level = (hookInput as { effort?: { level?: unknown } } | null)?.effort?.level;
  return EFFORT_LEVELS.find((e) => e === level) ?? null;
}

export interface StepOptions {
  mcpServers?: Options["mcpServers"];
  strictMcpConfig?: boolean;
  skills?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  outputFormat?: Options["outputFormat"];
  /** Folders outside the session's own it may read without asking (the run's worktree, for a step run in the starting chat). */
  additionalDirectories?: string[];
  /** Data the step may not use, or may only read; refused before each tool call. */
  guards?: PathGuard[];
}

// The CLI sends its prompt suggestion after the result; past this the process is let go without one.
const SUGGESTION_WAIT_MS = 15_000;
/** How long a process idle with background tasks is kept after its last turn. */
export const BACKGROUND_IDLE_MS = 60 * 60_000;
/** How long past a scheduled wake-up's time its process is kept, for the CLI to fire it. */
const WAKE_UP_GRACE_MS = 2 * 60_000;
/** A process is kept for a wake-up at most this far ahead; one further away is left to the daemon. */
export const WAKE_UP_KEEP_MS = 24 * 60 * 60_000;
/** How long a turn the CLI started on its own waits for the chat to take it. */
const WAKE_ATTACH_MS = 60_000;
/** How long a new turn waits for a stopped process to exit, so two never write one conversation. */
const STOPPED_EXIT_WAIT_MS = 5_000;
/** How long a turn joining a kept process waits for it to take a control request. */
const CONTROL_WAIT_MS = 5_000;

/** Resolves when `signal` aborts (at once if it already has), or after `ms`. */
function abortedOrAfter(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

let startQuery: typeof query = query;
/** Tests run turns against a fake SDK stream. */
export function useQueryForTests(fake: typeof query | null): void {
  startQuery = fake ?? query;
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
  /** What the context held at the turn's end, for a workflow step's ledger. */
  context?: WorkflowStepContext;
  /** Whether Claude has said or done anything in this turn yet. */
  output: boolean;
}

/** The turn a process's messages go to. */
interface ActiveTurn {
  input: TurnInput;
  /** The uuid of the prompt this turn sent; null for a turn the CLI started itself. */
  promptId: string | null;
  progress: TurnProgress;
  settle: (reason: acp.StopReason) => void;
  fail: (error: unknown) => void;
  unlink: () => void;
}

/**
 * One chat's Claude process. It normally ends with its turn; while background tasks run it stays,
 * and the CLI starts a turn of its own when one finishes (a "wake"), as in Claude Code.
 */
interface ClaudeProcess {
  query: Query;
  /** What it was started with; a turn that would start it differently gets a new one. */
  key: string;
  /** Claude's session id the process reported. */
  claudeSessionId: string | null;
  push: (message: SDKUserMessage) => void;
  closeInput: () => void;
  kill: () => void;
  closed: boolean;
  exited: Promise<void>;
  turn: ActiveTurn | null;
  /** The latest turn's input: whom to tell about what happens between turns. */
  last: TurnInput;
  /** Live background tasks that are activity (not ambient), id → description. */
  tasks: Map<string, string>;
  /** The wake-ups the CLI holds for the chat, as its last Stop hook said. */
  wakeUps: SessionWakeUp[];
  /** Ended on purpose (the chat archived, deleted or moved): its wake-ups go with it. */
  dropWakeUps: boolean;
  /** A turn the CLI started that the chat has not taken yet: its messages, held in order. */
  waking: { messages: SDKMessage[]; timer: ReturnType<typeof setTimeout> } | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Serialises message handling, so held messages are delivered before newer ones. */
  chain: Promise<void>;
}

const processes = new Map<string, ClaudeProcess>();

const STOPPED_TASKS = "The background tasks this chat was running were stopped";

/** Ends a chat's process (and any background tasks it runs) and waits for it, before anything moves its files. */
export async function releaseFinishedTurn(acpSessionId: string): Promise<void> {
  const proc = processes.get(acpSessionId);
  if (!proc) return;
  proc.dropWakeUps = true;
  await letGo(proc, STOPPED_TASKS);
  await proc.exited;
}

/** The background tasks a chat's process is kept up for. */
export function backgroundTasksOf(acpSessionId: string): string[] {
  return [...(processes.get(acpSessionId)?.tasks.values() ?? [])];
}

async function letGo(proc: ClaudeProcess, why: string): Promise<void> {
  if (proc.closed) return;
  const tasks = [...proc.tasks.values()];
  clearTimers(proc);
  proc.closeInput();
  // With its input closed the CLI would hold on for its tasks: they end now.
  if (tasks.length > 0) {
    proc.kill();
    proc.last.onBackgroundTasks?.([]);
    await proc.last.emit({ sessionUpdate: "notice", severity: "info", title: `${why}: ${tasks.join(", ")}`, _meta: { [PROCESS_GONE_META]: true } }).catch(() => undefined);
  }
}

function clearTimers(proc: ClaudeProcess): void {
  if (proc.idleTimer) clearTimeout(proc.idleTimer);
  proc.idleTimer = null;
  if (proc.waking) clearTimeout(proc.waking.timer);
}

/** Between turns: goes after `ms`, unless a turn starts first. */
function armRelease(proc: ClaudeProcess, ms: number, why: string): void {
  if (proc.idleTimer) clearTimeout(proc.idleTimer);
  proc.idleTimer = setTimeout(() => {
    proc.idleTimer = null;
    if (!proc.turn && !proc.waking) void letGo(proc, why);
  }, ms);
}

/** How long to keep the process for its next wake-up; null when it has none the CLI should fire. */
function wakeUpKeepMs(proc: ClaudeProcess, now = Date.now()): number | null {
  const next = proc.wakeUps.find((w) => w.at !== null)?.at;
  if (next == null) return null;
  const ms = next - now + WAKE_UP_GRACE_MS;
  return ms > 0 && ms <= wakeUpKeepCapMs ? ms : null;
}

function armIdle(proc: ClaudeProcess): void {
  const wakeUp = wakeUpKeepMs(proc);
  if (proc.tasks.size > 0) armRelease(proc, Math.max(idleCapMs, wakeUp ?? 0), "Stopped waiting for background tasks after an hour");
  else if (wakeUp !== null) armRelease(proc, wakeUp, STOPPED_TASKS);
  else armRelease(proc, SUGGESTION_WAIT_MS, STOPPED_TASKS);
}

let wakeUpKeepCapMs = WAKE_UP_KEEP_MS;
/** Tests shorten how far ahead a wake-up keeps its process. */
export function setWakeUpKeepCapForTests(ms: number | null): void {
  wakeUpKeepCapMs = ms ?? WAKE_UP_KEEP_MS;
}

let idleCapMs = BACKGROUND_IDLE_MS;
/** Tests shorten the idle cap. */
export function setBackgroundIdleCapForTests(ms: number | null): void {
  idleCapMs = ms ?? BACKGROUND_IDLE_MS;
}

/** The spawn-time options that a process cannot change once started. */
function spawnKey(input: TurnInput): string {
  const { state } = input;
  return JSON.stringify({
    cwd: state.cwd,
    model: state.options.model ?? null,
    effort: state.options.effort ?? null,
    env: input.env ?? null,
    mcp: Object.keys(input.mcpServers ?? {}).sort(),
    allowed: input.allowedTools ?? [],
    append: input.appendSystemPrompt ?? null,
    guards: !!input.worktreeGuards,
    chrome: !!input.chrome,
  });
}

/** Claude Code's own record of a finished task, which the chat draws as a status line. */
export function taskNotificationText(message: SDKTaskNotificationMessage): string {
  return [
    "<task-notification>",
    `<task-id>${message.task_id}</task-id>`,
    ...(message.tool_use_id ? [`<tool-use-id>${message.tool_use_id}</tool-use-id>`] : []),
    `<output-file>${message.output_file}</output-file>`,
    `<status>${message.status}</status>`,
    `<summary>${message.summary}</summary>`,
    "</task-notification>",
  ].join("\n");
}

function shownNotification(message: SDKMessage): message is SDKTaskNotificationMessage {
  return message.type === "system" && message.subtype === "task_notification" && !message.skip_transcript && !message.ambient;
}

/** A message that belongs to a turn: arriving between turns, it means the CLI started one. */
function startsTurn(message: SDKMessage): boolean {
  if (shownNotification(message)) return true;
  if (message.type === "system") return message.subtype === "init";
  return message.type === "assistant" || message.type === "stream_event" || message.type === "user" || message.type === "result";
}

function inputQueue(): { stream: AsyncGenerator<SDKUserMessage>; push: (m: SDKUserMessage) => void; close: () => void } {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  async function* stream(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (queue.length > 0) yield queue.shift()!;
      if (closed) return;
      await new Promise<void>((resolve) => (wake = resolve));
      wake = null;
    }
  }
  return {
    stream: stream(),
    push: (m) => {
      queue.push(m);
      wake?.();
    },
    close: () => {
      closed = true;
      wake?.();
    },
  };
}

function newProgress(): TurnProgress {
  return { lastMainUsage: null, agentTextSent: false, compactions: 0, assistantError: null, rejected: null, output: false };
}

/** Gives the process's messages to this turn until its result. */
function attach(proc: ClaudeProcess, input: TurnInput): Promise<acp.StopReason> {
  if (proc.idleTimer) clearTimeout(proc.idleTimer);
  proc.idleTimer = null;
  proc.last = input;
  // Stop ends the turn at once: the process is killed, but its exit (and the end of its message
  // stream) can lag well behind, and the chat must not keep saying it works until then.
  const stop = (): void => {
    proc.kill();
    if (proc.turn?.input === input) endTurn(proc, { reason: "cancelled" });
  };
  input.abort.signal.addEventListener("abort", stop);
  const done = new Promise<acp.StopReason>((settle, fail) => {
    proc.turn = {
      input,
      promptId: input.attach ? null : input.messageId,
      progress: newProgress(),
      settle,
      fail,
      unlink: () => input.abort.signal.removeEventListener("abort", stop),
    };
  });
  input.onQuery?.(proc.query);
  if (input.abort.signal.aborted) stop();
  return done;
}

/** Ends the process's current turn. */
function endTurn(proc: ClaudeProcess, outcome: { reason: acp.StopReason } | { error: unknown }): void {
  const turn = proc.turn;
  if (!turn) return;
  proc.turn = null;
  turn.unlink();
  turn.input.onQuery?.(null);
  if ("reason" in outcome) turn.settle(outcome.reason);
  else turn.fail(outcome.error);
}

export async function runClaudeTurn(input: TurnInput): Promise<acp.StopReason> {
  const { acpSessionId, state } = input;
  const existing = processes.get(acpSessionId);
  // The chat taking a turn its process started on its own.
  if (input.attach) {
    if (!existing || existing.closed || !existing.waking || existing.turn) return "end_turn";
    const held = existing.waking.messages;
    clearTimeout(existing.waking.timer);
    existing.waking = null;
    const done = attach(existing, input);
    existing.chain = existing.chain.then(async () => {
      for (const message of held) await route(existing, message);
    });
    return done;
  }
  const userMessage: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: promptContent(input.prompt) },
    parent_tool_use_id: null,
    uuid: input.messageId,
  };
  // Background tasks still run in the process: the prompt goes to it, so they can still wake the chat.
  if (
    existing &&
    !existing.closed &&
    !existing.turn &&
    !existing.waking &&
    (existing.tasks.size > 0 || wakeUpKeepMs(existing) !== null) &&
    !input.step &&
    existing.key === spawnKey(input) &&
    existing.claudeSessionId === state.claudeSessionId
  ) {
    // A process busy with its tasks may be slow to answer; a Stop meanwhile must still end the turn.
    await Promise.race([
      existing.query.setPermissionMode(state.options.permissionMode).catch(() => undefined),
      abortedOrAfter(input.abort.signal, CONTROL_WAIT_MS),
    ]);
    // Stopped before the prompt reached the process: its background tasks go on.
    if (input.abort.signal.aborted) return "cancelled";
    const done = attach(existing, input);
    existing.push(userMessage);
    return done;
  }
  if (existing) {
    void letGo(existing, STOPPED_TASKS);
    // A stopped turn's process may still be ending its tools and writing the conversation.
    if (existing.closed) await Promise.race([existing.exited, abortedOrAfter(input.abort.signal, STOPPED_EXIT_WAIT_MS)]);
  }
  if (input.abort.signal.aborted) return "cancelled";
  return spawn(input, userMessage);
}

async function spawn(input: TurnInput, userMessage: SDKUserMessage): Promise<acp.StopReason> {
  const { acpSessionId, state } = input;
  const { model, permissionMode, effort } = state.options;
  const prompt = inputQueue();
  prompt.push(userMessage);
  const processAbort = new AbortController();

  await mkdir(CHAT_ATTACHMENT_DIR, { recursive: true }).catch(() => undefined);
  const executable = await resolveClaudeExecutable();
  // Stopped while the process was being set up: none is started.
  if (input.abort.signal.aborted) return "cancelled";
  const mcpServers = { ...input.mcpServers, ...input.step?.mcpServers };
  const allowedTools = [...(input.allowedTools ?? []), ...(input.step?.allowedTools ?? [])];
  // Claude Code's own Workflow tool runs workflows from its settings folders, not the project's: in a
  // harness chat only the project's (the run_workflow tool) are on offer.
  const disallowedTools = [...CLAUDE_TOOLS_OFF, ...(input.step?.disallowedTools ?? [])];
  const stream = startQuery({
    // Streaming input keeps the process alive past the result: for context usage, the prompt
    // suggestion, and background tasks that start a turn of their own when they finish.
    prompt: prompt.stream,
    options: {
      cwd: state.cwd,
      // Snapshots messages point at (terminal screens, other chats); reading them needs no approval.
      additionalDirectories: [CHAT_ATTACHMENT_DIR, ...(input.step?.additionalDirectories ?? [])],
      resume: state.claudeSessionId ?? undefined,
      pathToClaudeCodeExecutable: executable,
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      abortController: processAbort,
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
      disallowedTools,
      ...(input.chrome ? { extraArgs: CLAUDE_CHROME_ARGS } : {}),
      ...(input.step?.skills ? { skills: input.step.skills } : {}),
      ...(input.step?.strictMcpConfig ? { strictMcpConfig: true } : {}),
      ...(input.step?.outputFormat ? { outputFormat: input.step.outputFormat } : {}),
      hooks: {
        ...(input.step?.guards?.length || input.worktreeGuards
          ? pathGuardHooks(() => [...(input.step?.guards ?? []), ...(input.worktreeGuards?.() ?? [])])
          : {}),
        // Claude says the effort a turn ran at only to hooks; with none picked, that is its default
        // for the model (docs/specs/composer-effort.md). It only reads, so the turn ends as before.
        Stop: [
          {
            hooks: [
              async (hookInput) => {
                if (hookInput.hook_event_name === "Stop" && hookInput.transcript_path) {
                  proc.turn?.input.onTranscript?.(hookInput.transcript_path);
                }
                const level = turnEffort(hookInput);
                if (level && !effort) proc.last.onDefaultEffort?.({ model: model ?? null, effort: level });
                // What the CLI will wake the chat for later (scheduled-wake-ups.md).
                const wakeUps = wakeUpsOf(hookInput);
                if (wakeUps && (wakeUps.length > 0 || proc.wakeUps.length > 0)) {
                  proc.wakeUps = wakeUps;
                  proc.last.onWakeUps?.(wakeUps);
                }
                return {};
              },
            ],
          },
        ],
      },
      ...(input.appendSystemPrompt
        ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: input.appendSystemPrompt } }
        : {}),
    },
  });

  let exited!: () => void;
  const proc: ClaudeProcess = {
    query: stream,
    // A workflow step's process is its own: no later turn joins it.
    key: input.step ? `step:${crypto.randomUUID()}` : spawnKey(input),
    claudeSessionId: state.claudeSessionId,
    push: prompt.push,
    closeInput: prompt.close,
    kill: () => {
      proc.closed = true;
      prompt.close();
      processAbort.abort();
    },
    closed: false,
    exited: new Promise<void>((resolve) => (exited = resolve)),
    turn: null,
    last: input,
    tasks: new Map(),
    wakeUps: [],
    dropWakeUps: false,
    waking: null,
    idleTimer: null,
    chain: Promise.resolve(),
  };
  processes.set(acpSessionId, proc);
  const done = attach(proc, input);

  void (async () => {
    try {
      for await (const message of stream) {
        proc.chain = proc.chain.then(() => route(proc, message));
        await proc.chain;
      }
    } catch (error) {
      if (proc.turn && !proc.turn.input.abort.signal.aborted) endTurn(proc, { error });
      else log(`after the turn: ${String(error)}`);
    } finally {
      await proc.chain.catch(() => undefined);
      proc.closed = true;
      clearTimers(proc);
      proc.waking = null;
      if (proc.tasks.size > 0) proc.last.onBackgroundTasks?.([]);
      proc.tasks.clear();
      // Its wake-ups die with it: the daemon fires the one-shot ones itself (scheduled-wake-ups.md).
      if (proc.wakeUps.length > 0) {
        const pending = proc.wakeUps;
        proc.wakeUps = [];
        if (proc.dropWakeUps || !proc.last.onWakeUpsOrphaned) proc.last.onWakeUps?.([]);
        else proc.last.onWakeUpsOrphaned(pending);
      }
      endTurn(proc, { reason: proc.turn?.input.abort.signal.aborted ? "cancelled" : "end_turn" });
      prompt.close();
      if (processes.get(acpSessionId) === proc) processes.delete(acpSessionId);
      exited();
    }
  })();
  return done;
}

/** Delivers one message: to the running turn, to a turn being woken, or to the process between turns. */
async function route(proc: ClaudeProcess, message: SDKMessage): Promise<void> {
  // Killed (a Stop): what it still says until it exits belongs to no turn, nor starts one.
  if (proc.closed && !proc.turn) return;
  if (message.type === "system" && message.subtype === "background_tasks_changed") {
    const had = proc.tasks.size;
    proc.tasks = new Map(message.tasks.filter((t) => !t.ambient).map((t) => [t.task_id, t.description]));
    if (had > 0 || proc.tasks.size > 0) proc.last.onBackgroundTasks?.([...proc.tasks.values()]);
    if (!proc.turn && !proc.waking) armIdle(proc);
    return;
  }
  if (proc.waking) {
    proc.waking.messages.push(message);
    return;
  }
  const turn = proc.turn;
  if (!turn) {
    if (message.type === "prompt_suggestion") {
      if (message.suggestion.trim()) proc.last.onPromptSuggestion?.(message.suggestion.trim());
      if (proc.tasks.size === 0 && wakeUpKeepMs(proc) === null) void letGo(proc, STOPPED_TASKS);
      return;
    }
    if (startsTurn(message) && !proc.closed) wake(proc, message);
    return;
  }
  if (turn.input.abort.signal.aborted) return;
  const { input, progress } = turn;
  if (message.type === "result") {
    if (notThisTurns(turn, message)) {
      log(`a result the CLI produced before this turn's prompt was taken (${message.subtype}); the turn goes on`);
      return;
    }
    const stopReason = await finishTurn(message, proc.query, progress, input.emit, input.onTurnEnd);
    if (message.subtype === "success") {
      input.onResult?.({
        text: message.result,
        structured: message.structured_output,
        usage: {
          inputTokens: message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0),
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          costUsd: message.total_cost_usd,
        },
        ...(progress.context ? { context: progress.context } : {}),
      });
    }
    endTurn(proc, { reason: stopReason });
    armIdle(proc);
    return;
  }
  if (message.type === "prompt_suggestion") {
    if (message.suggestion.trim()) input.onPromptSuggestion?.(message.suggestion.trim());
    return;
  }
  if (shownNotification(message)) {
    // A task that finished while the turn runs: shown where Claude reads it.
    await input.emit({
      sessionUpdate: "user_message_chunk",
      messageId: crypto.randomUUID(),
      content: { type: "text", text: taskNotificationText(message) },
    });
    return;
  }
  if (message.type === "system" && message.subtype === "init") proc.claudeSessionId = message.session_id;
  if (message.type === "assistant" || message.type === "stream_event" || message.type === "user") progress.output = true;
  await forwardMessage(message, input, progress);
}

/**
 * A result for something other than this turn's prompt. A resumed conversation can make the CLI run a
 * turn of its own before taking the prompt (a background task the daemon's restart stopped): its
 * empty result names no prompt, and taking it as the end would leave the real answer unseen.
 */
export function notThisTurns(
  turn: { promptId: string | null; progress: { output: boolean } },
  message: Extract<SDKMessage, { type: "result" }>,
): boolean {
  if (!turn.promptId) return false;
  const ids = [...(message.user_message_uuids ?? []), ...(message.user_message_uuid ? [message.user_message_uuid] : [])];
  if (ids.length > 0) return !ids.includes(turn.promptId);
  // CLIs that predate the field name nothing: only an empty result before any output is set aside.
  return message.subtype === "success" && !message.result.trim() && !turn.progress.output;
}

/** The CLI started a turn between the chat's turns: the chat takes it, its messages held until then. */
function wake(proc: ClaudeProcess, first: SDKMessage): void {
  if (proc.idleTimer) clearTimeout(proc.idleTimer);
  proc.idleTimer = null;
  const onWake = proc.last.onWake;
  if (!onWake) {
    armIdle(proc);
    return;
  }
  const notification = shownNotification(first) ? taskNotificationText(first) : "";
  // With no task notification, a wake-up that is due is what woke it.
  const now = Date.now();
  const wakeUp = notification ? undefined : proc.wakeUps.find((w) => w.at !== null && w.at <= now + 60_000);
  const timer = setTimeout(() => {
    // Nobody took it (the chat went away): its messages are dropped.
    proc.waking = null;
    armIdle(proc);
  }, WAKE_ATTACH_MS);
  proc.waking = { messages: shownNotification(first) ? [] : [first], timer };
  onWake(notification, wakeUp);
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
        input.onSlashCommands?.(message.slash_commands, message.skills);
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
          content: toolResultContent(block.content),
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
    const said = `${title}
${errorText}`;
    const signedOut = !limit && isClaudeSignedOut(said, progress.assistantError);
    const end: TurnEndMeta = limit
      ? { reason: "usage-limit", resetsAt: limit.resetsAt }
      : signedOut
        ? { reason: "error", signIn: "claude" }
        : { reason: "error" };
    onTurnEnd?.(end);
    const notice = signedOut ? signedOutNotice(errorText.trim() || title) : (explainClaudeFailure(said) ?? title);
    await update({ sessionUpdate: "notice", severity: "error", title: notice, _meta: { [TURN_RECOVERY_META.turnEnd]: end } });
  };
  if (message.subtype === "success") {
    // Local commands (/context, /cost…) answer only in the result. A turn that answered through its
    // output format (a workflow's question to the chat that started it) has that answer there as
    // JSON: the chat shows its prose instead.
    const text = message.structured_output === undefined ? message.result : structuredProse(message.structured_output);
    if (!progress.agentTextSent && text.trim() && !message.is_error) {
      await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
    }
    if (message.is_error) await failed(message.result || "The turn failed", message.result);
  } else {
    log(`turn ended with ${message.subtype}`);
    await failed(resultErrorTitle(message.subtype), message.errors.join("\n"));
  }
  await reportContextUsage(message, stream, progress, update).catch((error) =>
    log(`context usage failed: ${String(error)}`),
  );
  // The account's usage limits, read while this turn's process is still up (usage-limits.ts).
  noteClaudeTurnEnded(stream);
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
    progress.context = stepContext(exact);
    const meta: ContextUsageMeta = {
      estimated: false,
      // Every row, the free space, buffer and deferred tools too; `kind` tells them apart.
      categories: exact.categories
        .filter((c) => c.tokens > 0)
        .map((c) => ({ name: c.name, tokens: c.tokens, ...(c.id ? { id: c.id } : {}), kind: c.kind })),
      items: progress.context.items,
      mcpTools: exact.mcpTools.map((t) => ({ name: t.name, server: t.serverName, tokens: t.tokens, loaded: t.isLoaded !== false })),
      memoryFiles: exact.memoryFiles.map((f) => ({ path: f.path, type: f.type, tokens: f.tokens })),
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

/** The context breakdown as a workflow step records it: the window's rows, and each skill, MCP server, memory file and subagent. */
function stepContext(usage: SDKControlGetContextUsageResponse): WorkflowStepContext {
  const mcp = new Map<string, number>();
  // Deferred tool schemas are out of the window until searched for.
  for (const tool of usage.mcpTools) if (tool.isLoaded !== false) mcp.set(tool.serverName, (mcp.get(tool.serverName) ?? 0) + tool.tokens);
  return {
    categories: usage.categories.filter((c) => c.kind === "used" && c.tokens > 0).map((c) => ({ id: c.id ?? c.name, name: c.name, tokens: c.tokens })),
    items: [
      ...(usage.skills?.skillFrontmatter ?? []).map((s) => ({ kind: "skill" as const, name: s.name, tokens: s.tokens })),
      ...[...mcp].map(([name, tokens]) => ({ kind: "mcp" as const, name, tokens })),
      ...usage.memoryFiles.map((m) => ({ kind: "memory" as const, name: m.path, tokens: m.tokens })),
      ...usage.agents.map((a) => ({ kind: "agent" as const, name: a.agentType, tokens: a.tokens })),
    ],
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
  };
}

function permissionBridge(
  acpSessionId: string,
  askPermission: TurnInput["askPermission"],
  onPermissionMode: TurnInput["onPermissionMode"],
): CanUseTool {
  return async (toolName, input, options) => {
    const planExit = toolName === "ExitPlanMode";
    if (toolName === QUESTION_TOOL) {
      const response = await askPermission({
        sessionId: acpSessionId,
        toolCall: {
          toolCallId: options.toolUseID,
          title: options.title ?? toolTitle(toolName, input),
          kind: toolKind(toolName),
          status: "pending",
          rawInput: input,
          _meta: { [CHAT_META.toolName]: toolName },
        },
        options: QUESTION_OPTIONS,
      });
      return questionResult(input, response);
    }
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

/** A tool result's text, then each image in it (a screenshot, an image it read) for the chat to show. */
/** Claude Code tools a harness chat never offers: the harness has its own for these. */
const CLAUDE_TOOLS_OFF = ["Workflow"];

export function toolResultContent(content: unknown): acp.ToolCallContent[] {
  const parts: acp.ToolCallContent[] = [{ type: "content", content: { type: "text", text: toolResultText(content) } }];
  if (!Array.isArray(content)) return parts;
  for (const part of content) {
    const source = part?.type === "image" ? part.source : null;
    if (source?.type !== "base64" || typeof source.data !== "string") continue;
    const mimeType = typeof source.media_type === "string" ? source.media_type : "image/png";
    parts.push({ type: "content", content: { type: "image", data: source.data, mimeType } });
  }
  return parts;
}

export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  // Only the text parts: an image beside the text would otherwise leave an empty line.
  return content
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text))
    .join("\n");
}

/** The readable part of a structured answer (its text or summary); empty when it has none. */
export function structuredProse(output: unknown): string {
  if (typeof output !== "object" || output === null) return "";
  for (const key of ["text", "summary"]) {
    const value: unknown = Reflect.get(output, key);
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}
