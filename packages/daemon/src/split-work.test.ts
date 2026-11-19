import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace } from "@acp-harness/protocol";
import { git } from "./git-cli.ts";
import { Gate, helperPrompt, ownershipClashes, partNames, planSplit, readSplitRequest, splitWork, type HelperReport, type SplitDeps, type SplitPart } from "./split-work.ts";

let root: string;
/** The repository's own checkout. */
let repo: string;
/** The chat's worktree, which splits branch from and merge into (a chat never splits in the main checkout). */
let main: string;
let created: Workspace[];
let removed: string[];

const project = (): Project => ({ id: "p", name: "repo", path: repo, kind: "git" });
const primary = (): Workspace => ({ id: "main", projectId: "p", name: "repo", path: main, branch: "me/chat", isPrimary: false, createdAt: 0 });

async function commit(cwd: string, file: string, text: string, message = `edit ${file}`): Promise<void> {
  await writeFile(join(cwd, file), text);
  await git(cwd, ["add", file]);
  await git(cwd, ["commit", "-m", message]);
}

/** Helpers that each do what `work` says in their own worktree. */
function deps(work: (part: SplitPart, cwd: string) => Promise<void | HelperReport>, extra: Partial<SplitDeps> = {}): SplitDeps {
  return {
    requireWorkspace: (id) => ({ workspace: id === "main" ? primary() : created.find((w) => w.id === id)!, project: project() }),
    createWorktree: async (_parent, _project, name, base) => {
      const path = join(root, name);
      await git(repo, ["worktree", "add", "-b", `me/${name}`, path, base]);
      const workspace: Workspace = { id: name, projectId: "p", name, path, branch: `me/${name}`, isPrimary: false, createdAt: 0 };
      created.push(workspace);
      return workspace;
    },
    prepare: async () => null,
    runHelper: async (workspace, part) => {
      const report = await work(part, workspace.path);
      return report ?? { text: `did ${part.title}`, finished: true };
    },
    removeWorktree: async (workspace) => {
      await git(repo, ["worktree", "remove", workspace.path]);
      // Merged into the chat's branch, not the checkout's: -d is checked from the chat's worktree.
      await git(main, ["branch", "-d", workspace.branch!]);
      removed.push(workspace.id);
    },
    stopped: () => false,
    ...extra,
  };
}

const twoParts = {
  goal: "Add a greeting and a farewell.",
  parts: [
    { title: "Greeting", task: "Write hello.txt", owns: ["hello.txt"] },
    { title: "Farewell", task: "Write bye.txt", owns: ["bye.txt"] },
  ],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "split-"));
  repo = join(root, "repo");
  main = join(root, "chat");
  created = [];
  removed = [];
  await git(root, ["init", "-b", "main", repo]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) await git(repo, ["config", k!, v!]);
  await commit(repo, "a.txt", "one\n");
  await git(repo, ["worktree", "add", "-b", "me/chat", main]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readSplitRequest", () => {
  test("takes parts with their own files", () => {
    const request = readSplitRequest({ parts: [{ title: "A", task: "x", owns: ["./src/a/"] }, { title: "B", task: "y", owns: ["src\\b.ts"] }] });
    expect(request.parts.map((p) => p.owns)).toEqual([["src/a"], ["src/b.ts"]]);
  });

  test("refuses a single part, a part without files, and the whole repository", () => {
    expect(() => readSplitRequest({ parts: [{ title: "A", task: "x", owns: ["a"] }] })).toThrow("at least 2");
    expect(() => readSplitRequest({ parts: [{ title: "A", task: "x", owns: [] }, { title: "B", task: "y", owns: ["b"] }] })).toThrow("no files");
    expect(() => readSplitRequest({ parts: [{ title: "A", task: "x", owns: ["."] }, { title: "B", task: "y", owns: ["b"] }] })).toThrow("cannot be used: .");
  });

  test("refuses parts that own the same files, folder or file inside it", () => {
    const parts = [
      { title: "A", task: "x", owns: ["src"] },
      { title: "B", task: "y", owns: ["src/b.ts"] },
    ];
    expect(() => readSplitRequest({ parts })).toThrow("may not own the same files");
    expect(ownershipClashes(parts.map((p) => ({ ...p })))).toHaveLength(1);
    // A shared prefix is not a shared folder.
    expect(ownershipClashes([{ title: "A", task: "x", owns: ["src/app"] }, { title: "B", task: "y", owns: ["src/apple.ts"] }])).toEqual([]);
  });

  test("tells helpers to keep off lockfiles unless they own one", () => {
    const request = readSplitRequest(twoParts);
    expect(helperPrompt(request, request.parts[0]!, "me/x")).toContain("Do not add dependencies or change lockfiles");
    const deps = readSplitRequest({ parts: [{ title: "Deps", task: "x", owns: ["bun.lock", "package.json"] }, { title: "B", task: "y", owns: ["b"] }] });
    expect(helperPrompt(deps, deps.parts[0]!, "me/x")).not.toContain("Do not add dependencies");
  });
});

