import { describe, expect, test } from "bun:test";
import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { claudeLimitsFrom, codexLimitsFrom } from "./usage-limits.ts";
import { chatMcpServer } from "./claude-control.ts";

type Usage = Parameters<typeof claudeLimitsFrom>[0];
const usage = (rateLimits: unknown, available = true): Usage =>
  ({ subscription_type: "max", rate_limits_available: available, rate_limits: rateLimits, session: {} }) as unknown as Usage;

describe("claudeLimitsFrom", () => {
  test("reads the limits list: session, week, and a model's week", () => {
    const limits = claudeLimitsFrom(
      usage({
        five_hour: { utilization: 1, resets_at: null },
        limits: [
          { kind: "session", percent: 50, resets_at: "2026-11-21T14:59:59Z" },
          { kind: "weekly_all", percent: 86, resets_at: "2026-11-21T23:59:59Z" },
          { kind: "weekly_scoped", percent: 68, resets_at: null, scope: { model: { display_name: "Fable" } } },
          { kind: "something_new", percent: 3 },
        ],
      }),
      1,
    );
    expect(limits).toEqual({
      provider: "claude",
      plan: "max",
      status: "ok",
      updatedAt: 1,
      windows: [
        { id: "session", usedPercent: 50, resetsAt: Date.parse("2026-11-21T14:59:59Z") },
        { id: "weekly", usedPercent: 86, resetsAt: Date.parse("2026-11-21T23:59:59Z") },
        { id: "weekly_scoped", label: "Fable", usedPercent: 68, resetsAt: null },
      ],
    });
  });

  test("falls back to the named windows without a limits list", () => {
    const limits = claudeLimitsFrom(usage({ five_hour: { utilization: 12.5, resets_at: null }, seven_day: null, seven_day_opus: { utilization: 140, resets_at: null } }));
    expect(limits.windows).toEqual([
      { id: "session", usedPercent: 12.5, resetsAt: null },
      { id: "weekly_scoped", label: "Opus", usedPercent: 100, resetsAt: null },
    ]);
  });

  test("an API key account has no plan limits", () => {
    expect(claudeLimitsFrom(usage(null, false)).status).toBe("unavailable");
  });
});

describe("codexLimitsFrom", () => {
  test("classifies the windows by their length", () => {
    const limits = codexLimitsFrom(
      {
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_at: 1_700_000_000 },
          secondary_window: { used_percent: 40, limit_window_seconds: 604_800, reset_at: 1_700_100_000 },
        },
      },
      5,
    );
    expect(limits).toEqual({
      provider: "codex",
      plan: "plus",
      status: "ok",
      updatedAt: 5,
      windows: [
        { id: "session", usedPercent: 20, resetsAt: 1_700_000_000_000 },
        { id: "weekly", usedPercent: 40, resetsAt: 1_700_100_000_000 },
      ],
    });
  });

  test("an answer without a plan is not one", () => {
    expect(codexLimitsFrom({ rate_limit: null })).toBeNull();
  });
});

describe("chatMcpServer", () => {
  test("keeps what the panel shows", () => {
    const status = {
      name: "notion",
      status: "needs-auth",
      scope: "user",
      config: { type: "http", url: "https://mcp.notion.com/mcp" },
    } as McpServerStatus;
    expect(chatMcpServer(status, "harness")).toEqual({
      name: "notion",
      status: "needs-auth",
      scope: "user",
      transport: "http",
      url: "https://mcp.notion.com/mcp",
      tools: [],
      harness: false,
    });
  });

  test("a stdio server and the harness's own", () => {
    const stdio = chatMcpServer({ name: "fs", status: "failed", error: "spawn ENOENT", config: { command: "npx" } } as McpServerStatus, "harness");
    expect(stdio).toMatchObject({ transport: "stdio", error: "spawn ENOENT", scope: null });
    const own = chatMcpServer({ name: "harness", status: "connected", tools: [{ name: "list_sessions" }] } as McpServerStatus, "harness");
    expect(own).toMatchObject({ harness: true, tools: ["list_sessions"] });
  });
});
