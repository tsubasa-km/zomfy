import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { throughNpmShim } from "./claude-executable.ts";

describe("throughNpmShim", () => {
  const npm = join("C:", "Users", "me", "AppData", "Roaming", "npm");
  const binary = join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");

  test("an npm shim on Windows resolves to the CLI binary behind it", () => {
    expect(throughNpmShim(join(npm, "claude.cmd"), (p) => p === binary)).toBe(binary);
    expect(throughNpmShim(join(npm, "claude.ps1"), (p) => p === binary)).toBe(binary);
  });

  test("a shim with no binary behind it, or a real executable, is kept as found", () => {
    expect(throughNpmShim(join(npm, "claude.cmd"), () => false)).toBe(join(npm, "claude.cmd"));
    expect(throughNpmShim("/usr/local/bin/claude", () => true)).toBe("/usr/local/bin/claude");
    expect(throughNpmShim(join("C:", "Users", "me", ".local", "bin", "claude.exe"), () => true)).toBe(join("C:", "Users", "me", ".local", "bin", "claude.exe"));
  });
});
