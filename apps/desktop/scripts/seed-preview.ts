// Fills a preview's own home with projects and threads in mixed turn-taking states, for trying the
// sidebar and the panes by hand. Writes only under %TEMP%/zomfy-preview-<slot> (the OS temp dir).
//   bun scripts/seed-preview.ts <slot 1-9>          with the preview stopped (or: preview.ts start <slot> --seed)
//   bun scripts/seed-preview.ts <slot 1-9> --live   with it running: shows the seeded "needs your
//                                                   answer" and "working" threads, which only a live
//                                                   agent can be, until the page reloads
// Running it again replaces what it seeded before (ids and folders start with "seed-").
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [slotArg, ...flags] = process.argv.slice(2);
const slot = Number(slotArg);
if (!(slot >= 1 && slot <= 9)) {
  console.error("usage: bun scripts/seed-preview.ts <slot 1-9> [--live]");
  process.exit(2);
}
const home = join(tmpdir(), `zomfy-preview-${slot}`);
const seedRoot = join(home, "seed");
const HOUR = 3_600_000;
const now = Date.now();

type State = "needs-answer" | "failed" | "working" | "background" | "your-turn" | "quiet" | "archived";
interface ThreadSeed {
  title: string;
  state: State;
  /** How long ago its last turn started or ended. */
  agoHours: number;
  prompt: string;
  reply: string;
}
interface ProjectSeed {
  key: string;
  name: string;
  threads: ThreadSeed[];
}

const PROJECTS: ProjectSeed[] = [
  {
    key: "storefront",
    name: "storefront",
    threads: [
      { title: "Checkout button stays disabled after a coupon", state: "needs-answer", agoHours: 0.1, prompt: "Applying a coupon leaves the checkout button disabled. Find out why.", reply: "The coupon form never resets `isSubmitting`. May I change `CouponForm.tsx` to reset it in `finally`?" },
      { title: "Add zoom to product images", state: "working", agoHours: 0.05, prompt: "Add a hover zoom to the product gallery.", reply: "Reading the gallery component…" },
      { title: "Fix price rounding in the cart", state: "your-turn", agoHours: 0.2, prompt: "Cart totals are off by a cent sometimes.", reply: "Totals were summed as floats. I switched them to integer cents and added tests; all pass." },
      { title: "Upgrade React Router to v7", state: "quiet", agoHours: 50, prompt: "Upgrade React Router.", reply: "Upgraded, routes migrated to the new data APIs, tests pass." },
      { title: "Lazy-load category pages", state: "quiet", agoHours: 120, prompt: "Category pages load every image at once.", reply: "Images below the fold now load lazily; the first paint is 40% faster." },
    ],
  },
  {
    key: "billing-api",
    name: "billing-api",
    threads: [
      { title: "Retry failed webhook deliveries", state: "background", agoHours: 0.3, prompt: "Retry failed webhook deliveries with backoff.", reply: "Retries are in. I scheduled a check of the delivery log for later today." },
      { title: "Invoice PDF shows the wrong tax line", state: "failed", agoHours: 1, prompt: "The invoice PDF shows VAT twice.", reply: "The renderer crashed while loading the fonts." },
      { title: "Add idempotency keys to POST /charges", state: "your-turn", agoHours: 2, prompt: "Add idempotency keys to charge creation.", reply: "Done: keys are stored for 24 hours and a repeat returns the first response. Want me to cover refunds too?" },
      { title: "Document the refund endpoint", state: "quiet", agoHours: 30, prompt: "Write docs for POST /refunds.", reply: "Added `docs/refunds.md` with examples." },
    ],
  },
  {
    key: "docs-site",
    name: "docs-site",
    threads: [
      { title: "Rewrite the getting started guide", state: "your-turn", agoHours: 0.6, prompt: "The getting started guide is out of date.", reply: "Rewrote it around the new CLI. Have a look at the draft before I replace the old page." },
      { title: "Fix broken links in the API reference", state: "quiet", agoHours: 26, prompt: "Find and fix broken links.", reply: "Fixed 14 links; the link checker now runs in CI." },
      { title: "Dark mode for code blocks", state: "quiet", agoHours: 80, prompt: "Code blocks are unreadable in dark mode.", reply: "Code blocks follow the theme now." },
    ],
  },
  {
    key: "mobile-app",
    name: "mobile-app",
    threads: [
      { title: "Crash on Android 14 when opening the camera", state: "working", agoHours: 0.02, prompt: "The app crashes when opening the camera on Android 14.", reply: "Reproducing on the emulator…" },
      { title: "Push notification opt-in screen", state: "quiet", agoHours: 40, prompt: "Design the push notification opt-in screen.", reply: "Added the screen behind a feature flag." },
      { title: "Offline cache for the feed", state: "archived", agoHours: 200, prompt: "Cache the feed for offline use.", reply: "The feed is cached for 24 hours." },
    ],
  },
];

