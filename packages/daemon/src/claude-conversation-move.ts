import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Claude Code files a conversation under its folder (`<config>/projects/<folder as a name>/<id>.jsonl`,
// plus `<id>/` for subagents and large tool results) and resumes only from there, so a chat that
// moves to another folder takes its files along.

const MAX_NAME = 200;

function projectName(cwd: string): string {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  // Longer names get a hash suffix whose recipe the CLI does not publish.
  if (name.length > MAX_NAME) throw new Error(`The folder path is too long to move a conversation into: ${cwd}`);
  return name;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** The folder holding the conversation's file: its cwd's, else wherever it turns up. */
async function sourceDir(projects: string, claudeSessionId: string, cwd: string): Promise<string | null> {
  const expected = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  if (await exists(join(expected, `${claudeSessionId}.jsonl`))) return expected;
  for (const name of await readdir(projects).catch(() => [])) {
    if (await exists(join(projects, name, `${claudeSessionId}.jsonl`))) return join(projects, name);
  }
  return null;
}

/** Moves Claude's files for one conversation from `fromCwd` to `toCwd`; a no-op before its first turn. */
export async function moveClaudeConversation(
  claudeSessionId: string,
  fromCwd: string,
  toCwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const projects = join(env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  const target = join(projects, projectName(toCwd));
  const source = await sourceDir(projects, claudeSessionId, fromCwd);
  if (!source || source === target) return;
  await mkdir(target, { recursive: true });
  await cp(join(source, `${claudeSessionId}.jsonl`), join(target, `${claudeSessionId}.jsonl`));
  if (await exists(join(source, claudeSessionId))) {
    await cp(join(source, claudeSessionId), join(target, claudeSessionId), { recursive: true });
  }
  // Removed only once both copies landed, so a failure leaves the conversation where it was.
  await rm(join(source, `${claudeSessionId}.jsonl`), { force: true });
  await rm(join(source, claudeSessionId), { recursive: true, force: true });
}