describe("splitWork", () => {
  test("merges every part into the chat's branch and removes their worktrees", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => commit(cwd, part.owns[0]!, `${part.title}\n`)),
      "main",
      twoParts,
    );
    expect(report).toContain("2 merged");
    expect(await readFile(join(main, "hello.txt"), "utf8")).toBe("Greeting\n");
    expect(await readFile(join(main, "bye.txt"), "utf8")).toBe("Farewell\n");
    expect(removed).toEqual(["repo-greeting", "repo-farewell"]);
    expect((await git(main, ["log", "--format=%s", "-6"]))).toContain('Merge part "Greeting" (split_work)');
  });

  test("a part that conflicts is not merged, the folder stays clean, and its worktree is kept", async () => {
    const report = await splitWork(
      deps(
        async (part, cwd) => {
          // While the first part runs, the chat itself commits to the file the second part owns.
          if (part.title === "First") await commit(main, "b.txt", "the chat's\n");
          await commit(cwd, part.owns[0]!, `${part.title}\n`);
        },
        { partsAtOnce: 1 },
      ),
      "main",
      { parts: [{ title: "First", task: "x", owns: ["a.txt"] }, { title: "Second", task: "y", owns: ["b.txt"] }] },
    );
    expect(report).toContain("1 merged");
    expect(report).toContain("Second: conflicts, not merged");
    expect(report).toContain("in b.txt");
    expect(await readFile(join(main, "a.txt"), "utf8")).toBe("First\n");
    expect(await readFile(join(main, "b.txt"), "utf8")).toBe("the chat's\n");
    expect((await git(main, ["status", "--porcelain"])).trim()).toBe("");
    expect(existsSync(join(root, "repo-second"))).toBe(true);
    expect(removed).toEqual(["repo-first"]);
  });

  test("a part that changed files it does not own is kept, not merged", async () => {
    const report = await splitWork(
      // The second helper commits on its own, and reaches into the first part's file.
      deps(async (part, cwd) => commit(cwd, part.title === "Second" ? "a.txt" : part.owns[0]!, `${part.title}\n`)),
      "main",
      { parts: [{ title: "First", task: "x", owns: ["a.txt"] }, { title: "Second", task: "y", owns: ["b.txt"] }] },
    );
    expect(report).toContain("1 merged");
    expect(report).toContain("Second: failed, not merged");
    expect(report).toContain("it changed files it does not own (a.txt)");
    expect(await readFile(join(main, "a.txt"), "utf8")).toBe("First\n");
  });

  test("commits what a helper left uncommitted and merges it", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => writeFile(join(cwd, part.owns[0]!), "loose\n")),
      "main",
      twoParts,
    );
    expect(report).toContain("2 merged");
    expect(await readFile(join(main, "hello.txt"), "utf8")).toBe("loose\n");
  });

  test("a part with no changes is reported and its worktree removed", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => (part.title === "Greeting" ? commit(cwd, "hello.txt", "hi\n") : undefined)),
      "main",
      twoParts,
    );
    expect(report).toContain("Farewell: no changes");
    expect(removed).toContain("repo-farewell");
  });

  test("refuses to start over uncommitted changes", async () => {
    // A change to a tracked file; a new untracked one would not count.
    await writeFile(join(main, "a.txt"), "edited, not committed\n");
    await expect(splitWork(deps(async () => undefined), "main", twoParts)).rejects.toThrow("uncommitted changes");
    expect(created).toEqual([]);
  });

  test("a stopped chat merges nothing and keeps what the helpers did", async () => {
    let stopped = false;
    const report = await splitWork(
      deps(
        async (part, cwd) => {
          await commit(cwd, part.owns[0]!, "x\n");
          stopped = true;
        },
        { stopped: () => stopped },
      ),
      "main",
      twoParts,
    );
    expect(report).toContain("0 merged");
    expect(existsSync(join(main, "hello.txt"))).toBe(false);
    expect(removed).toEqual([]);
  });

  test("a helper that fails leaves the others to merge", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => {
        if (part.title === "Farewell") throw new Error("boom");
        await commit(cwd, part.owns[0]!, "x\n");
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("1 merged");
    expect(report).toContain("Farewell: failed, not merged");
    expect(report).toContain("Failed: boom");
  });

  test("waits for the chat before merging, and merges nothing over its uncommitted work", async () => {
    let waited = false;
    const report = await splitWork(
      deps(async (part, cwd) => commit(cwd, part.owns[0]!, "x\n"), {
        beforeMerge: async () => {
          waited = true;
          await writeFile(join(main, "a.txt"), "the chat kept working\n");
        },
      }),
      "main",
      twoParts,
    );
    expect(waited).toBe(true);
    expect(report).toContain("0 merged");
    expect(report).toContain("uncommitted changes");
    expect(existsSync(join(main, "hello.txt"))).toBe(false);
    expect(existsSync(join(root, "repo-greeting"))).toBe(true);
  });

  test("merges nothing once the chat has moved to another branch", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => commit(cwd, part.owns[0]!, "x\n"), {
        beforeMerge: async () => {
          await git(main, ["switch", "-c", "elsewhere"]);
        },
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("no longer on me/chat");
    expect(await git(main, ["log", "--format=%s", "-3"])).not.toContain("split_work");
  });
});

