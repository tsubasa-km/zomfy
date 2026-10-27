// Agents run as process trees (an ACP adapter, its CLI, that CLI's MCP servers). Killing only the top
// process leaves the rest running, which on Windows piles up across daemon restarts.

type Child = { pid: number; kill: () => void; exited: Promise<unknown> };

const tracked = new Set<Child>();

/** Remembers a spawned tree so the daemon's shutdown can end it. */
export function trackChild(proc: Child): void {
  tracked.add(proc);
  void proc.exited.finally(() => tracked.delete(proc));
}

/** Ends the process and everything it started. */
export function killTree(proc: Child): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/pid", String(proc.pid), "/t", "/f"], { stdout: "ignore", stderr: "ignore", windowsHide: true });
    return;
  }
  try {
    // A child spawned detached leads its own process group.
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    proc.kill();
  }
}

/** For the daemon's exit: every tracked tree goes with it. */
export function killTrackedChildren(): void {
  for (const proc of tracked) killTree(proc);
  tracked.clear();
}
