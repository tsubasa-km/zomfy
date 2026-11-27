import { query, type McpServerStatus, type Options, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatMcpAuthStart, ChatMcpServer } from "@zomfy/protocol";
import { CLAUDE_CHROME_ARGS, resolveClaudeExecutable } from "./claude-executable.ts";
import { log } from "./log.ts";
import { spawnEnvironment } from "./user-environment.ts";

// A Claude Code process with no turn in it, started for what only a running CLI can answer between
// turns: its MCP servers' state, reconnecting or signing in to one, the account's usage limits. It
// never gets a prompt, so it writes no transcript. One per key (a chat, or the host's usage reader);
// it ends a while after its last use, or once a sign-in it holds has had time to finish.

/** How long an idle control process stays up after its last request. */
const IDLE_MS = 90_000;
/** How long one waiting for a browser sign-in stays: the OAuth flow's callback listener lives in it. */
const SIGN_IN_MS = 10 * 60_000;

export interface ControlLaunch {
  cwd: string;
  env: Record<string, string>;
  mcpServers?: Options["mcpServers"];
  /** Connect no MCP server at all (a process that only reads the account's limits). */
  noMcp?: boolean;
  /** Start with Claude in Chrome, like the chat's turns, so its server is listed. */
  chrome?: boolean;
}

interface Held {
  query: Query;
  close: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Kept at least until then (a sign-in in progress). */
  until: number;
  /** Settles when the process has gone, for any reason. */
  ended: Promise<void>;
}

/** The SDK's untyped OAuth controls (sdk.mjs has them; sdk.d.ts does not declare them yet). */
interface McpAuthControls {
  mcpAuthenticate?: (
    serverName: string,
    redirectUri?: string,
  ) => Promise<{ authUrl?: string; requiresUserAction?: boolean; callbackExpected?: boolean } | undefined>;
  mcpSubmitOAuthCallbackUrl?: (serverName: string, callbackUrl: string) => Promise<unknown>;
}

/** How a held process is being used, kept beside it so eviction can decide without waiting. */
export interface ControlUse {
  /** Requests running in it now. */
  busy: number;
  /** When it was last asked something. */
  lastUsed: number;
  /** Kept at least until then (a sign-in in progress). */
  until: number;
}

/**
 * The idle process to end so a new one can start without more than `limit` up: the one asked
 * least recently, never one answering a request or holding a sign-in. Null when none may go.
 */
export function controlToEvict(uses: ReadonlyMap<string, ControlUse>, limit: number, now: number): string | null {
  if (uses.size < limit) return null;
  let oldest: [string, ControlUse] | null = null;
  for (const entry of uses) {
    const [, use] = entry;
    if (use.busy > 0 || use.until > now) continue;
    if (!oldest || use.lastUsed < oldest[1].lastUsed) oldest = entry;
  }
  return oldest?.[0] ?? null;
}

export interface ClaudeControlOptions {
  /**
   * At most this many processes for keys it counts are up at once: starting another ends the
   * least recently asked idle one. Each Claude Code process, with its MCP servers, costs seconds
   * of CPU to start and hundreds of MB to keep, and a person flicking through threads asks for one
   * per thread.
   */
  limit?: number;
  /** Which keys the limit counts; all by default. */
  counts?: (key: string) => boolean;
}

export class ClaudeControl {
  private readonly held = new Map<string, Promise<Held>>();
  private readonly uses = new Map<string, ControlUse>();

  constructor(
    private readonly launch: (key: string) => Promise<ControlLaunch>,
    private readonly options: ClaudeControlOptions = {},
  ) {}

  /** Runs `use` against this key's control process, starting it if none is up. */
  async with<T>(key: string, use: (query: Query) => Promise<T>, holdMs = IDLE_MS): Promise<T> {
    let pending = this.held.get(key);
    if (!pending) {
      this.makeRoom(key);
      const started = this.start(key);
      pending = started;
      this.held.set(key, started);
      const forget = () => {
        if (this.held.get(key) !== started) return;
        this.held.delete(key);
        this.uses.delete(key);
      };
      started.then((held) => held.ended.then(forget), forget);
    }
    const usage = this.uses.get(key) ?? { busy: 0, lastUsed: 0, until: 0 };
    if (this.held.get(key) === pending) this.uses.set(key, usage);
    usage.busy++;
    usage.lastUsed = Date.now();
    let held: Held;
    try {
      held = await pending;
    } catch (error) {
      usage.busy--;
      throw error;
    }
    if (held.timer) clearTimeout(held.timer);
    held.timer = null;
    try {
      return await use(held.query);
    } finally {
      usage.busy--;
      usage.lastUsed = Date.now();
      held.until = Math.max(held.until, Date.now() + holdMs);
      // Only a hold past the idle time (a sign-in) keeps it from being ended for another.
      if (holdMs > IDLE_MS) usage.until = Math.max(usage.until, held.until);
      if (this.held.get(key) === pending) {
        held.timer = setTimeout(() => this.close(key), Math.max(0, held.until - Date.now()));
      }
    }
  }

