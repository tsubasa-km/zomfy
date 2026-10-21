import { loadHostSettings } from "./host-settings.ts";

// Why: the user's installed CLI carries their login and settings; the SDK's bundled copy would not.
const detected = process.env.HARNESS_CLAUDE_PATH ?? Bun.which("claude") ?? undefined;

/** The Claude CLI path from Settings wins over the one found on PATH. */
export async function resolveClaudeExecutable(): Promise<string | undefined> {
  return (await loadHostSettings()).claudeExecutablePath || detected;
}
