import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import type { Options, query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { releaseFinishedTurn, runClaudeTurn, useQueryForTests } from "./claude-turn.ts";
import { claudeChromeOn } from "./chat-agent-launch-settings.ts";

// Claude in Chrome (docs/specs/claude-in-chrome.md): the host's switch, the project's override, and
// the `--chrome` flag a turn's Claude Code process is started with.

describe("claudeChromeOn", () => {
  test("off by default, the host's switch otherwise, and a project's choice over both", () => {
    expect(claudeChromeOn({}, null)).toBe(false);
    expect(claudeChromeOn({ claudeChrome: true }, null)).toBe(true);
    expect(claudeChromeOn({ claudeChrome: true }, {})).toBe(true);
    expect(claudeChromeOn({ claudeChrome: true }, { claudeChrome: false })).toBe(false);
    expect(claudeChromeOn({}, { claudeChrome: true })).toBe(true);
  });
});

describe("a turn's Claude Code process", () => {
  const started: (Options | undefined)[] = [];
  afterEach(() => {
    useQueryForTests(null);
    started.length = 0;
  });

  const fake = ((params: Parameters<typeof query>[0]) => {
    started.push(params.options);
    async function* messages(): AsyncGenerator<SDKMessage> {
      yield { type: "system", subtype: "init", session_id: "claude-1", slash_commands: [], permissionMode: "default" } as unknown as SDKMessage;
      yield {
        type: "result",
        subtype: "success",
        result: "ok",
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
        modelUsage: {},
      } as unknown as SDKMessage;
    }
    return Object.assign(messages(), {
      setPermissionMode: async () => undefined,
      getContextUsage: async () => {
        throw new Error("not in the fake");
      },
    });
  }) as unknown as typeof query;

  async function turn(sessionId: string, chrome: boolean | undefined): Promise<Options | undefined> {
    useQueryForTests(fake);
    await runClaudeTurn({
      acpSessionId: sessionId,
      state: { cwd: tmpdir(), claudeSessionId: null, options: { permissionMode: "default" } as never },
      prompt: [{ type: "text", text: "go" }],
      messageId: crypto.randomUUID(),
      abort: new AbortController(),
      emit: async () => undefined,
      askPermission: async (): Promise<acp.RequestPermissionResponse> => ({ outcome: { outcome: "cancelled" } }),
      ...(chrome === undefined ? {} : { chrome }),
    });
    await releaseFinishedTurn(sessionId);
    return started.at(-1);
  }

  test("starts with --chrome only when the setting is on", async () => {
    expect((await turn("chrome-off", undefined))?.extraArgs).toBeUndefined();
    expect((await turn("chrome-false", false))?.extraArgs).toBeUndefined();
    expect((await turn("chrome-on", true))?.extraArgs).toEqual({ chrome: null });
  });
});

test("the host's Claude in Chrome switch is saved for Claude only, and off removes it", async () => {
  const home = await mkdtemp(join(tmpdir(), "claude-chrome-settings-"));
  const file = join(home, "chat-agents.json");
  try {
    await writeFile(file, JSON.stringify({ claude: { command: null, env: { CLAUDE_CONFIG_DIR: "x" } } }));
    // A fresh process, so the test never reads the developer's agent settings.
    const script = `
      import { chatAgentLaunch, updateChatAgentLaunch } from './src/chat-agent-launch-settings.ts'
      const before = await chatAgentLaunch('claude')
      await updateChatAgentLaunch('claude', { claudeChrome: true })
      const on = await chatAgentLaunch('claude')
      const saved = JSON.parse(await Bun.file(${JSON.stringify(file)}).text()).claude
      const codex = await updateChatAgentLaunch('codex', { claudeChrome: true }).then(() => 'saved', (e) => e.message)
      await updateChatAgentLaunch('claude', { claudeChrome: false })
      console.log(JSON.stringify({ before, on, saved, codex, off: await chatAgentLaunch('claude') }))
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, ZOMFY_HOME: home },
      stdout: "pipe",
      stderr: "inherit",
      windowsHide: true,
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stdout).json()]);
    expect(exit).toBe(0);
    expect(output).toEqual({
      before: { command: null, env: { CLAUDE_CONFIG_DIR: "x" } },
      on: { command: null, env: { CLAUDE_CONFIG_DIR: "x" }, claudeChrome: true },
      saved: { command: null, env: { CLAUDE_CONFIG_DIR: "x" }, claudeChrome: true },
      codex: "Invalid Claude in Chrome setting",
      off: { command: null, env: { CLAUDE_CONFIG_DIR: "x" } },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
