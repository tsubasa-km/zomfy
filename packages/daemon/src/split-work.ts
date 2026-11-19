import type { Project, Workspace } from "@acp-harness/protocol";
import { git, GitError } from "./git-cli.ts";
import { sanitizeWorkspaceName } from "./worktree-naming.ts";

// split_work: one chat splits a large task into parts that run at the same time, each by a helper
// agent in a worktree of its own branched from the chat's last commit, and the harness merges the
// finished parts back into the chat's branch one at a time, in the order the chat gave. The person
// keeps talking to one chat; the worktrees, helpers and merges are the harness's business.
//
// What keeps it from turning into a pile of conflicts or broken code: every part names the files it
// owns and parts may not overlap; every part starts from the same committed state; only a part
// whose helper finished its turn is merged; a merge that does not go through is aborted, so nothing
// half-merged is left behind, and that part's worktree is kept for the chat to bring in by hand.
// Helpers cannot split again.

export const MIN_PARTS = 2;
export const MAX_PARTS = 6;
/** Helpers one split runs at once. */
export const PARTS_AT_ONCE = 3;
/** Helpers every split on this daemon runs at once, so several chats splitting cannot pile up. */
export const HELPERS_AT_ONCE = 4;

/** At most `max` jobs at once; the rest wait their turn, first come first served. */
export class Gate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    // A finished job hands its slot straight to the next in line, so no newcomer slips in between.
    if (this.running >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.running++;
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

export interface SplitPart {
  title: string;
  task: string;
  owns: string[];
}

export interface SplitRequest {
  goal: string | null;
  parts: SplitPart[];
}

export interface HelperReport {
  text: string;
  /** The helper ended its turn on its own; false when it was stopped, failed or ran out of turns or usage. */
  finished: boolean;
  /** Why it did not finish, for the report. */
  why?: string;
}

export interface SplitDeps {
  requireWorkspace(workspaceId: string): { workspace: Workspace; project: Project };
  /** A new worktree of `project` on a new branch from `base`, named after `name`. */
  createWorktree(parent: Workspace, project: Project, name: string, base: string): Promise<Workspace>;
  /** Readies a new worktree (the project's setup script); a note when that went wrong, else null. */
  prepare(project: Project, workspace: Workspace): Promise<string | null>;
  /** Runs one helper turn in `workspace` and returns what it reported. */
  runHelper(workspace: Workspace, part: SplitPart, prompt: string): Promise<HelperReport>;
  /** Removes a worktree whose work is merged (or that has none), with its branch. */
  removeWorktree(workspace: Workspace, project: Project): Promise<void>;
  /** True once the split was stopped: no new helper starts and nothing more is merged. */
  stopped(): boolean;
  /** Resolves when the parts may be merged into the chat's folder, which stays untouched until afterMerge. */
  beforeMerge?(): Promise<void>;
  /** The merges are done: the chat's folder is the chat's again. */
  afterMerge?(): void;
  /** A line for the person as each part ends. */
  progress?(text: string): void;
  /** A part's helper is starting. */
  partStarted?(part: SplitPart): void;
  /** How a part ended, for what a restart has to tell the chat. */
  partEnded?(part: SplitPart, workspace: Workspace | null, status: string): void;
  partsAtOnce?: number;
}

/** "ready": the helper finished and its work is committed, waiting for its turn to be merged. */
type Status = "ready" | "merged" | "no-changes" | "unfinished" | "conflict" | "failed" | "stopped";

interface Outcome {
  part: SplitPart;
  status: Status;
  report: string;
  workspace: Workspace | null;
  commits: number;
  files: string[];
  conflicts: string[];
  notes: string[];
}

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "cargo.lock",
  "uv.lock",
  "poetry.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
]);

