// stdout carries the ACP stream, so every diagnostic must go to stderr.
export function log(message: string): void {
  process.stderr.write(`[acp-harness] ${message}\n`);
}