describe("splitWork, what is never merged", () => {
  test("a part whose helper did not finish is kept as it was, not committed or merged", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => {
        await writeFile(join(cwd, part.owns[0]!), "half done\n");
        if (part.title === "Farewell") return { text: "ran out of usage", finished: false, why: "usage limit" };
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("1 merged");
    expect(report).toContain("Farewell: unfinished, not merged");
    expect(report).toContain("did not finish (usage limit)");
    expect(existsSync(join(main, "bye.txt"))).toBe(false);
    // Left uncommitted in its worktree, for the chat to finish or redo.
    expect((await git(join(root, "repo-farewell"), ["status", "--porcelain"])).trim()).toContain("bye.txt");
  });

  test("a merge refused by a hook is a failure, not a conflict, and leaves the folder clean", async () => {
    await writeFile(join(repo, ".git", "hooks", "pre-merge-commit"), "#!/bin/sh\necho no merges today >&2\nexit 1\n", { mode: 0o755 });
    const report = await splitWork(deps(async (part, cwd) => commit(cwd, part.owns[0]!, "x\n")), "main", twoParts);
    expect(report).toContain("0 merged");
    expect(report).toContain("Greeting: failed, not merged");
    expect(report).not.toContain("conflicts, not merged");
    expect((await git(main, ["status", "--porcelain"])).trim()).toBe("");
  });
});