/** The tool's arguments, checked; throws with what to fix. */
export function readSplitRequest(args: Record<string, unknown>): SplitRequest {
  const raw = Array.isArray(args.parts) ? args.parts : [];
  const parts = raw.map((entry: unknown, i): SplitPart => {
    const e = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const task = typeof e.task === "string" ? e.task.trim() : "";
    const title = typeof e.title === "string" && e.title.trim() ? e.title.trim() : `part ${i + 1}`;
    const listed = (Array.isArray(e.owns) ? e.owns : []).filter((p: unknown): p is string => typeof p === "string");
    const unusable = listed.filter((p) => normalizeOwned(p) === null);
    if (unusable.length > 0) {
      throw new Error(`Part ${i + 1} (${title}) owns paths that cannot be used: ${unusable.join(", ")}. Give literal paths relative to the repository root (no patterns, no "..", not the whole repository).`);
    }
    const owns = listed.map((p) => normalizeOwned(p)!);
    if (!task) throw new Error(`Part ${i + 1} (${title}) has no task.`);
    if (owns.length === 0) {
      throw new Error(`Part ${i + 1} (${title}) names no files or folders it owns, as literal paths relative to the repository root; give each part its own.`);
    }
    return { title, task, owns: [...new Set(owns)] };
  });
  if (parts.length < MIN_PARTS) throw new Error(`Give at least ${MIN_PARTS} parts; for one, do the work yourself.`);
  if (parts.length > MAX_PARTS) throw new Error(`Give at most ${MAX_PARTS} parts; merge smaller ones or do some yourself afterwards.`);
  const clash = ownershipClashes(parts);
  if (clash.length > 0) {
    throw new Error(
      `Parts may not own the same files, or they would conflict when merged:\n${clash.map((c) => `- ${c}`).join("\n")}\nGive each file to one part, or do the shared change yourself and commit it before splitting.`,
    );
  }
  const goal = typeof args.goal === "string" && args.goal.trim() ? args.goal.trim() : null;
  return { goal, parts };
}

/** `./src/a/` → `src/a`; the whole repository (`.`, empty), a path leaving it or an absolute one → null. */
export function normalizeOwned(path: string): string | null {
  const trimmed = path.trim();
  // Owned paths are relative to the repository; an absolute one would never match git's paths.
  if (/^([a-zA-Z]:)?[\\/]/.test(trimmed)) return null;
  const parts = trimmed
    .replaceAll("\\", "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  // Literal paths only (`app/[id]/page.tsx` is one): a wildcard would match differently here and in git.
  if (parts.length === 0 || parts.includes("..") || /[*?]/.test(trimmed)) return null;
  return parts.join("/");
}

/**
 * `a` contains `b` (the same path, or a folder above it). Case is ignored: on Windows and macOS
 * `src/A.ts` and `src/a.ts` are one file, and elsewhere treating them as one only errs on the safe side.
 */
function covers(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || y.startsWith(`${x}/`);
}

export function ownershipClashes(parts: SplitPart[]): string[] {
  const clashes: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      for (const a of parts[i]!.owns) {
        for (const b of parts[j]!.owns) {
          if (covers(a, b) || covers(b, a)) clashes.push(`"${parts[i]!.title}" (${a}) and "${parts[j]!.title}" (${b})`);
        }
      }
    }
  }
  return clashes;
}

/** Changed files outside what the part owns. */
export function outsideOwned(files: string[], owns: string[]): string[] {
  return files.filter((f) => !owns.some((o) => covers(o, f)));
}

/** One worktree name per part, `<chat's>-<title>`, numbered where titles repeat. */
export function partNames(parentName: string, parts: SplitPart[]): string[] {
  const slugs = parts.map((p) => sanitizeWorkspaceName(p.title).toLowerCase().slice(0, 40));
  return slugs.map((slug, i) => {
    const repeated = slugs.filter((s) => s === slug).length > 1;
    return `${parentName}-${slug}${repeated ? `-${slugs.slice(0, i + 1).filter((s) => s === slug).length}` : ""}`;
  });
}

