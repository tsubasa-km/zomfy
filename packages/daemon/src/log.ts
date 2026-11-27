// stdout carries the ACP stream, so every diagnostic must go to stderr.
let filter: ((message: string) => string) | null = null;

/** Rewrites every line before it is written: saved secrets' values are redacted (docs/specs/agent-secrets.md). */
export function setLogFilter(next: ((message: string) => string) | null): void {
  filter = next;
}

export function log(message: string): void {
  process.stderr.write(`[zomfy] ${filter ? filter(message) : message}\n`);
}
