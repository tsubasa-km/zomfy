// A private copy of the UI in headless Edge, with its own daemon, state and playground repo, so
// several people (or agents) can test side by side without touching the real app or each other.
//   bun scripts/preview.ts start <slot 1-9>   prints ports, then keeps running
//   bun scripts/preview.ts stop <slot>
// Drive it with `HARNESS_CDP_PORT=<cdp port> bun scripts/cdp.ts ...`. WSL hosts and Tauri-only
// actions (native dialogs, "Open in") are unavailable in a preview.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [command, slotArg] = process.argv.slice(2);
const slot = Number(slotArg);
if (!["start", "stop"].includes(command ?? "") || !(slot >= 1 && slot <= 9)) {
  console.error("usage: bun scripts/preview.ts start|stop <slot 1-9>");
  process.exit(2);
}

const home = join(tmpdir(), `acp-harness-preview-${slot}`);
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
await mkdir(home, { recursive: true });
const env = {
  ...process.env,
  ACP_HARNESS_HOME: home,
  ACP_HARNESS_ALLOWED_ORIGINS: `http://localhost:${ports.vite}`,
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

const vite = spawn("bun", ["x", "vite", "--port", String(ports.vite), "--strictPort"], {
  cwd: desktopDir,
  env: { ...env, HARNESS_VITE_PORT: String(ports.vite), VITE_HARNESS_DAEMON: connection },
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