describe("splitWork, where parts start and when the folder is used", () => {
  test("every part starts from the commit the split started at, even if the chat committed since", async () => {
    const started = (await git(main, ["rev-parse", "HEAD"])).trim();
    const bases: string[] = [];
    await splitWork(
      deps(async (part, cwd) => {
        bases.push((await git(cwd, ["rev-parse", "HEAD"])).trim());
        // The chat moves on while the first part runs; the second part must not see it.
        if (part.title === "Greeting") await commit(main, "later.txt", "later\n");
        await commit(cwd, part.owns[0]!, "x\n");
      }, { partsAtOnce: 1 }),
      "main",
      twoParts,
    );
    expect(bases).toEqual([started, started]);
  });

  test("worktrees are removed only after every merge, and the folder is handed back first", async () => {
    const events: string[] = [];
    const base = deps(async (part, cwd) => commit(cwd, part.owns[0]!, "x\n"));
    await splitWork(
      {
        ...base,
        beforeMerge: async () => void events.push("hold"),
        afterMerge: () => void events.push("release"),
        removeWorktree: async (workspace, project) => {
          events.push(`remove ${workspace.id}`);
          await base.removeWorktree(workspace, project);
        },
      },
      "main",
      twoParts,
    );
    expect(events).toEqual(["hold", "release", "remove repo-greeting", "remove repo-farewell"]);
  });

  test("parts with the same title get worktrees of their own", () => {
    const parts = [
      { title: "Tests", task: "x", owns: ["a"] },
      { title: "Tests", task: "y", owns: ["b"] },
      { title: "Docs", task: "z", owns: ["c"] },
    ];
    expect(partNames("repo", parts)).toEqual(["repo-tests-1", "repo-tests-2", "repo-docs"]);
  });

  test("ownership clashes ignore case", () => {
    expect(ownershipClashes([{ title: "A", task: "x", owns: ["src/App.ts"] }, { title: "B", task: "y", owns: ["SRC"] }])).toHaveLength(1);
  });
});

describe("splitWork, what a helper leaves behind", () => {
  test("parts the person stops are announced as stopped, and their empty worktrees go", async () => {
    const progress: string[] = [];
    let stop = false;
    const report = await splitWork(
      deps(
        async () => {
          stop = true;
        },
        { stopped: () => stop, progress: (line) => void progress.push(line) },
      ),
      "main",
      twoParts,
    );
    expect(progress.sort()).toEqual(["Farewell: stopped", "Greeting: stopped"]);
    expect(report).toContain("stopped, not merged");
    expect(removed.sort()).toEqual(["repo-farewell", "repo-greeting"]);
  });

  test("an unfinished part with nothing in its worktree is removed rather than kept", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => (part.title === "Farewell" ? { text: "", finished: false, why: "stopped" } : commit(cwd, part.owns[0]!, "x\n"))),
      "main",
      twoParts,
    );
    expect(report).toContain("Its worktree had nothing in it and was removed.");
    expect(removed).toContain("repo-farewell");
  });

  test("a part that made new files outside its own is kept, not merged half wired", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => {
        await writeFile(join(cwd, part.owns[0]!), "mine\n");
        await writeFile(join(cwd, `${part.title}.tmp`), "scratch\n");
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("0 merged");
    expect(report).toContain("it also made new files outside its own (Greeting.tmp)");
    expect(existsSync(join(main, "Greeting.tmp"))).toBe(false);
    expect(existsSync(join(main, "hello.txt"))).toBe(false);
  });

  test("owned paths must be relative to the repository", () => {
    expect(() => readSplitRequest({ parts: [{ title: "A", task: "x", owns: [String.raw`D:\repo\src`] }, { title: "B", task: "y", owns: ["b"] }] })).toThrow("relative");
    expect(() => readSplitRequest({ parts: [{ title: "A", task: "x", owns: ["/home/me/repo/src"] }, { title: "B", task: "y", owns: ["b"] }] })).toThrow("relative");
  });
});

describe("splitWork, owned paths the helper never made", () => {
  test("a finished part whose owned file does not exist still merges what it did", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => {
        // It owns two files but writes only one, and leaves it uncommitted.
        await writeFile(join(cwd, part.owns[0]!), "made\n");
      }),
      "main",
      {
        parts: [
          { title: "Greeting", task: "x", owns: ["hello.txt", "never-made.txt"] },
          { title: "Farewell", task: "y", owns: ["bye.txt"] },
        ],
      },
    );
    expect(report).toContain("2 merged");
    expect(await readFile(join(main, "hello.txt"), "utf8")).toBe("made\n");
  });

  test("owned paths may hold brackets, as route folders do", () => {
    const request = readSplitRequest({ parts: [{ title: "A", task: "x", owns: ["app/[id]/page.tsx"] }, { title: "B", task: "y", owns: ["b"] }] });
    expect(request.parts[0]!.owns).toEqual(["app/[id]/page.tsx"]);
  });

  test("owned paths are literal, not patterns", () => {
    expect(() => readSplitRequest({ parts: [{ title: "A", task: "x", owns: ["src/**"] }, { title: "B", task: "y", owns: ["b"] }] })).toThrow("literal");
  });
});

