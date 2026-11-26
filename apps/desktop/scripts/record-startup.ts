// Records a cold load of the UI in a preview (scripts/preview.ts) as a filmstrip and a timeline.
//   bun scripts/record-startup.ts record <out dir> [--port 9309] [--max-ms 15000] [--interval 100]
//   bun scripts/record-startup.ts compare <before dir> <after dir>
// `record` reloads the page with the HTTP cache off and writes into <out dir>:
//   frames/NNNN-<ms>.png  one frame per interval from navigation until the screen settles
//   filmstrip.mp4/.gif    the same frames, when ffmpeg is on PATH
//   trace.json            a DevTools performance trace (open it in the Performance panel)
//   metrics.json          milestones, daemon requests, long tasks, layout shifts, React commits
//   timeline.md           the same, readable
// Times are milliseconds from navigation start. Use `bun scripts/preview.ts start <slot> --prod` to
// time the production build the app ships; the dev server spends seconds on module requests.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What appears on screen, in the order a person reads it; first match that has a size counts. */
const MILESTONES: [name: string, selector: string][] = [
  ["boot screen", "#boot"],
  ["shell", "[data-status-bar]"],
  ["sidebar nav", "[data-sidebar-nav]"],
  ["thread list", "[data-chat-list] [data-session-id]"],
  ["tab strip", "[role=tab]"],
  ["transcript", "[data-native-chat-block]"],
  ["composer", "[data-native-chat-root] [contenteditable=true], [data-native-chat-root] textarea"],
  ["right sidebar", "[data-pane-sidebar-buttons]"],
  ["explorer tree", "[data-file-explorer-tree]"],
  ["status bar host", "[data-status-host]"],
  ["usage limits", "[data-status-usage-limits]"],
];

/** Runs in the page before its own scripts: watches milestones, shifts, long tasks and the daemon socket. */
const INSTRUMENT = `(() => {
  const s = (window.__startup = { milestones: {}, gone: {}, shifts: [], longTasks: [], rpc: [], notes: [], commits: [], lastMutation: 0 });
  const now = () => Math.round(performance.now());
  const selectors = ${JSON.stringify(MILESTONES)};
  const check = () => {
    for (const [name, sel] of selectors) {
      const el = document.querySelector(sel);
      const shown = !!el && el.getBoundingClientRect().width > 0;
      if (shown && s.milestones[name] === undefined) s.milestones[name] = now();
      if (!shown && s.milestones[name] !== undefined && s.gone[name] === undefined) s.gone[name] = now();
    }
  };
  new MutationObserver(() => { s.lastMutation = now(); check(); }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener("DOMContentLoaded", check);
  const po = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch {} };
  po("layout-shift", (e) => { if (!e.hadRecentInput) s.shifts.push({ t: Math.round(e.startTime), value: +e.value.toFixed(4), nodes: (e.sources || []).map((x) => x.node && x.node.nodeType === 1 ? (x.node.tagName.toLowerCase() + (x.node.id ? "#" + x.node.id : "") + "." + String(x.node.className).split(" ").slice(0, 3).join(".")) : "") }); });
  po("longtask", (e) => s.longTasks.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) }));
  po("paint", (e) => (s.milestones[e.name] = Math.round(e.startTime)));
  // React commits, counted through the hook React looks for at load.
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() { s.commits.push(now()); }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      const open = new Map();
      this.addEventListener("open", () => s.notes.push({ t: now(), method: "(socket open)", bytes: 0 }));
      const send = this.send.bind(this);
      this.send = (data) => {
        try { const m = JSON.parse(data); if (m.method && m.id !== undefined) open.set(m.id, { method: m.method, t: now(), bytes: String(data).length }); } catch {}
        return send(data);
      };
      this.addEventListener("message", (ev) => {
        try {
          const m = JSON.parse(ev.data);
          const bytes = String(ev.data).length;
          if (m.id !== undefined && open.has(m.id)) { const r = open.get(m.id); open.delete(m.id); s.rpc.push({ method: r.method, start: r.t, end: now(), bytes }); }
          else if (m.method) s.notes.push({ t: now(), method: m.method, bytes });
        } catch {}
      });
    }
  };
})();`;

interface Metrics {
  url: string;
  milestones: Record<string, number>;
  gone: Record<string, number>;
  shifts: { t: number; value: number; nodes: string[] }[];
  longTasks: { t: number; ms: number }[];
  rpc: { method: string; start: number; end: number; bytes: number }[];
  notes: { t: number; method: string; bytes: number }[];
  commits: number[];
  network: { requests: number; bytes: number; lastFinished: number };
  frames: { count: number; visuallyComplete: number };
  summary: Summary;
}

interface Summary {
  firstPaint: number;
  stableLayout: number;
  visuallyComplete: number;
  layoutShifts: number;
  cls: number;
  longTasks: number;
  longTaskMs: number;
  reactCommits: number;
  daemonRequests: number;
}

