import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatCatalog, ChatCommand, ChatCommandKind, ChatEffort } from "@zomfy/protocol";
import { resolveClaudeExecutable } from "./claude-executable.ts";
import { log } from "./log.ts";

const PROBE_TIMEOUT_MS = 30_000;
/** The skills list is a nicety: a CLI that does not answer it leaves every row a command. */
const SKILLS_TIMEOUT_MS = 10_000;
const FRESH_FOR_MS = 10 * 60_000;
const EFFORTS: readonly ChatEffort[] = ["low", "medium", "high", "xhigh", "max"];

const cache = new Map<string, { at: number; catalog: Promise<ChatCatalog> }>();

/** Claude's `/` menu and models for a folder; cached, since each probe starts a CLI. */
export function chatCatalog(cwd: string, refresh = false): Promise<ChatCatalog> {
  const hit = cache.get(cwd);
  if (hit && !refresh && Date.now() - hit.at < FRESH_FOR_MS) return hit.catalog;
  const catalog = probe(cwd);
  cache.set(cwd, { at: Date.now(), catalog });
  catalog.catch(() => cache.delete(cwd));
  return catalog;
}

/**
 * What a `/` row is. The SDK lists commands, skills and MCP prompts as one list with only `builtin`
 * set; `skills` is the session's skill names (`reloadSkills()`, or a turn's init frame).
 */
export function commandKind(command: Pick<ChatCommand, "name" | "builtin">, skills: ReadonlySet<string>): ChatCommandKind {
  // Claude Code's bundled skills (code-review, simplify) are `builtin` and skills both.
  if (skills.has(command.name)) return "skill";
  if (!command.builtin && /^mcp__.+__.+/.test(command.name)) return "mcp-prompt";
  return "command";
}

/** A turn's init frame names commands added since the probe (new skills, project commands), and the skills. */
export function noteSlashCommands(cwd: string, names: string[], skills: string[] = []): void {
  const hit = cache.get(cwd);
  if (!hit) return;
  hit.catalog = hit.catalog.then((catalog) => withSlashCommands(catalog, names, skills));
}

/** The catalog with an init frame's commands added and its skills marked. */
export function withSlashCommands(catalog: ChatCatalog, names: string[], skills: string[]): ChatCatalog {
  const skillSet = new Set(skills);
  const known = new Set(catalog.commands.map((c) => c.name));
  const added: ChatCommand[] = names
    .filter((name) => !known.has(name))
    .map((name) => ({ name, description: "", argumentHint: "", kind: commandKind({ name }, skillSet) }));
  // A row the probe took for a command may be a skill the init frame names.
  const marked = catalog.commands.map((c) =>
    c.kind !== "skill" && skillSet.has(c.name) ? { ...c, kind: "skill" as const } : c,
  );
  if (added.length === 0 && marked.every((c, i) => c === catalog.commands[i])) return catalog;
  return { ...catalog, commands: [...marked, ...added] };
}

/** The probe's skill names; empty when the CLI cannot say in time. */
async function skillNames(session: { reloadSkills(): Promise<{ skills: { name: string }[] }> }): Promise<Set<string>> {
  try {
    const answer = await Promise.race([
      session.reloadSkills(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no answer in time")), SKILLS_TIMEOUT_MS)),
    ]);
    return new Set(answer.skills.map((s) => s.name));
  } catch (error) {
    log(`[claude catalog] skills: ${String(error)}`);
    return new Set();
  }
}

// Why: `initialize` answers the session's `/` surface and models with no API turn (Orca's probe).
async function probe(cwd: string): Promise<ChatCatalog> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  async function* noPrompt(): AsyncGenerator<SDKUserMessage> {
    await released;
  }
  const abort = new AbortController();
  const session = query({
    prompt: noPrompt(),
    options: {
      cwd,
      pathToClaudeCodeExecutable: await resolveClaudeExecutable(),
      settingSources: ["user", "project", "local"],
      abortController: abort,
      // Hooks and MCP servers would only slow the answer.
      strictMcpConfig: true,
      settings: { disableAllHooks: true },
      stderr: (line) => log(`[claude catalog] ${line}`),
    },
  });
  // Nothing is read from the stream, but its pump has to run for control answers to arrive.
  const drained = (async () => {
    try {
      for await (const _ of session) {
        // Probe sessions emit nothing worth keeping.
      }
    } catch {
      // Aborted below.
    }
  })();
  try {
    const init = await Promise.race([
      session.initializationResult(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Claude did not answer in time")), PROBE_TIMEOUT_MS),
      ),
    ]);
    // The SDK marks no row as a skill; the skills list it answers separately says which are.
    const skills = await skillNames(session);
    return {
      models: init.models.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
        efforts: m.supportsEffort ? (m.supportedEffortLevels ?? [...EFFORTS]) : [],
        ...(m.supportsAutoMode ? { supportsAutoMode: true } : {}),
      })),
      commands: init.commands.map((c) => ({
        name: c.name,
        description: c.description,
        argumentHint: c.argumentHint,
        ...(c.builtin ? { builtin: true } : {}),
        kind: commandKind(c, skills),
      })),
    };
  } finally {
    release();
    abort.abort();
    void drained;
  }
}
