import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ClaudeCliStatus, ClaudeCliUpdateResult } from "@zomfy/protocol";
// The SDK's exports map hides its package.json; Bun inlines this at build time.
import sdkPackage from "../node_modules/@anthropic-ai/claude-agent-sdk/package.json" with { type: "json" };
import { loadHostSettings } from "./host-settings.ts";
import { hostPath } from "./tui-agent-detection.ts";

// Why: the user's installed CLI carries their login and settings; the SDK's bundled copy would not.
// Found on the host's full PATH (saved and login-shell entries), like every other agent.
async function detected(): Promise<string | undefined> {
  if (process.env.HARNESS_CLAUDE_PATH) return process.env.HARNESS_CLAUDE_PATH;
  const found = Bun.which("claude", { PATH: await hostPath() });
  return found ? throughNpmShim(found) : undefined;
}

/**
 * `npm i -g @anthropic-ai/claude-code` on Windows puts `claude.cmd` (and `claude.ps1`) on PATH: shims
 * that call the real `claude.exe` in the package. The SDK starts the CLI as a process, which a `.cmd`
 * cannot be, so the binary behind the shim is used instead; anything else is returned as found.
 */
export function throughNpmShim(found: string, exists: (path: string) => boolean = existsSync): string {
  if (!/\.(cmd|ps1|bat)$/i.test(found)) return found;
  const binary = join(dirname(found), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  return exists(binary) ? binary : found;
}

/** The Claude Code release the bundled Agent SDK was built against. */
const EXPECTED_CLI_VERSION: string = sdkPackage.claudeCodeVersion;

/** The Claude CLI path from Settings wins over the one found on PATH. */
export async function resolveClaudeExecutable(): Promise<string | undefined> {
  return (await loadHostSettings()).claudeExecutablePath || (await detected());
}

const SIGNED_OUT =
  /not logged in|please run \/login|invalid api key|oauth token (has )?expired|oauth session expired|failed to authenticate|authentication_error|401 unauthorized/i;
const NOT_INSTALLED = /ENOENT|executable not found|spawn .*claude/i;

/** The Agent SDK's assistant errors that mean the account's sign-in is missing or expired. */
const SIGNED_OUT_ERRORS = new Set<string>(["authentication_failed"]);

/** Claude Code's own login (`claude auth login`), which opens the browser and saves the sign-in. */
export const CLAUDE_SIGN_IN_ARGS: readonly string[] = ["auth", "login"];

/** Said when a turn failed for want of a sign-in (docs/specs/claude-sign-in.md). */
export const CLAUDE_SIGNED_OUT = "Claude Code is not signed in on this host, or its sign-in expired. Sign in to Claude, then try again.";

/** Whether a Claude failure is a missing or expired sign-in: by the SDK's error kind, or by its text. */
export function isClaudeSignedOut(text: string, assistantError?: string | null): boolean {
  return (assistantError != null && SIGNED_OUT_ERRORS.has(assistantError)) || SIGNED_OUT.test(text);
}

/** A signed-out turn's notice: what to do, then Claude's own words. */
export function signedOutNotice(text: string): string {
  const said = text.trim();
  return said && said !== CLAUDE_SIGNED_OUT ? `${CLAUDE_SIGNED_OUT}\n${said}` : CLAUDE_SIGNED_OUT;
}

/** A Claude failure the person can fix, said as what to do; null for everything else. */
export function explainClaudeFailure(text: string): string | null {
  if (SIGNED_OUT.test(text)) return CLAUDE_SIGNED_OUT;
  if (NOT_INSTALLED.test(text)) return "Claude Code was not found on this host. Install it (npm i -g @anthropic-ai/claude-code), run `claude` once to sign in, then Retry.";
  return null;
}

async function runCli(path: string, args: string[], timeoutMs: number): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn([path, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timer));
  return { code, output: `${stdout}${stderr}`.trim() };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function claudeCliStatus(): Promise<ClaudeCliStatus> {
  const path = (await resolveClaudeExecutable()) ?? null;
  if (!path) return { path, version: null, expected: EXPECTED_CLI_VERSION, outdated: false };
  const version = await runCli(path, ["--version"], 15_000)
    .then(({ code, output }) => (code === 0 ? (/\d+\.\d+\.\d+/.exec(output)?.[0] ?? null) : null))
    .catch(() => null);
  const outdated = version !== null && compareVersions(version, EXPECTED_CLI_VERSION) < 0;
  return { path, version, expected: EXPECTED_CLI_VERSION, outdated };
}

/** Runs `claude update`; its output explains installs that cannot update themselves (system packages). */
export async function updateClaudeCli(): Promise<ClaudeCliUpdateResult> {
  const path = await resolveClaudeExecutable();
  if (!path) return { status: await claudeCliStatus(), ok: false, output: "No `claude` command was found on this host." };
  const { code, output } = await runCli(path, ["update"], 5 * 60_000).catch((error: Error) => ({ code: 1, output: error.message }));
  const status = await claudeCliStatus();
  return { status, ok: code === 0 && !status.outdated, output };
}

/** Claude Code's flag that turns on its built-in Claude in Chrome MCP server (needs the extension and Chrome running). */
export const CLAUDE_CHROME_ARGS: Record<string, string | null> = { chrome: null };