export function helperPrompt(request: SplitRequest, part: SplitPart, branch: string): string {
  const others = request.parts.filter((p) => p !== part);
  const ownsLockfile = part.owns.some((o) => LOCKFILES.has(o.split("/").at(-1)!.toLowerCase()));
  return [
    "You are a helper agent on one part of a larger task. Zomfy split the task between helpers that work at the same time, each in a git worktree of its own; the chat that split it merges every part back when all are done.",
    ...(request.goal ? ["", "The whole task, for context:", request.goal] : []),
    "",
    `Your part: ${part.title}`,
    part.task,
    "",
    "Files and folders you own; change only these:",
    ...part.owns.map((o) => `- ${o}`),
    ...(others.length > 0 ? ["", "Owned by the other parts; do not change them:", ...others.flatMap((p) => p.owns.map((o) => `- ${o} (${p.title})`))] : []),
    ...(ownsLockfile ? [] : ["", "Do not add dependencies or change lockfiles; if your part needs one, say so in your report instead."]),
    "",
    `You are on branch ${branch}. When the part is done, check it (build, tests or whatever fits). Do not commit: Zomfy commits the files you own once you finish. Do not merge, rebase, push or switch branches, and do not use harness tools that change other worktrees.`,
    "End with your result: done is true only when the part is complete and you checked it; say what you changed, how you checked it, and anything left open. A part that is not done is kept for the chat that split the work, not merged.",
  ].join("\n");
}

/** Uncommitted changes; with `trackedOnly`, new untracked files (a stray log, say) do not count. */
async function dirty(path: string, trackedOnly = false): Promise<boolean> {
  return (await git(path, ["status", "--porcelain", ...(trackedOnly ? ["--untracked-files=no"] : [])])).trim().length > 0;
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function errorText(error: unknown): string {
  if (error instanceof GitError) return error.stderr.trim() || error.message;
  return error instanceof Error ? error.message : String(error);
}

/** At most `max` jobs at once, started in order. */
async function inSlots<T, R>(items: T[], max: number, job: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await job(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, worker));
  return results;
}

/** A checked request, ready to run: where the parts branch from and merge back into. */
export interface SplitPlan {
  request: SplitRequest;
  parent: Workspace;
  project: Project;
  /** The commit every part branches from. */
  start: string;
  /** New files in the chat's folder git does not track: the parts start without them. */
  untracked: string[];
}

