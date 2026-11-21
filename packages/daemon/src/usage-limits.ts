import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderUsageLimits, UsageLimitWindow, UsageLimitsResult } from "@zomfy/protocol";
import { log } from "./log.ts";

// How much of the host's accounts' usage limits is spent, as Orca's rate-limit service reads it:
// Claude from Claude Code's own /usage data (the claude.ai plan's windows), Codex from the ChatGPT
// backend with the token the Codex CLI saved. Read on request and kept a while, and refreshed for
// free whenever a Claude turn ends (its process is still up then).

/** What was read stays this long before a request reads it again. */
const FRESH_MS = 10 * 60_000;
/** A refresh asked for by hand still waits this long since the last read. */
const MIN_REFRESH_MS = 20_000;
/** A turn's end reads Claude's limits at most this often. */
const TURN_READ_MS = 60_000;
const CODEX_TIMEOUT_MS = 10_000;

type UsageResponse = Awaited<ReturnType<Query["usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"]>>;
interface RawWindow {
  utilization?: number | null;
  resets_at?: string | null;
}
interface RawLimit {
  kind?: string;
  percent?: number | null;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

function epoch(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

/** Claude's /usage answer as windows: the session, the week, and each model's own week. */
export function claudeLimitsFrom(usage: UsageResponse, now = Date.now()): ProviderUsageLimits {
  const plan = usage.subscription_type ?? null;
  if (!usage.rate_limits_available || !usage.rate_limits) {
    return { provider: "claude", plan, status: "unavailable", windows: [], updatedAt: now };
  }
  const limits = usage.rate_limits as typeof usage.rate_limits & { limits?: RawLimit[] | null };
  const windows: UsageLimitWindow[] = [];
  if (Array.isArray(limits.limits) && limits.limits.length > 0) {
    for (const limit of limits.limits) {
      const id = limit.kind === "session" ? "session" : limit.kind === "weekly_all" ? "weekly" : limit.kind === "weekly_scoped" ? "weekly_scoped" : null;
      if (!id) continue;
      const label = limit.scope?.model?.display_name?.trim();
      windows.push({ id, ...(label ? { label } : {}), usedPercent: percent(limit.percent), resetsAt: epoch(limit.resets_at) });
    }
  } else {
    const raw = limits as unknown as Record<string, RawWindow | null | undefined>;
    const add = (key: string, id: string, label?: string) => {
      const window = raw[key];
      if (window) windows.push({ id, ...(label ? { label } : {}), usedPercent: percent(window.utilization), resetsAt: epoch(window.resets_at) });
    };
    add("five_hour", "session");
    add("seven_day", "weekly");
    add("seven_day_opus", "weekly_scoped", "Opus");
    add("seven_day_sonnet", "weekly_scoped", "Sonnet");
  }
  return { provider: "claude", plan, status: "ok", windows, updatedAt: now };
}

interface CodexWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

/** The ChatGPT backend's answer as windows: 5 hours is the session, 7 days the week. */
export function codexLimitsFrom(payload: unknown, now = Date.now()): ProviderUsageLimits | null {
  const body = payload as { plan_type?: unknown; rate_limit?: { primary_window?: CodexWindow | null; secondary_window?: CodexWindow | null } | null };
  if (!body || typeof body.plan_type !== "string") return null;
  const windows: UsageLimitWindow[] = [];
  for (const window of [body.rate_limit?.primary_window, body.rate_limit?.secondary_window]) {
    if (!window || percent(window.used_percent) === null) continue;
    const minutes = typeof window.limit_window_seconds === "number" ? Math.round(window.limit_window_seconds / 60) : null;
    const id = minutes !== null && Math.abs(minutes - 300) <= 1 ? "session" : minutes !== null && Math.abs(minutes - 10080) <= 1 ? "weekly" : null;
    if (!id) continue;
    windows.push({ id, usedPercent: percent(window.used_percent), resetsAt: typeof window.reset_at === "number" ? window.reset_at * 1000 : null });
  }
  return { provider: "codex", plan: body.plan_type, status: "ok", windows, updatedAt: now };
}

/** Codex's limits, or null when this host has no Codex sign-in. */
async function readCodexLimits(codexHome: string | undefined): Promise<ProviderUsageLimits | null> {
  let auth: { tokens?: { access_token?: string; account_id?: string } };
  try {
    auth = JSON.parse(await readFile(join(codexHome || join(homedir(), ".codex"), "auth.json"), "utf8"));
  } catch {
    return null;
  }
  const token = auth.tokens?.access_token;
  if (!token) return null;
  const now = Date.now();
  try {
    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "codex-cli",
        ...(auth.tokens?.account_id ? { "ChatGPT-Account-Id": auth.tokens.account_id } : {}),
      },
      signal: AbortSignal.timeout(CODEX_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const error = response.status === 401 ? "Codex's saved sign-in has expired; it renews the next time Codex runs" : `Codex answered ${response.status}`;
      return { provider: "codex", plan: null, status: "error", error, windows: [], updatedAt: now };
    }
    return codexLimitsFrom(await response.json(), now) ?? { provider: "codex", plan: null, status: "unavailable", windows: [], updatedAt: now };
  } catch (error) {
    return { provider: "codex", plan: null, status: "error", error: String(error), windows: [], updatedAt: now };
  }
}

export interface UsageLimitSources {
  /** Runs `read` against a Claude process with the host's Claude account (a chat's, or one of its own). */
  withClaude<T>(read: (query: Query) => Promise<T>, sessionId?: string): Promise<T>;
  /** CODEX_HOME from the Agents settings, if set. */
  codexHome(): Promise<string | undefined>;
}

let current: UsageLimits | null = null;

/** Called by a Claude turn at its end, while its process is still up. */
export function noteClaudeTurnEnded(stream: Query): void {
  current?.noteTurnEnded(stream);
}

export class UsageLimits {
  private claude: ProviderUsageLimits | null = null;
  private codex: ProviderUsageLimits | null = null;
  private codexChecked = 0;
  private reading: Promise<void> | null = null;
  private lastTurnRead = 0;