function flag(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
}

async function connect(port: number) {
  const targets: { type: string; url: string; webSocketDebuggerUrl: string }[] = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const pages = targets.filter((t) => t.type === "page");
  const page = pages.find((t) => /^(https?|tauri):/.test(t.url)) ?? pages[0];
  if (!page) throw new Error(`No page target on port ${port}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map<number, (msg: any) => void>();
  const handlers: ((msg: any) => void)[] = [];
  socket.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    } else if (msg.method) for (const h of handlers) h(msg);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  return { url: page.url, send, evaluate, on: (h: (msg: any) => void) => handlers.push(h), close: () => socket.close() };
}

async function record(out: string, args: string[]): Promise<void> {
  const port = flag(args, "--port", Number(process.env.HARNESS_CDP_PORT ?? 9309));
  const maxMs = flag(args, "--max-ms", 15_000);
  const interval = flag(args, "--interval", 100);
  const quietMs = 1500;
  const cdp = await connect(port);
  const url = cdp.url.replace(/#.*$/, "");
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "frames"), { recursive: true });

  const frames: { wall: number; data: string }[] = [];
  const network = { requests: 0, bytes: 0, lastFinishedWall: 0 };
  const traceChunks: any[] = [];
  let traceDone: () => void = () => {};
  const traceComplete = new Promise<void>((r) => (traceDone = r));
  cdp.on((msg) => {
    if (msg.method === "Page.screencastFrame") {
      frames.push({ wall: msg.params.metadata.timestamp * 1000, data: msg.params.data });
      void cdp.send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
    } else if (msg.method === "Network.requestWillBeSent") network.requests++;
    else if (msg.method === "Network.loadingFinished") {
      network.bytes += msg.params.encodedDataLength ?? 0;
      network.lastFinishedWall = Date.now();
    } else if (msg.method === "Tracing.dataCollected") traceChunks.push(...msg.params.value);
    else if (msg.method === "Tracing.tracingComplete") traceDone();
  });

  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Page.navigate", { url: "about:blank" });
  await Bun.sleep(300);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,loading,blink.user_timing,v8.execute,toplevel",
    transferMode: "ReportEvents",
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  frames.length = 0;
  network.requests = 0;
  network.bytes = 0;
  await cdp.send("Page.navigate", { url });

  // Until nothing in the DOM has changed for a while, or the cap.
  const started = Date.now();
  for (;;) {
    await Bun.sleep(250);
    const state = await cdp.evaluate("window.__startup ? [Math.round(performance.now()), window.__startup.lastMutation] : null").catch(() => null);
    if (Date.now() - started > maxMs) break;
    if (state && state[0] > 2000 && state[0] - state[1] > quietMs) break;
  }
  await cdp.send("Page.stopScreencast");
  await cdp.send("Tracing.end");
  await traceComplete;
  const page = await cdp.evaluate("JSON.stringify({ ...window.__startup, origin: performance.timeOrigin })");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  cdp.close();
  const s = JSON.parse(page);
  const origin: number = s.origin;

  // A frame per interval: the last screencast frame at or before each tick.
  const timed = frames.map((f) => ({ t: Math.round(f.wall - origin), data: f.data })).filter((f) => f.t >= -50);
  const end = Math.max(...timed.map((f) => f.t), s.lastMutation) + interval;
  let written = 0;
  for (let tick = 0, i = -1; tick <= end; tick += interval) {
    while (i + 1 < timed.length && timed[i + 1]!.t <= tick) i++;
    if (i < 0) continue;
    await writeFile(join(out, "frames", `${String(written++).padStart(4, "0")}-${tick}ms.png`), Buffer.from(timed[i]!.data, "base64"));
  }
  // Visually complete: the first frame that already looks like one of the last two images (a caret may blink).
  const finals = new Set(timed.slice(-2).map((f) => f.data));
  let visuallyComplete = timed.at(-1)?.t ?? 0;
  for (let i = timed.length - 1; i >= 0 && finals.has(timed[i]!.data); i--) visuallyComplete = timed[i]!.t;

  const shownAt = Object.values(s.milestones as Record<string, number>);
  const lastShift = s.shifts.reduce((m: number, x: { t: number }) => Math.max(m, x.t), 0);
  const summary: Summary = {
    firstPaint: s.milestones["first-contentful-paint"] ?? s.milestones["first-paint"] ?? 0,
    stableLayout: Math.max(lastShift, ...MILESTONES.map(([n]) => s.milestones[n] ?? 0).filter((t) => shownAt.includes(t))),
    visuallyComplete,
    layoutShifts: s.shifts.length,
    cls: +s.shifts.reduce((sum: number, x: { value: number }) => sum + x.value, 0).toFixed(4),
    longTasks: s.longTasks.length,
    longTaskMs: s.longTasks.reduce((sum: number, x: { ms: number }) => sum + x.ms, 0),
    reactCommits: s.commits.length,
    daemonRequests: s.rpc.length,
  };
  const metrics: Metrics = {
    url,
    milestones: s.milestones,
    gone: s.gone,
    shifts: s.shifts,
    longTasks: s.longTasks,
    rpc: s.rpc,
    notes: s.notes,
    commits: s.commits,
    network: { requests: network.requests, bytes: network.bytes, lastFinished: Math.round(network.lastFinishedWall - origin) },
    frames: { count: written, visuallyComplete },
    summary,
  };
  await writeFile(join(out, "metrics.json"), JSON.stringify(metrics, null, 2));
  await writeFile(join(out, "trace.json"), JSON.stringify({ traceEvents: traceChunks }));
  await writeFile(join(out, "timeline.md"), timeline(metrics));
  encodeVideo(out, interval);
  console.log(timeline(metrics));
  console.log(`written to ${out}`);
}

function encodeVideo(out: string, interval: number): void {
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) return;
  const fps = String(Math.round(1000 / interval));
  // Frame names carry their time, so ffmpeg reads them through a concat list.
  const list = join(out, "frames.txt");
  const sorted = [...new Bun.Glob("*.png").scanSync(join(out, "frames"))].sort();
  writeFileSync(list, sorted.map((n) => `file 'frames/${n}'\nduration ${interval / 1000}`).join("\n") + "\n");
  const concat = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list];
  spawnSync("ffmpeg", [...concat, "-vf", `fps=${fps},scale=1280:-2`, "-pix_fmt", "yuv420p", join(out, "filmstrip.mp4")], { stdio: "inherit" });
  spawnSync("ffmpeg", [...concat, "-vf", `fps=${fps},scale=720:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, join(out, "filmstrip.gif")], { stdio: "inherit" });
}

