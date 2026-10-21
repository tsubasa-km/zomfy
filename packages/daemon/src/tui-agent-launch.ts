import { tuiAgentSpec, type TerminalShellKind } from '@acp-harness/protocol'

// Ported from Orca's tui-agent-startup.ts / tui-agent-startup-shell.ts: the launch line is typed
// into the shell, so the prompt is quoted for whichever shell grammar will read it.

export interface AgentLaunchPlan {
  /** Typed into the shell, followed by Enter. */
  command: string
  /** Pasted once the agent is up, for CLIs that take no prompt argument. */
  followupPrompt: string | null
}

export function buildAgentLaunchPlan(agentId: string, prompt: string | undefined, shell: TerminalShellKind): AgentLaunchPlan {
  const spec = tuiAgentSpec(agentId)
  if (!spec) throw new Error(`Unknown agent ${agentId}`)
  const command = spec.launchCmd ?? spec.detectCmd
  const text = prompt?.trim() ?? ''
  if (!text) return { command, followupPrompt: null }
  const quoted = quoteShellArg(text, shell)
  switch (spec.promptInjectionMode) {
    case 'argv':
      return {
        command: `${command}${spec.argvPromptSeparator ? ` ${spec.argvPromptSeparator}` : ''} ${quoted}`,
        followupPrompt: null
      }
    case 'flag-prompt':
      return { command: `${command} --prompt ${quoted}`, followupPrompt: null }
    case 'flag-prompt-interactive':
      return { command: `${command} --prompt-interactive ${quoted}`, followupPrompt: null }
    case 'flag-interactive':
      return { command: `${command} -i ${quoted}`, followupPrompt: null }
    case 'stdin-after-start':
      return { command, followupPrompt: text }
  }
}

export function quoteShellArg(value: string, shell: TerminalShellKind): string {
  if (shell === 'powershell') return quotePowerShellLiteral(value)
  // cmd.exe cannot quote a newline; each would submit the line early.
  if (shell === 'cmd') return `"${value.replace(/[\r\n]+/g, ' ').replace(/([\^&|<>()%!"])/g, '^$1')}"`
  return quotePortableUnixArg(value)
}

/** Literal in sh, bash, zsh, dash and fish alike: backslashes and apostrophes leave the quotes. */
function quotePortableUnixArg(value: string): string {
  if (!value) return "''"
  const parts: string[] = []
  let literal = ''
  const flush = () => {
    if (literal) parts.push(`'${literal}'`)
    literal = ''
  }
  for (const char of value) {
    if (char === "'") {
      flush()
      parts.push(`"'"`)
    } else if (char === '\\') {
      flush()
      parts.push(`"\\\\"`)
    } else {
      literal += char
    }
  }
  flush()
  return parts.join('')
}

function quotePowerShellLiteral(value: string): string {
  if (/[\r\n]/.test(value)) {
    // A raw line break typed into PowerShell submits the line; backtick escapes keep it on one.
    const escaped = value.replace(/[`$"“”„\r\n]/g, (char) =>
      char === '\r' ? '`r' : char === '\n' ? '`n' : `\`${char}`
    )
    return `"${escaped}"`
  }
  // PowerShell also ends single-quoted strings at typographic single quotes.
  return `'${value.replace(/['‘’‚‛]/g, '$&$&')}'`
}
