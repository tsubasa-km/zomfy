// Agent CLIs a terminal tab can launch, ported from Orca's tui-agent-config.ts and agent catalog.
// Catalog order is Orca's: it is the order the launch menu lists detected agents in.

/** How the initial prompt reaches the CLI (Orca's `promptInjectionMode`). */
export type AgentPromptInjectionMode =
  | 'argv'
  | 'flag-prompt'
  | 'flag-prompt-interactive'
  | 'flag-interactive'
  | 'stdin-after-start'

export interface TuiAgentSpec {
  id: string
  label: string
  /** Binary probed on the daemon host's PATH. */
  detectCmd: string
  detectAliases?: readonly string[]
  /** Defaults to `detectCmd`. */
  launchCmd?: string
  promptInjectionMode: AgentPromptInjectionMode
  /** Separator before an argv prompt so text starting with `-` is not parsed as a flag. */
  argvPromptSeparator?: string
  homepageUrl: string
}

export const TUI_AGENTS = [
  { id: 'claude', label: 'Claude', detectCmd: 'claude', promptInjectionMode: 'argv', homepageUrl: 'https://code.claude.com/docs' },
  { id: 'codex', label: 'Codex', detectCmd: 'codex', promptInjectionMode: 'argv', homepageUrl: 'https://github.com/openai/codex' },
  { id: 'grok', label: 'Grok', detectCmd: 'grok', promptInjectionMode: 'argv', argvPromptSeparator: '--', homepageUrl: 'https://x.ai/cli' },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    detectCmd: 'copilot',
    promptInjectionMode: 'flag-interactive',
    homepageUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli'
  },
  { id: 'opencode', label: 'OpenCode', detectCmd: 'opencode', promptInjectionMode: 'flag-prompt', homepageUrl: 'https://opencode.ai/docs/cli/' },
  { id: 'pi', label: 'Pi', detectCmd: 'pi', promptInjectionMode: 'argv', homepageUrl: 'https://pi.dev' },
  {
    id: 'gemini',
    label: 'Gemini',
    detectCmd: 'gemini',
    promptInjectionMode: 'flag-prompt-interactive',
    homepageUrl: 'https://github.com/google-gemini/gemini-cli'
  },
  { id: 'aider', label: 'Aider', detectCmd: 'aider', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://aider.chat' },
  { id: 'goose', label: 'Goose', detectCmd: 'goose', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://block.github.io/goose/' },
  { id: 'amp', label: 'Amp', detectCmd: 'amp', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://ampcode.com' },
  { id: 'kilo', label: 'Kilocode', detectCmd: 'kilo', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://kilo.ai' },
  {
    id: 'kiro',
    label: 'Kiro',
    detectCmd: 'kiro-cli',
    launchCmd: 'kiro-cli chat --tui',
    promptInjectionMode: 'stdin-after-start',
    homepageUrl: 'https://kiro.dev/cli/'
  },
  { id: 'crush', label: 'Charm', detectCmd: 'crush', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://github.com/charmbracelet/crush' },
  { id: 'aug', label: 'Auggie', detectCmd: 'auggie', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://www.augmentcode.com' },
  { id: 'cline', label: 'Cline', detectCmd: 'cline', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://cline.bot' },
  { id: 'continue', label: 'Continue', detectCmd: 'cn', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://continue.dev' },
  { id: 'cursor', label: 'Cursor', detectCmd: 'cursor-agent', promptInjectionMode: 'argv', homepageUrl: 'https://cursor.com/cli' },
  { id: 'droid', label: 'Droid', detectCmd: 'droid', promptInjectionMode: 'argv', homepageUrl: 'https://factory.ai' },
  {
    id: 'kimi',
    label: 'Kimi',
    detectCmd: 'kimi',
    detectAliases: ['kimi-code'],
    promptInjectionMode: 'stdin-after-start',
    homepageUrl: 'https://github.com/MoonshotAI/kimi-cli'
  },
  {
    id: 'mistral-vibe',
    label: 'Mistral Vibe',
    detectCmd: 'vibe',
    detectAliases: ['mistral-vibe'],
    promptInjectionMode: 'stdin-after-start',
    homepageUrl: 'https://github.com/mistralai/mistral-vibe'
  },
  { id: 'qwen-code', label: 'Qwen Code', detectCmd: 'qwen', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://github.com/QwenLM/qwen-code' },
  {
    id: 'rovo',
    label: 'Rovo Dev',
    detectCmd: 'acli',
    launchCmd: 'acli rovodev run',
    promptInjectionMode: 'stdin-after-start',
    homepageUrl: 'https://www.atlassian.com/software/rovo-dev'
  },
  { id: 'devin', label: 'Devin', detectCmd: 'devin', promptInjectionMode: 'stdin-after-start', homepageUrl: 'https://devin.ai' }
] as const satisfies readonly TuiAgentSpec[]

export type TuiAgentId = (typeof TUI_AGENTS)[number]['id']

export function tuiAgentSpec(id: string): TuiAgentSpec | null {
  return TUI_AGENTS.find((agent) => agent.id === id) ?? null
}

export function isTuiAgentId(value: unknown): value is TuiAgentId {
  return typeof value === 'string' && tuiAgentSpec(value) !== null
}

/** Agent quick commands need the prompt on the launch command (Orca's `supportsTerminalAgentQuickCommand`). */
export function supportsAgentPromptQuickCommand(id: string): boolean {
  const spec = tuiAgentSpec(id)
  return spec !== null && spec.promptInjectionMode !== 'stdin-after-start'
}