  /** Whether this key's process is up (or starting). */
  has(key: string): boolean {
    return this.held.has(key);
  }

  close(key: string): void {
    const pending = this.held.get(key);
    if (!pending) return;
    this.held.delete(key);
    this.uses.delete(key);
    void pending.then((held) => {
      if (held.timer) clearTimeout(held.timer);
      held.close();
    }, () => undefined);
  }

  closeAll(): void {
    for (const key of [...this.held.keys()]) this.close(key);
  }

  /** Ends the least recently asked idle process when starting `key` would pass the limit. */
  private makeRoom(key: string): void {
    const { limit, counts = () => true } = this.options;
    if (limit === undefined || !counts(key)) return;
    const counted = new Map([...this.uses].filter(([k]) => counts(k) && this.held.has(k)));
    const evict = controlToEvict(counted, limit, Date.now());
    if (evict) {
      log(`claude control: ending ${evict} to start ${key} (at most ${limit} up)`);
      this.close(evict);
    }
  }

  private async start(key: string): Promise<Held> {
    const launch = await this.launch(key);
    const abort = new AbortController();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    // Streaming input with nothing in it: the process starts, connects its servers and waits.
    async function* idle(): AsyncGenerator<SDKUserMessage> {
      await released;
    }
    const stream = query({
      prompt: idle(),
      options: {
        cwd: launch.cwd,
        pathToClaudeCodeExecutable: await resolveClaudeExecutable(),
        settingSources: ["user", "project", "local"],
        abortController: abort,
        stderr: (line) => log(`[claude control] ${line}`),
        env: { ...(await spawnEnvironment()), ...launch.env },
        ...(launch.mcpServers && Object.keys(launch.mcpServers).length > 0 ? { mcpServers: launch.mcpServers } : {}),
        ...(launch.noMcp ? { strictMcpConfig: true } : {}),
        ...(launch.chrome && !launch.noMcp ? { extraArgs: CLAUDE_CHROME_ARGS } : {}),
      },
    });
    // Drained so the SDK's message queue never backs up; an idle process sends next to nothing.
    const ended = (async () => {
      try {
        for await (const _ of stream) {
          if (abort.signal.aborted) break;
        }
      } catch (error) {
        if (!abort.signal.aborted) log(`claude control ${key} ended: ${String(error)}`);
      }
    })();
    const held: Held = {
      query: stream,
      close: () => {
        release();
        abort.abort();
      },
      timer: null,
      until: 0,
      ended,
    };
    return held;
  }
}

/** One server as the panel shows it. */
export function chatMcpServer(status: McpServerStatus, harnessServer: string): ChatMcpServer {
  const config = status.config as { type?: string; url?: string } | undefined;
  return {
    name: status.name,
    status: status.status,
    ...(status.error ? { error: status.error } : {}),
    scope: status.scope ?? status.source ?? null,
    transport: config?.type ?? (config && "command" in config ? "stdio" : null),
    ...(typeof config?.url === "string" ? { url: config.url } : {}),
    tools: (status.tools ?? []).map((tool) => tool.name),
    harness: status.name === harnessServer,
  };
}

/** Starts signing in to `server` in this process; it must stay up until the browser comes back. */
export async function startMcpSignIn(stream: Query, server: string): Promise<ChatMcpAuthStart> {
  const controls = stream as unknown as McpAuthControls;
  if (typeof controls.mcpAuthenticate !== "function") {
    throw new Error("This Claude Code cannot sign in to MCP servers from here. Run /mcp in a Claude terminal instead.");
  }
  const answer = await controls.mcpAuthenticate(server);
  return { authUrl: answer?.authUrl ?? null, callbackExpected: answer?.callbackExpected === true };
}

export async function submitMcpCallback(stream: Query, server: string, callbackUrl: string): Promise<void> {
  const controls = stream as unknown as McpAuthControls;
  if (typeof controls.mcpSubmitOAuthCallbackUrl !== "function") throw new Error("This Claude Code cannot take a sign-in address.");
  await controls.mcpSubmitOAuthCallbackUrl(server, callbackUrl);
}

export { SIGN_IN_MS };