function timeline(m: Metrics): string {
  const lines = [`# Startup timeline`, ``, `${m.url}`, ``, `## Summary (ms from navigation)`, ``];
  for (const [k, v] of Object.entries(m.summary)) lines.push(`- ${k}: ${v}`);
  lines.push(``, `## Milestones`, ``, `| ms | what | gone at |`, `| ---: | --- | ---: |`);
  for (const [name, t] of Object.entries(m.milestones).sort((a, b) => a[1] - b[1])) lines.push(`| ${t} | ${name} | ${m.gone[name] ?? ""} |`);
  const missing = MILESTONES.map(([n]) => n).filter((n) => m.milestones[n] === undefined);
  if (missing.length) lines.push(``, `Never shown: ${missing.join(", ")}`);
  lines.push(``, `## Daemon requests`, ``, `| start | end | ms | method | bytes |`, `| ---: | ---: | ---: | --- | ---: |`);
  for (const r of m.rpc) lines.push(`| ${r.start} | ${r.end} | ${r.end - r.start} | ${r.method} | ${r.bytes} |`);
  const counts = new Map<string, number>();
  for (const n of m.notes) counts.set(n.method, (counts.get(n.method) ?? 0) + 1);
  lines.push(``, `Notifications: ${[...counts].map(([k, v]) => `${k} x${v}`).join(", ") || "none"}`);
  lines.push(``, `## Long tasks`, ``, m.longTasks.map((x) => `${x.t} (+${x.ms})`).join(", ") || "none");
  lines.push(``, `## Layout shifts`, ``);
  for (const x of m.shifts) lines.push(`- ${x.t}: ${x.value} ${x.nodes.filter(Boolean).join(", ")}`);
  if (!m.shifts.length) lines.push("none");
  lines.push(``, `## React commits`, ``, `${m.commits.length}: ${m.commits.join(", ")}`);
  lines.push(``, `## Network`, ``, `${m.network.requests} requests, ${Math.round(m.network.bytes / 1024)} KiB, last finished at ${m.network.lastFinished}`);
  return lines.join("\n") + "\n";
}

async function compare(before: string, after: string): Promise<void> {
  const read = async (dir: string) => JSON.parse(await readFile(join(dir, "metrics.json"), "utf8")) as Metrics;
  const [a, b] = await Promise.all([read(before), read(after)]);
  console.log(`| metric | before | after |\n| --- | ---: | ---: |`);
  for (const k of Object.keys(a.summary) as (keyof Summary)[]) console.log(`| ${k} | ${a.summary[k]} | ${b.summary[k]} |`);
  for (const [name] of MILESTONES) console.log(`| ${name} | ${a.milestones[name] ?? "-"} | ${b.milestones[name] ?? "-"} |`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "record" && rest[0]) await record(rest[0], rest.slice(1));
else if (command === "compare" && rest[0] && rest[1]) await compare(rest[0], rest[1]);
else {
  console.error("usage: bun scripts/record-startup.ts record <out dir> [--port N] [--max-ms N] [--interval N]\n       bun scripts/record-startup.ts compare <before dir> <after dir>");
  process.exit(2);
}