const QUICK: ThreadSeed[] = [
  { title: "SQLite or DuckDB for log analysis?", state: "your-turn", agoHours: 0.4, prompt: "Should I use SQLite or DuckDB to analyse a few GB of logs?", reply: "DuckDB: it is columnar and reads the files in place. Want a starter query?" },
  { title: "A regex for ISO dates", state: "quiet", agoHours: 60, prompt: "Regex for ISO 8601 dates?", reply: "`^\\d{4}-\\d{2}-\\d{2}$`, with a note on what it does not check." },
];

const idOf = (key: string, index: number) => `seed-${key}-${index}`;

if (flags.includes("--live")) {
  await live();
  process.exit(0);
}

const daemonInfo = join(home, "daemon.json");
if (existsSync(daemonInfo)) {
  const pid = (JSON.parse(await readFile(daemonInfo, "utf8")) as { pid?: number }).pid;
  if (pid && isAlive(pid)) {
    console.error(`preview ${slot} is running: stop it first (bun scripts/preview.ts stop ${slot}), or start it with --seed`);
    process.exit(1);
  }
}

await seed();

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gitRepo(path: string, name: string): Promise<void> {
  if (existsSync(join(path, ".git"))) return;
  await mkdir(join(path, "src"), { recursive: true });
  await writeFile(join(path, "README.md"), `# ${name}\n\nA seeded project for trying Zomfy in a preview.\n`);
  await writeFile(join(path, "src", "index.ts"), `export const name = ${JSON.stringify(name)}\n`);
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=zomfy", "-c", "user.email=zomfy@localhost", ...args], { cwd: path, stdio: "ignore", windowsHide: true });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "Initial commit");
}