  constructor(private readonly sources: UsageLimitSources) {
    current = this;
  }

  async read(options: { refresh?: boolean; sessionId?: string } = {}): Promise<UsageLimitsResult> {
    const now = Date.now();
    const keep = options.refresh ? MIN_REFRESH_MS : FRESH_MS;
    const claude = now - (this.claude?.updatedAt ?? 0) > keep;
    const codex = now - this.codexChecked > keep;
    if (claude || codex) {
      this.reading ??= this.readAll(claude, codex, options.sessionId).finally(() => (this.reading = null));
      await this.reading;
    }
    return { providers: [this.claude, this.codex].filter((p): p is ProviderUsageLimits => p !== null) };
  }

  /** A Claude turn just ended with its process still up: its limits, read there, cost no process. */
  noteTurnEnded(stream: Query): void {
    const now = Date.now();
    if (now - this.lastTurnRead < TURN_READ_MS) return;
    this.lastTurnRead = now;
    void this.readClaude(stream).catch(() => undefined);
  }

  private async readAll(claude: boolean, codex: boolean, sessionId: string | undefined): Promise<void> {
    await Promise.all([
      claude && this.sources.withClaude((stream) => this.readClaude(stream), sessionId).catch((error) => {
        log(`usage limits: ${String(error)}`);
        this.claude = { provider: "claude", plan: this.claude?.plan ?? null, status: "error", error: String(error), windows: this.claude?.windows ?? [], updatedAt: Date.now() };
      }),
      codex &&
        (async () => {
          this.codex = await readCodexLimits(await this.sources.codexHome());
          this.codexChecked = Date.now();
        })(),
    ]);
  }

  private async readClaude(stream: Query): Promise<void> {
    if (typeof stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== "function") {
      this.claude = { provider: "claude", plan: null, status: "unavailable", windows: [], updatedAt: Date.now() };
      return;
    }
    const usage = await stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    this.claude = claudeLimitsFrom(usage);
  }
}