/** Everything that can be refused before a helper starts; throws with what to do instead. */
export async function planSplit(
  deps: Pick<SplitDeps, "requireWorkspace">,
  workspaceId: string | null,
  args: Record<string, unknown>,
): Promise<SplitPlan> {
  const request = readSplitRequest(args);
  if (!workspaceId) throw new Error("This chat has no project folder to split work in.");
  const { workspace: parent, project } = deps.requireWorkspace(workspaceId);
  if (project.kind !== "git") throw new Error("split_work needs a git project: each part gets a worktree of its own.");
  if (!parent.branch) throw new Error("Your folder is not on a branch (detached HEAD), so the parts have nothing to merge into.");
  if (await dirty(parent.path, true)) {
    throw new Error("Your folder has uncommitted changes. Commit what the parts should build on first; helpers start from your last commit.");
  }
  // New files the chat has not committed stay out of the parts' worktrees: said, so groundwork is
  // not forgotten, but never a reason to delete anything.
  const untracked = lines(await git(parent.path, ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"]));
  const current = (await git(parent.path, ["branch", "--show-current"])).trim();
  if (current !== parent.branch) throw new Error(`Your folder is on ${current || "a detached HEAD"}, not ${parent.branch}; switch back before splitting.`);
  const start = (await git(parent.path, ["rev-parse", "HEAD"])).trim();
  return { request, parent, project, start, untracked };
}

/** Plans and runs a split in one go (the tool itself runs the two apart). */
export async function splitWork(deps: SplitDeps, workspaceId: string | null, args: Record<string, unknown>): Promise<string> {
  return runSplit(deps, await planSplit(deps, workspaceId, args));
}

/** Runs every part, merges the finished ones, and returns the report the chat reads. */
export async function runSplit(deps: SplitDeps, plan: SplitPlan): Promise<string> {
  const { request, parent, project, start } = plan;
  const names = partNames(parent.name, request.parts);

  // Run every part, a few at a time.
  const outcomes = await inSlots(request.parts, deps.partsAtOnce ?? PARTS_AT_ONCE, async (part, i): Promise<Outcome> => {
    const outcome: Outcome = { part, status: "failed", report: "", workspace: null, commits: 0, files: [], conflicts: [], notes: [] };
    const stopped = (): Outcome => {
      outcome.status = "stopped";
      outcome.report ||= "Not started: the split was stopped.";
      return outcome;
    };
    if (deps.stopped()) return stopped();
    try {
      // From the commit the split started at, whatever the chat committed since.
      const workspace = await deps.createWorktree(parent, project, names[i]!, start);
      outcome.workspace = workspace;
      const setupNote = await deps.prepare(project, workspace);
      if (setupNote) outcome.notes.push(setupNote);
      const setupTouched = await trackedFileHashes(workspace.path);
      const setupAdded = new Set(lines(await git(workspace.path, ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"])));
      if (deps.stopped()) return stopped();
      deps.partStarted?.(part);
      const helper = await deps.runHelper(workspace, part, helperPrompt(request, part, workspace.branch ?? workspace.name));
      outcome.report = helper.text.trim();
      if (deps.stopped()) return stopped();
      if (!helper.finished) {
        // Half-done work never lands on the chat's branch: it stays in the worktree, as the helper left it.
        outcome.status = "unfinished";
        outcome.notes.push(`Its helper did not finish${helper.why ? ` (${helper.why})` : ""}; what it did is left as it was in its worktree.`);
        return outcome;
      }
      outcome.status = "ready";
      if (await dirty(workspace.path)) await commitLeftovers(workspace.path, part, outcome, setupTouched, setupAdded);
    } catch (error) {
      outcome.status = "failed";
      outcome.notes.push(`Failed: ${errorText(error)}`);
    } finally {
      deps.progress?.(`${part.title}: ${outcome.status === "ready" ? "done" : outcome.status}`);
      deps.partEnded?.(part, outcome.workspace, outcome.status);
    }
    return outcome;
  });

  // The chat may have taken more turns while the parts ran: merge only while it is held idle, into
  // the branch it split from, and never over work it has not committed.
  const finished = outcomes.filter((o) => o.status === "ready");
  if (finished.length > 0 && !deps.stopped()) {
    await deps.beforeMerge?.();
    try {
      const blocked = deps.stopped() ? null : await mergeBlocker(parent, start);
      if (blocked) for (const o of finished) o.notes.push(`Not merged: ${blocked}`);
      // One at a time and in the given order, so each part merges onto everything before it.
      else for (const outcome of finished) await mergePart(deps, parent, start, outcome);
    } finally {
      deps.afterMerge?.();
    }
  }
  for (const o of outcomes) {
    if (o.status !== "ready" || !deps.stopped()) continue;
    o.status = "stopped";
    o.notes.push(`Its helper had finished before the stop: run git merge ${o.workspace?.branch ?? "<branch>"} in your folder to bring it in.`);
  }

  // Worktrees go once the merges are done: merged ones, and kept ones with nothing in them (stopped
  // or failed before the helper did anything). A failure to remove one is only a note.
  for (const outcome of outcomes) {
    const workspace = outcome.workspace;
    if (!workspace) continue;
    const done = outcome.status === "merged" || outcome.status === "no-changes";
    if (!done && !(await empty(workspace, start))) continue;
    try {
      await deps.removeWorktree(workspace, project);
      if (!done) {
        outcome.notes.push("Its worktree had nothing in it and was removed.");
        outcome.workspace = null;
      }
    } catch (error) {
      outcome.notes.push(`Its worktree could not be removed: ${errorText(error)}`);
    }
  }

  return splitReport(parent, start, outcomes);
}

async function mergePart(deps: SplitDeps, parent: Workspace, start: string, outcome: Outcome): Promise<void> {
  const branch = outcome.workspace!.branch!;
  if (deps.stopped()) return;
  try {
    outcome.commits = Number((await git(parent.path, ["rev-list", "--count", `HEAD..${branch}`])).trim());
    if (outcome.commits === 0) {
      outcome.status = "no-changes";
      return;
    }
    // --no-renames: a move lists both paths, so moving a file the part does not own is seen too.
    outcome.files = lines(await git(parent.path, ["-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", `${start}...${branch}`]));
    // Ownership is what keeps parts from colliding: a part that reached past its files is kept for
    // the chat to look at, not merged.
    const stray = outsideOwned(outcome.files, outcome.part.owns);
    if (stray.length > 0) {
      outcome.status = "failed";
      outcome.notes.push(`Not merged: it changed files it does not own (${stray.join(", ")}). Bring in what belongs to it by hand.`);
      return;
    }
    await git(parent.path, ["merge", "--no-ff", "--no-edit", "-m", `Merge part "${outcome.part.title}" (split_work)`, branch], {
      timeoutMs: 120_000,
      quiet: true,
    });
    outcome.status = "merged";
  } catch (error) {
    const merging = await git(parent.path, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { quiet: true }).then(
      () => true,
      () => false,
    );
    outcome.conflicts = merging ? lines(await git(parent.path, ["-c", "core.quotePath=false", "diff", "--name-only", "--diff-filter=U"]).catch(() => "")) : [];
    if (merging) await git(parent.path, ["merge", "--abort"], { quiet: true }).catch(() => undefined);
    if (outcome.conflicts.length > 0) outcome.status = "conflict";
    else {
      // Refused for another reason (a hook, files in the way): said as it is, not as a conflict.
      outcome.status = "failed";
      outcome.notes.push(`Not merged: ${errorText(error)}`);
    }
  }
}

/** A part's worktree holds no work: nothing committed beyond `start` and nothing uncommitted. */
async function empty(workspace: Workspace, start: string): Promise<boolean> {
  try {
    const ahead = Number((await git(workspace.path, ["rev-list", "--count", `${start}..HEAD`])).trim());
    return ahead === 0 && !(await dirty(workspace.path));
  } catch {
    return false;
  }
}

/**
 * Commits a finished part's work in the files it owns, with the project's hooks (helpers do not
 * commit, so they need not ask to); anything else it left (build output, scratch files) stays
 * uncommitted and out of the merge.
 */
async function commitLeftovers(
  path: string,
  part: SplitPart,
  outcome: Outcome,
  setupTouched: Map<string, string>,
  setupAdded: Set<string>,
): Promise<void> {
  // Tracked files the setup script changed (a lockfile it rewrote, say) and the helper left as they
  // were are the setup's doing, not the part's: put back, so they neither land nor keep the part out.
  const restored: string[] = [];
  for (const [file, hash] of setupTouched) {
    if (part.owns.some((o) => covers(o, file))) continue;
    if ((await hashOf(path, file)) !== hash) continue;
    await git(path, ["checkout", "HEAD", "--", file], { quiet: true }).then(() => restored.push(file), () => undefined);
  }
  if (restored.length > 0) outcome.notes.push(`Changes the setup script made to ${restored.join(", ")} were put back.`);
  // Whatever the helper staged itself is unstaged first: only the owned paths go into the commit.
  await git(path, ["reset", "-q"]);
  // One path at a time: a path the helper never created matches nothing, which is not an error here.
  for (const owned of part.owns) await git(path, ["add", "-A", "--", `:(icase,literal)${owned}`], { quiet: true }).catch(() => undefined);
  const staged = (await git(path, ["diff", "--cached", "--name-only"])).trim();
  if (staged) await git(path, ["commit", "-m", `${part.title} (split_work part)`], { timeoutMs: 120_000 });
  // Tracked files changed elsewhere (a line added to a shared index, say) are part of the work:
  // merging without them would land it half wired, so the part is kept instead.
  const changed = lines(await git(path, ["-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", "HEAD"]));
  if (changed.length > 0) {
    outcome.status = "failed";
    outcome.notes.push(`Not merged: it also changed files it does not own (${changed.join(", ")}). Bring in what belongs to it by hand.`);
    return;
  }
  // New files outside its own count the same: the part may need them (a module it imports, a file
  // it moved), so merging without them could land it half wired.
  // Those the setup script made before the helper started are the setup's, not the part's.
  const added = lines(await git(path, ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"])).filter((f) => !setupAdded.has(f));
  if (added.length > 0) {
    outcome.status = "failed";
    outcome.notes.push(`Not merged: it also made new files outside its own (${added.join(", ")}). Bring in what belongs to it by hand.`);
  }
}

/** Why nothing can be merged into the chat's folder now, or null when it can. */
async function mergeBlocker(parent: Workspace, start: string): Promise<string | null> {
  const branch = (await git(parent.path, ["branch", "--show-current"]).catch(() => "")).trim();
  if (branch !== parent.branch) return `your folder is no longer on ${parent.branch}${branch ? ` (it is on ${branch})` : ""}.`;
  // The parts carry the split's start commit: merged into a branch rewritten past it (a reset, an
  // amend, a rebase), they would quietly bring back what the chat took out.
  const kept = await git(parent.path, ["merge-base", "--is-ancestor", start, "HEAD"], { quiet: true }).then(() => true, () => false);
  if (!kept) return `your branch no longer contains the commit the parts started from (${start.slice(0, 8)}); its history was rewritten, so merging them could bring back what was removed.`;
  // Untracked files do not block a merge; git itself refuses one that would overwrite them.
  if (await dirty(parent.path, true)) return "your folder has uncommitted changes; commit them, then merge the parts' branches.";
  return null;
}

const HEADINGS: Record<Status, string> = {
  ready: "finished, not merged",
  merged: "merged",
  "no-changes": "no changes",
  unfinished: "unfinished, not merged",
  conflict: "conflicts, not merged",
  failed: "failed, not merged",
  stopped: "stopped, not merged",
};

function splitReport(parent: Workspace, start: string, outcomes: Outcome[]): string {
  const merged = outcomes.filter((o) => o.status === "merged").length;
  const kept = outcomes.filter((o) => o.status !== "merged" && o.status !== "no-changes" && o.workspace);
  const out: string[] = [
    `Split into ${outcomes.length} parts from ${start.slice(0, 8)} on ${parent.branch}; ${merged} merged into your branch.`,
  ];
  outcomes.forEach((o, i) => {
    out.push("", `## ${i + 1}. ${o.part.title}: ${HEADINGS[o.status]}`);
    if (o.status === "merged") out.push(`${o.commits} commit${o.commits === 1 ? "" : "s"}, ${o.files.length} file${o.files.length === 1 ? "" : "s"}.`);
    if (o.status === "conflict") {
      out.push(`It conflicts with your branch (a part merged before it, or your own commits) in ${o.conflicts.join(", ")}; the merge was aborted, so your folder is as it was.`);
    }
    if (o.workspace && o.status !== "merged" && o.status !== "no-changes") {
      out.push(`Its work is kept on branch ${o.workspace.branch ?? "?"} in ${o.workspace.path} (workspace id ${o.workspace.id}).`);
    }
    out.push(...o.notes);
    if (o.report) out.push("", o.report);
  });
  out.push("");
  if (kept.length > 0) {
    out.push(
      "Next: bring in what was not merged. For a finished part, run git merge <branch> in your folder, resolve any conflicts and commit; for an unfinished one, finish it in its worktree or redo it yourself. Once a kept part is in your branch, call manage_split with action 'tidy' to remove its worktree. Then verify the combined result (build, tests): each part was checked on its own, not together.",
    );
  } else if (merged > 0) {
    out.push("Next: verify the combined result in your folder (build, tests): each part was checked on its own, not together.");
  }
  return out.join("\n");
}

/** Appended to a project chat's instructions so it splits work itself instead of the person juggling chats. */
export function splitWorkHint(toolName: string): string {
  return [
    `Zomfy: you can run parts of a large task at the same time with the harness tool ${toolName}.`,
    "Use it when the request has two or more substantial parts that each stand on their own and change different files, for example separate features, modules or pages. Keep each part's tests with it, so its helper can check its own work. Do any groundwork the parts share (types, schemas, interfaces) yourself and commit it first; a part that needs another part's result is not a separate part.",
    "The person approves the split once. It returns at once: end your turn with one short line telling the person the work is under way. When every part is done, Zomfy merges them into your branch in the order you gave and starts your next turn with the report; then verify the combined result and tell the person what was done.",
    "Do small or tightly coupled changes yourself; do not split them. The person should not have to manage worktrees, branches or other chats: you do it for them, and tell them in plain words what happened.",
  ].join("\n");
}

/** What the chat's next turn hears while parts it split off are still running. */
export function runningSplitNote(titles: string[], owns: string[]): string {
  return `Parts you split off are still running in worktrees of their own (${titles.join(", ")}). Leave their files alone (${owns.join(", ")}), do not call finish_worktree, do not reset, amend or rebase your branch, and end each turn with nothing uncommitted, or they cannot be merged; their report starts your next turn. If the person wants them stopped, call manage_split with action "stop".`;
}

/** How the report begins, so a turn can tell whether it is still waiting to be read. */
export const SPLIT_REPORT_HEADING = "[split_work] Every part you split off has finished. Report:";

/** How the report ends: with it, the whole report can be cut out of the chat's saved context. */
const SPLIT_REPORT_CLOSING =
  "Now check the combined result in your folder (build, tests), fix what the merge broke, commit, and tell the person in plain words what was done and anything they need to decide.";

/** What the chat's next turn reads once its parts are done. */
export function splitDonePrompt(report: string): string {
  return [SPLIT_REPORT_HEADING, "", report, "", SPLIT_REPORT_CLOSING].join("\n");
}

/** The report in `text` (saved context, say), whole and nothing else, or null. */
export function reportIn(text: string | null | undefined): string | null {
  const at = text?.indexOf(SPLIT_REPORT_HEADING) ?? -1;
  if (!text || at < 0) return null;
  const end = text.indexOf(SPLIT_REPORT_CLOSING, at);
  return end < 0 ? text.slice(at) : text.slice(at, end + SPLIT_REPORT_CLOSING.length);
}

/** What a split_work helper ends its turn with (Claude's structured result). */
export const HELPER_RESULT_SCHEMA = {
  type: "object",
  properties: {
    done: { type: "boolean", description: "True only when the part is complete and you checked it." },
    summary: { type: "string", description: "What you changed, how you checked it, and anything left open." },
  },
  required: ["done", "summary"],
  additionalProperties: false,
};

/** A helper's structured result, or null when it gave none. */
export function helperResult(structured: unknown): { done: boolean; summary: string } | null {
  if (typeof structured !== "object" || structured === null) return null;
  const { done, summary } = structured as Record<string, unknown>;
  return typeof done === "boolean" ? { done, summary: typeof summary === "string" ? summary.trim() : "" } : null;
}

/** Tracked files with changes in `path`, each with the hash of its content now. */
async function trackedFileHashes(path: string): Promise<Map<string, string>> {
  const files = lines(await git(path, ["-c", "core.quotePath=false", "diff", "--name-only", "HEAD"]).catch(() => ""));
  const hashes = new Map<string, string>();
  for (const file of files) {
    const hash = await hashOf(path, file);
    if (hash) hashes.set(file, hash);
  }
  return hashes;
}

async function hashOf(path: string, file: string): Promise<string | null> {
  return git(path, ["hash-object", "--", file], { quiet: true }).then((h) => h.trim(), () => null);
}
