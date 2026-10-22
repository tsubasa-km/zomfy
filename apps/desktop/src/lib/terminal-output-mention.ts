// A Run's saved output travels in a message as an @ mention of its file (the agent reads it like any
// mention); the composer and transcript show it as a chip named after the command instead.

/** `@<dir>/terminal-output/<chat>/<14-digit time>-<command, spaces as _>.txt` */
const MENTION = /@(\S*?[\\/]terminal-output[\\/][\w-]+[\\/]\d{14}-(\S+?)\.txt)(?=\s|$)/g

export function terminalOutputMention(path: string): string {
  return `@${path.replaceAll('\\', '/')} `
}

export interface TerminalOutputMentionMatch {
  from: number
  to: number
  path: string
  label: string
}

export function findTerminalOutputMentions(text: string): TerminalOutputMentionMatch[] {
  return [...text.matchAll(MENTION)].map((m) => ({
    from: m.index,
    to: m.index + m[0].length,
    path: m[1]!,
    label: m[2]!.replaceAll('_', ' ')
  }))
}

// lucide's square-terminal, for chips drawn outside React.
export const TERMINAL_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></svg>'
