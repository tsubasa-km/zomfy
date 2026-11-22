import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HARNESS_HOME } from "./harness-home.ts";

/**
 * Which chats have background tasks running in their Claude process. Those processes die with the
 * daemon, so the next daemon tells each chat that its tasks were stopped (background-task-wake.md).
 */
export class BackgroundTaskMarks {
  private marks: Record<string, string[]>;

  constructor(private readonly path: string = join(HARNESS_HOME, "background-tasks.json")) {
    this.marks = read(path);
  }

  /** The chat's live tasks now; an empty list clears its mark. */
  set(sessionId: string, tasks: string[]): void {
    const before = JSON.stringify(this.marks[sessionId] ?? []);
    if (tasks.length > 0) this.marks[sessionId] = tasks;
    else delete this.marks[sessionId];
    if (JSON.stringify(tasks) !== before) this.save();
  }

  /** The marks a previous daemon left, cleared as they are taken. */
  takeAll(): [sessionId: string, tasks: string[]][] {
    const taken = Object.entries(this.marks);
    if (taken.length === 0) return [];
    this.marks = {};
    this.save();
    return taken;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const temp = `${this.path}.tmp`;
      writeFileSync(temp, JSON.stringify(this.marks));
      renameSync(temp, this.path);
    } catch {
      // A lost mark only loses the notice after a restart.
    }
  }
}

function read(path: string): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const marks: Record<string, string[]> = {};
    for (const [id, tasks] of Object.entries(parsed)) {
      if (Array.isArray(tasks)) marks[id] = tasks.filter((t): t is string => typeof t === "string");
    }
    return marks;
  } catch {
    return {};
  }
}
