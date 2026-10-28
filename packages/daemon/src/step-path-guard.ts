import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";

// Keeps a workflow step's Claude session away from data it is not linked to (and from changing data
// it may only read). Checked before every tool call, whatever the permission mode. A shell command is
// only caught when it names the path; agents other than Claude are not covered (they run their own
// tools), which is why local-only data belongs outside the project.

export interface PathGuard {
  /** As the workflow gives it: absolute, or relative to the session's folder. */
  path: string;
  name: string;
  /** none: may not touch it; read: may read but not change it. */
  allow: "none" | "read";
  /** Said instead of the workflow-step refusal (another chat's worktree). */
  reason?: string;
}

const FILE_TOOLS: Record<string, string[]> = {
  Read: ["file_path"],
  Write: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"],
  Glob: ["path"],
  Grep: ["path"],
  LS: ["path"],
};
const CHANGING = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** Tools that look through a whole folder: blocked when the folder holds a guarded path. */
const SEARCHING = new Set(["Glob", "Grep", "LS"]);

/** `~/x` as the home folder's x; anything else as given. */
export function expandHome(path: string): string {
  return /^~(?=$|[\\/])/.test(path) ? join(homedir(), path.slice(1)) : path;
}

function norm(path: string, cwd: string): string {
  const home = expandHome(path);
  const full = (isAbsolute(home) ? home : resolve(cwd, home)).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? full.toLowerCase() : full;
}

const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** Why the tool call is refused, or null when it may go ahead. */
export function guardedUse(guards: PathGuard[], tool: string, input: unknown, cwd: string): string | null {
  const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const guard of guards) {
    const root = norm(guard.path, cwd);
    const refuse =
      guard.reason ?? `Zomfy: this workflow step is not allowed to ${guard.allow === "read" ? "change" : "use"} "${guard.name}" (${guard.path}).`;
    // Any shell (Bash, PowerShell on Windows) takes a command line.
    if (typeof fields.command === "string" && !FILE_TOOLS[tool]) {
      if (guard.allow !== "none") continue;
      const command = fields.command.replace(/\\/g, "/");
      const text = process.platform === "win32" ? command.toLowerCase() : command;
      const plain = guard.path.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
      const given = process.platform === "win32" ? plain.toLowerCase() : plain;
      if (text.includes(root) || (!isAbsolute(guard.path) && given && text.includes(given))) return refuse;
      continue;
    }
    for (const key of FILE_TOOLS[tool] ?? []) {
      const raw = fields[key];
      const value = typeof raw === "string" ? raw : "";
      // A search without a path looks through the session's folder.
      if (!value && !SEARCHING.has(tool)) continue;
      const target = norm(value || ".", cwd);
      if (guard.allow === "read" && !CHANGING.has(tool)) continue;
      if (within(target, root)) return refuse;
      if (guard.allow === "none" && SEARCHING.has(tool) && within(root, target)) {
        return `${refuse} Search a folder that does not hold it.`;
      }
    }
  }
  return null;
}

/** `guards` may be a function: read on every call, so guards that change mid-turn (a claim) apply at once. */
export function pathGuardHooks(guards: PathGuard[] | (() => PathGuard[])): { PreToolUse: HookCallbackMatcher[] } {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PreToolUse") return {};
            const reason = guardedUse(typeof guards === "function" ? guards() : guards, input.tool_name, input.tool_input, input.cwd);
            return reason
              ? { hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason: reason } }
              : {};
          },
        ],
      },
    ],
  };
}
