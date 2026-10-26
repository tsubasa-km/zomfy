import type { ClaudeCliStatus, ClaudeCliUpdateResult } from "@acp-harness/protocol";
// The SDK's exports map hides its package.json; Bun inlines this at build time.
import sdkPackage from "../node_modules/@anthropic-ai/claude-agent-sdk/package.json" with { type: "json" };
import { loadHostSettings } from "./host-settings.ts";
import { hostPath } from "./tui-agent-detection.ts";

// Why: the user's installed CLI carries their login and settings; the SDK's bundled copy would not.
// Found on the host's full PATH (saved and login-shell entries), like every other agent.
async function detected(): Promise<string | undefined> {
  return process.env.HARNESS_CLAUDE_PATH ?? Bun.which("claude", { PATH: await hostPath() }) ?? undefined;
}

/** The Claude Code release the bundled Agent SDK was built against. */
const EXPECTED_CLI_VERSION: string = sdkPackage.claudeCodeVersion;

/** The Claude CLI path from Settings wins over the one found on PATH. */
export async function resolveClaudeExecutable(): Promise<string | undefined> {
  return (await loadHostSettings()).claudeExecutablePath || (await detected());
}

const SIGNED_OUT = /not logged in|please run \/login|invalid api key|oauth token (has )?expired|authentication_error|401 unauthorized/i;
const NOT_INSTALLED = /ENOENT|executable not found|spawn .*claude/i;

/** A Claude failure the person can fix, said as what to do; null for everything else. */
export function explainClaudeFailure(text: string): string | null {
  if (SIGNED_OUT.test(text)) return "Claude Code is not signed in on this host. Run `claude` in a terminal there and sign in, then Retry.";
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