describe("Gate", () => {
  test("runs at most its limit at once, the rest in turn", async () => {
    const gate = new Gate(2);
    let running = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        gate.run(async () => {
          most = Math.max(most, ++running);
          await Bun.sleep(20);
          running--;
        }),
      ),
    );
    expect(most).toBe(2);
  });
});

describe("planSplit, groundwork", () => {
  test("names new files the chat has not committed, without refusing or touching them", async () => {
    await writeFile(join(main, "shared-types.ts"), "export type X = 1\n");
    const plan = await planSplit(deps(async () => undefined), "main", twoParts);
    expect(plan.untracked).toEqual(["shared-types.ts"]);
    expect(existsSync(join(main, "shared-types.ts"))).toBe(true);
  });
});

describe("splitWork, what a part may bring in", () => {
  test("a part that moves a file it does not own is kept, the move included", async () => {
    await commit(main, "shared.txt", "shared\n");
    const report = await splitWork(
      deps(async (part, cwd) => {
        if (part.title === "Greeting") {
          await git(cwd, ["mv", "shared.txt", "hello.txt"]);
          await git(cwd, ["commit", "-m", "move"]);
        } else await writeFile(join(cwd, part.owns[0]!), "bye\n");
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("Greeting: failed, not merged");
    expect(report).toContain("shared.txt");
    expect(existsSync(join(main, "shared.txt"))).toBe(true);
  });

  test("what a helper staged itself outside its files (ignored build output) is not committed", async () => {
    await commit(main, ".gitignore", "*.log\n");
    const report = await splitWork(
      deps(async (part, cwd) => {
        await writeFile(join(cwd, part.owns[0]!), "mine\n");
        await writeFile(join(cwd, `${part.title}.log`), "build output\n");
        await git(cwd, ["add", "-A"]);
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("2 merged");
    expect(existsSync(join(main, "Greeting.log"))).toBe(false);
  });

  test("a part that also changed a tracked file it does not own is kept, not merged half wired", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => {
        await writeFile(join(cwd, part.owns[0]!), "mine\n");
        if (part.title === "Greeting") await writeFile(join(cwd, "a.txt"), "registered greeting\n");
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("1 merged");
    expect(report).toContain("it also changed files it does not own (a.txt)");
    expect(existsSync(join(main, "hello.txt"))).toBe(false);
  });
});

describe("splitWork, history and tooling", () => {
  test("merges nothing into a branch rewritten past the split's start", async () => {
    await commit(main, "groundwork.txt", "shared\n");
    const report = await splitWork(
      deps(async (part, cwd) => commit(cwd, part.owns[0]!, "x\n"), {
        // While the parts ran, the chat reset its groundwork away.
        beforeMerge: async () => {
          await git(main, ["reset", "--hard", "HEAD~1"]);
        },
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("0 merged");
    expect(report).toContain("history was rewritten");
    expect(existsSync(join(main, "groundwork.txt"))).toBe(false);
  });

  test("puts back what the setup script changed outside the part's files, and merges the part", async () => {
    const report = await splitWork(
      deps(async (part, cwd) => writeFile(join(cwd, part.owns[0]!), "mine\n"), {
        // The setup script rewrites a tracked file (a lockfile, say).
        prepare: async (_project, workspace) => {
          await writeFile(join(workspace.path, "a.txt"), "rewritten by setup\n");
          return null;
        },
      }),
      "main",
      twoParts,
    );
    expect(report).toContain("2 merged");
    expect(report).toContain("Changes the setup script made to a.txt were put back.");
    expect(await readFile(join(main, "a.txt"), "utf8")).toBe("one\n");
  });

  test("refuses owned paths it cannot use, naming them", () => {
    expect(() =>
      readSplitRequest({ parts: [{ title: "A", task: "x", owns: ["src/a.ts", "src/**/b.ts", "../c"] }, { title: "B", task: "y", owns: ["b"] }] }),
    ).toThrow("cannot be used: src/**/b.ts, ../c");
  });
});
