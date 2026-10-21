import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatCatalog, ChatEffort } from "@acp-harness/protocol";
import { claudeExecutable } from "./claude-turn.ts";
import { log } from "./log.ts";

const PROBE_TIMEOUT_MS = 30_000;
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

/** A turn's init frame names commands added since the probe (new skills, project commands). */
export function noteSlashCommands(cwd: string, names: string[]): void {
  const hit = cache.get(cwd);
  if (!hit) return;
  hit.catalog = hit.catalog.then((catalog) => {
    const known = new Set(catalog.commands.map((c) => c.name));
    const added = names
      .filter((name) => !known.has(name))
      .map((name) => ({ name, description: "", argumentHint: "" }));
    return added.length ? { ...catalog, commands: [...catalog.commands, ...added] } : catalog;
  });
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
      pathToClaudeCodeExecutable: claudeExecutable,
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
      })),
    };
  } finally {
    release();
    abort.abort();
    void drained;
  }
}
