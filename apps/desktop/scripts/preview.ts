// A private copy of the UI in headless Edge, with its own daemon, state and playground repo, so
// several people (or agents) can test side by side without touching the real app or each other.
//   bun scripts/preview.ts start <slot 1-9> [--prod]   prints ports, then keeps running; --prod
//                                             serves a production build (as the app ships) instead of
//                                             the dev server, for timing startup
//   bun scripts/preview.ts stop <slot>
// Drive it with `HARNESS_CDP_PORT=<cdp port> bun scripts/cdp.ts ...`. WSL hosts and Tauri-only
// actions (native dialogs, "Open in") are unavailable in a preview.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [command, slotArg, ...flags] = process.argv.slice(2);
const prod = flags.includes("--prod");
const slot = Number(slotArg);
if (!["start", "stop"].includes(command ?? "") || !(slot >= 1 && slot <= 9)) {
  console.error("usage: bun scripts/preview.ts start|stop <slot 1-9> [--prod]");
  process.exit(2);
}

const home = join(tmpdir(), `zomfy-preview-${slot}`);
const pidsPath = join(home, "pids.json");
const ports = { daemon: 7900 + slot, vite: 1430 + slot, cdp: 9300 + slot };
const desktopDir = join(import.meta.dir, "..");
const daemonDir = join(desktopDir, "..", "..", "packages", "daemon");

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }
}

/** Ends a slot's processes, including the runner that started them (this script, left waiting). */
async function stop(): Promise<void> {
  if (!existsSync(pidsPath)) return;
  for (const pid of JSON.parse(await readFile(pidsPath, "utf8")) as number[]) if (pid !== process.pid) killTree(pid);
  await writeFile(pidsPath, "[]");
}

if (command === "stop") {
  await stop();
  console.log(`preview ${slot} stopped`);
  process.exit(0);
}

await stop();
// A slot first used before the rename keeps its state: copied, since branches still on the legacy
// script go on using the legacy folder.
const legacyHome = join(tmpdir(), `acp-harness-preview-${slot}`); // legacy
if (!existsSync(home) && existsSync(legacyHome)) await cp(legacyHome, home, { recursive: true, verbatimSymlinks: true });
await mkdir(home, { recursive: true });
const env = {
  ...process.env,
  ZOMFY_HOME: home,
  // Bot homes (the master bot's included) stay in the preview's state, not the person's ~/zomfy/bots.
  ZOMFY_BOTS_DIR: join(home, "bots"),
  ZOMFY_ALLOWED_ORIGINS: `http://localhost:${ports.vite}`,
};
const pids: number[] = [];
const remember = async (pid: number | undefined) => {
  if (pid) pids.push(pid);
  await writeFile(pidsPath, JSON.stringify(pids));
};
// The runner itself, so a later start or stop ends it rather than leaving one per restart.
await remember(process.pid);

const daemon = spawn("bun", ["src/main.ts", `--port=${ports.daemon}`, "--print-connection"], {
  cwd: daemonDir,
  env,
  stdio: ["ignore", "pipe", "inherit"],
  windowsHide: true,
  detached: process.platform !== "win32",
});
await remember(daemon.pid);
const connection = await new Promise<string>((resolve, reject) => {
  let buffered = "";
  daemon.stdout!.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    const line = buffered.split("\n").find((l) => l.trim().startsWith("{"));
    if (line) resolve(line.trim());
  });
  daemon.on("exit", (code) => reject(new Error(`daemon exited (${code})`)));
});
// Once its daemon is gone (stopped, or killed by a restart of the slot), the runner has nothing to keep.
daemon.on("exit", () => void stop().then(() => process.exit(0)));

const viteEnv = { ...env, HARNESS_VITE_PORT: String(ports.vite), VITE_HARNESS_DAEMON: connection };
const dist = join(home, "dist");
if (prod) {
  const built = spawnSync("bun", ["x", "vite", "build", "--outDir", dist, "--emptyOutDir"], {
    cwd: desktopDir,
    env: viteEnv,
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });
  if (built.status !== 0) throw new Error("vite build failed");
}
const viteArgs = prod
  ? ["x", "vite", "preview", "--outDir", dist, "--port", String(ports.vite), "--strictPort"]
  : ["x", "vite", "--port", String(ports.vite), "--strictPort"];
const vite = spawn("bun", viteArgs, {
  cwd: desktopDir,
  env: viteEnv,
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true,
  detached: process.platform !== "win32",
});
await remember(vite.pid);
const url = `http://localhost:${ports.vite}/`;
for (let i = 0; ; i++) {
  if (await fetch(url).then((r) => r.ok, () => false)) break;
  if (i > 120) throw new Error("vite did not start");
  await Bun.sleep(500);
}

const playground = join(home, "playground");
const ensured = spawnSync("bun", ["scripts/ensure-playground.ts", playground], {
  cwd: daemonDir,
  env,
  encoding: "utf8",
  windowsHide: true,
});
const playgroundInfo = ensured.stdout.trim();

const edge =
  process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : (process.env.HARNESS_PREVIEW_BROWSER ?? "chromium");
const browser = spawn(
  edge,
  [
    "--headless=new",
    `--remote-debugging-port=${ports.cdp}`,
    `--user-data-dir=${join(home, "browser")}`,
    "--window-size=1440,900",
    "--no-first-run",
    url,
  ],
  { stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" },
);
await remember(browser.pid);

console.log(
  JSON.stringify({ slot, home, url, cdpPort: ports.cdp, daemonPort: ports.daemon, playground: playgroundInfo }),
);
console.log(`ready: HARNESS_CDP_PORT=${ports.cdp} bun scripts/cdp.ts screenshot`);
process.on("SIGINT", () => void stop().then(() => process.exit(0)));
await new Promise(() => {});