async function seed(): Promise<void> {
  await mkdir(join(home, "sessions"), { recursive: true });
  const statePath = join(home, "state.json");
  const state = existsSync(statePath)
    ? (JSON.parse(await readFile(statePath, "utf8")) as { projects: any[]; workspaces: any[]; [key: string]: unknown })
    : { projects: [], workspaces: [], projectGroups: [] };
  state.projects = state.projects.filter((p) => !String(p.id).startsWith("seed-"));
  state.workspaces = state.workspaces.filter((w) => !String(w.id).startsWith("seed-"));

  const indexPath = join(home, "sessions", "index.json");
  const records = existsSync(indexPath) ? (JSON.parse(await readFile(indexPath, "utf8")) as any[]) : [];
  for (const old of records.filter((r) => String(r.id).startsWith("seed-"))) await rm(join(home, "sessions", `${old.id}.jsonl`), { force: true });
  const kept = records.filter((r) => !String(r.id).startsWith("seed-"));

  const sessions: any[] = [];
  let order = Math.max(-1, ...state.projects.map((p) => p.sortOrder ?? 0)) + 1;
  for (const project of PROJECTS) {
    const path = join(seedRoot, project.key);
    await gitRepo(path, project.name);
    const projectId = `seed-project-${project.key}`;
    const workspaceId = `seed-workspace-${project.key}`;
    state.projects.push({ id: projectId, name: project.name, path, kind: "git", sortOrder: order++ });
    state.workspaces.push({ id: workspaceId, projectId, name: project.name, path, branch: "main", isPrimary: true, createdAt: now - 300 * HOUR });
    project.threads.forEach((thread, i) => sessions.push(record(idOf(project.key, i), workspaceId, path, thread)));
  }
  const quickPath = join(home, "scratch", "seed-quick");
  await mkdir(quickPath, { recursive: true });
  state.workspaces.push({ id: "seed-workspace-quick", projectId: null, name: "Quick chat", path: quickPath, branch: null, isPrimary: true, createdAt: now - 100 * HOUR, scratch: true });
  QUICK.forEach((thread, i) => sessions.push(record(idOf("quick", i), "seed-workspace-quick", quickPath, thread)));

  for (const [i, s] of sessions.entries()) {
    const thread = [...PROJECTS.flatMap((p) => p.threads), ...QUICK][i]!;
    const lines = [
      { sessionUpdate: "user_message_chunk", messageId: `${s.id}-u0`, content: { type: "text", text: thread.prompt } },
      { sessionUpdate: "agent_message_chunk", messageId: `${s.id}-a0`, content: { type: "text", text: thread.reply } },
    ];
    await writeFile(join(home, "sessions", `${s.id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  await writeFile(statePath, JSON.stringify(state, null, 2));
  await writeFile(indexPath, JSON.stringify([...kept, ...sessions], null, 2));
  console.log(`seeded preview ${slot}: ${PROJECTS.length} projects, ${sessions.length} threads in ${home}`);
  console.log(`after starting it, run \`bun scripts/seed-preview.ts ${slot} --live\` for the needs-answer and working threads`);
}

function record(id: string, workspaceId: string, cwd: string, thread: ThreadSeed): Record<string, unknown> {
  const at = now - thread.agoHours * HOUR;
  const ended = thread.state !== "working";
  return {
    id,
    title: thread.title,
    status: thread.state === "failed" ? "error" : "idle",
    createdAt: at - HOUR,
    turnStartedAt: null,
    lastActivityAt: at,
    claudeSessionId: null,
    options: { model: null, permissionMode: "auto", effort: "high" },
    modeForEveryAgent: true,
    workspaceId,
    cwd,
    yourTurnSince: ended ? at : null,
    // A quiet thread was seen after its turn ended; a thread that is the person's turn was not.
    seenAt: thread.state === "quiet" || thread.state === "archived" ? at + 60_000 : null,
    ...(thread.state === "archived" ? { archived: true } : {}),
    // A one-shot wake-up the daemon holds after its restart, far enough off not to fire while trying things.
    ...(thread.state === "background"
      ? { background: { tasks: [], wakeUps: [{ id: `${id}-wake`, at: now + 20 * HOUR, recurring: false, prompt: "Check the webhook delivery log" }] } }
      : {}),
  };
}

/** Shows the seeded needs-answer and working threads in the running preview's window. */
async function live(): Promise<void> {
  const patches: Record<string, { status: string; turnStartedAt: number | null }> = {};
  for (const project of PROJECTS) {
    project.threads.forEach((thread, i) => {
      if (thread.state === "needs-answer") patches[idOf(project.key, i)] = { status: "needs-you", turnStartedAt: null };
      if (thread.state === "working") patches[idOf(project.key, i)] = { status: "working", turnStartedAt: now - thread.agoHours * HOUR };
    });
  }
  // Applied again whenever the host reports its threads, until it reports one working for real.
  // After a hot reload of session-store the app runs the newest copy (`?t=…`); patching the first
  // copy would leave the window showing two states for one thread.
  const script = `(async () => {
    const copies = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/session-store.ts')
    const m = await import(copies.at(-1) ?? '/src/session-store.ts')
    const patches = ${JSON.stringify(patches)}
    const released = new Set()
    const apply = () => {
      const s = m.getState()
      const seeded = s.sessions.find((x) => patches[x.id])
      if (!seeded) return 'no seeded threads'
      const host = seeded.hostId
      let changed = false
      const list = s.sessions.filter((x) => x.hostId === host).map(({ items, loaded, hostId, ...info }) => {
        const patch = patches[info.id]
        if (!patch || released.has(info.id)) return info
        if (info.status === 'working' && info.turnStartedAt !== patch.turnStartedAt) { released.add(info.id); return info }
        if (info.status === patch.status) return info
        changed = true
        return { ...info, ...patch }
      })
      if (changed) m.mergeSessions(host, list)
      return 'ok'
    }
    window.__seedLive?.()
    window.__seedLive = m.subscribeStore(() => queueMicrotask(apply))
    return apply()
  })()`;
  const result = spawnSync("bun", ["scripts/cdp.ts", "eval", script], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, HARNESS_CDP_PORT: String(9300 + slot) },
    encoding: "utf8",
    windowsHide: true,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}
