import type { ShellOption } from '@acp-harness/protocol'
import { t } from '@/i18n/i18n'

// Which code fences a chat can run in a terminal, in which of the host's shells, and what gets
// typed. Kept free of React and the store so the parsing is testable.

export type CommandShellFamily = 'posix' | 'powershell' | 'cmd'

const FAMILY_BY_LANGUAGE: Record<string, CommandShellFamily> = {
  bash: 'posix',
  sh: 'posix',
  shell: 'posix',
  zsh: 'posix',
  console: 'posix',
  'shell-session': 'posix',
  shellsession: 'posix',
  powershell: 'powershell',
  pwsh: 'powershell',
  ps1: 'powershell',
  ps: 'powershell',
  cmd: 'cmd',
  bat: 'cmd',
  batch: 'cmd'
}

/** Transcript languages: prompts mark commands, everything else is output. */
const SESSION_LANGUAGES = new Set(['console', 'shell-session', 'shellsession'])

export function commandShellFamily(language: string | undefined): CommandShellFamily | null {
  return language ? (FAMILY_BY_LANGUAGE[language.trim().toLowerCase()] ?? null) : null
}

/** `prompt` strips a prompt; `marks` says a block is a transcript even under a plain shell tag. */
const PROMPTS: Partial<Record<CommandShellFamily, { prompt: RegExp; marks: RegExp }>> = {
  // `$ ` and `> ` (a continuation line).
  posix: { prompt: /^\s*[$>](?: |$)/, marks: /^\s*\$ / },
  // `PS C:\x> `.
  powershell: { prompt: /^\s*PS(?: [^>]*)?> ?/, marks: /^\s*PS(?: [^>]*)?> / }
}

/** The command lines of a block, prompts and output dropped; empty when nothing is runnable. */
export function runnableCommandLines(code: string, language: string | undefined): string[] {
  const family = commandShellFamily(language)
  if (!family || !language) return []
  const lines = code.replace(/\r\n?/g, '\n').split('\n')
  const prompts = PROMPTS[family]
  const transcript =
    prompts && (SESSION_LANGUAGES.has(language.trim().toLowerCase()) || lines.some((line) => prompts.marks.test(line)))
  const picked = transcript ? transcriptCommands(lines, prompts.prompt) : lines
  // Leading and trailing blank lines are fence padding, not part of the script.
  let start = 0
  let end = picked.length
  while (start < end && !picked[start].trim()) start++
  while (end > start && !picked[end - 1].trim()) end--
  return picked.slice(start, end).map((line) => line.replace(/\s+$/, ''))
}

function transcriptCommands(lines: string[], prompt: RegExp): string[] {
  const out: string[] = []
  let continued = false
  for (const line of lines) {
    const match = prompt.exec(line)
    if (match) {
      const command = line.slice(match[0].length)
      if (command.trim()) out.push(command)
      continued = /\\$|`$/.test(command.trimEnd())
    } else if (continued) {
      // A backslash (or PowerShell backtick) carried the command onto this unprompted line.
      out.push(line)
      continued = /\\$|`$/.test(line.trimEnd())
    }
  }
  return out
}

/** The host shell for a family: Git Bash stands in for a POSIX shell on Windows. */
export function pickCommandShell(family: CommandShellFamily, shells: readonly ShellOption[]): ShellOption | null {
  const byId = (...ids: string[]) => ids.map((id) => shells.find((s) => s.id === id)).find(Boolean) ?? null
  switch (family) {
    case 'powershell':
      return byId('pwsh', 'powershell')
    case 'cmd':
      return byId('cmd')
    case 'posix':
      // Windows hosts list pwsh/powershell/cmd/git-bash; POSIX hosts list their login shell.
      return byId('git-bash', 'login') ?? shells.find((s) => !['pwsh', 'powershell', 'cmd'].includes(s.id)) ?? null
  }
}

export function missingShellReason(family: CommandShellFamily): string {
  switch (family) {
    case 'powershell':
      return t('PowerShell is not available on this host')
    case 'cmd':
      return t('Command Prompt is only available on Windows hosts')
    case 'posix':
      return t('No POSIX shell on this host (install Git for Windows for Git Bash)')
  }
}

/**
 * What to type, Enter included. Several lines are wrapped in one group so the shell parses the
 * whole block before running any of it: a command that reads stdin cannot swallow the lines after
 * it. cmd.exe has no such group for typed input, so its lines run one by one.
 */
export function commandTerminalInput(lines: readonly string[], family: CommandShellFamily): string {
  if (lines.length === 1) return `${lines[0]}\r`
  switch (family) {
    case 'posix':
      return `{\r${lines.join('\r')}\r}\r`
    case 'powershell':
      // Dot-sourced so variables the block sets stay in the session, as if typed.
      return `. {\r${lines.join('\r')}\r}\r`
    case 'cmd':
      return `${lines.filter((line) => line.trim()).join('\r')}\r`
  }
}

/** The tab's title: the first command, shortened. */
export function commandTerminalTitle(lines: readonly string[]): string {
  const first = (lines.find((line) => line.trim() && !/^\s*(#|rem\b|::)/i.test(line)) ?? lines[0] ?? '').trim()
  const title = first.length > 40 ? `${first.slice(0, 39)}…` : first
  return lines.length > 1 ? `${title} …` : title
}
