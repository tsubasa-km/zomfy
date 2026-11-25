import { t } from '@/i18n/i18n'
// Mentions in a message: `@path` for a workspace file (the composer's @ menu), `@…/attachments/…`
// for a snapshot of a terminal or another chat saved on the chat's host, and `@mcp:<server>` for one
// of the chat's MCP servers (the daemon tells the agent to use it). All travel as text; the
// composer and the transcript draw them as chips that lead back to what they name.

export type ChatMentionKind = 'file' | 'terminal' | 'chat' | 'mcp'

export interface ChatMention {
  kind: ChatMentionKind
  from: number
  to: number
  /** The workspace-relative file, the snapshot's path on the daemon host, or the MCP server's name. */
  path: string
  label: string
  /** The terminal or chat a snapshot came from. */
  sourceId?: string
}

/** `@<dir>/attachments/<chat>/<kind>/<source>/<14-digit time>-<title, spaces as _>.txt` */
const ATTACHMENT = /@(\S*?[\\/]attachments[\\/][\w-]+[\\/](terminal|chat)[\\/]([\w.-]+)[\\/]\d{14}-(\S+?)\.txt)(?=\s|$)/g
/** A completed `@path` (whitespace after it, or the end of a sent message), never an email's `@`. */
const FILE = /(?<=^|\s)@([^\s@`]+)(?=\s)/g
const FILE_AT_END = /(?<=^|\s)@([^\s@`]+)(?=\s|$)/g
/** `@mcp:<server>`, whitespace, `%`, `@` and backticks in the name percent-encoded; complete as a file's is. */
const MCP = /(?<=^|\s)@mcp:([^\s@`]+)(?=\s)/g
const MCP_AT_END = /(?<=^|\s)@mcp:([^\s@`]+)(?=\s|$)/g
const MCP_PREFIX = '@mcp:'

/** The server a mention's text names, or null when it is not valid percent-encoding. */
export function decodeMcpServer(encoded: string): string | null {
  try {
    const name = decodeURIComponent(encoded)
    return name.trim() ? name : null
  } catch {
    return null
  }
}

/** The text an MCP server's chip is written as, with a space after it. */
export function mcpMentionText(server: string): string {
  return `${MCP_PREFIX}${server.replace(/[\s%@`]/g,(c) => encodeURIComponent(c))} `
}

/** `sent`: the text is a sent message, so a mention may end it (a draft's last word may still be typed). */
export function parseChatMentions(text: string, { sent = false }: { sent?: boolean } = {}): ChatMention[] {
  const mentions: ChatMention[] = [...text.matchAll(ATTACHMENT)].map((m) => ({
    kind: m[2] === 'chat' ? 'chat' : 'terminal',
    from: m.index,
    to: m.index + m[0].length,
    path: m[1]!,
    label: m[4]!.replaceAll('_', ' '),
    sourceId: m[3]!
  }))
  for (const m of text.matchAll(sent ? MCP_AT_END : MCP)) {
    const server = decodeMcpServer(m[1]!)
    if (!server || mentions.some((a) => m.index >= a.from && m.index < a.to)) continue
    mentions.push({ kind: 'mcp', from: m.index, to: m.index + m[0].length, path: server, label: server })
  }
  for (const m of text.matchAll(sent ? FILE_AT_END : FILE)) {
    if (mentions.some((a) => m.index >= a.from && m.index < a.to)) continue
    const path = m[1]!
    mentions.push({ kind: 'file', from: m.index, to: m.index + m[0].length, path, label: path.split('/').at(-1) || path })
  }
  return mentions.sort((a, b) => a.from - b.from)
}

export function mentionText(path: string): string {
  return `@${path.replaceAll('\\', '/')} `
}

// lucide icons (file, square-terminal, message-square, plug) for chips drawn outside React.
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
export const MENTION_ICON_SVG: Record<ChatMentionKind, string> = {
  file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  terminal: svg('<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  mcp: svg('<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>')
}

export const MENTION_TITLE: Record<ChatMentionKind, string> = {
  file: t('File in this workspace'),
  terminal: t('Terminal snapshot'),
  chat: t('Thread transcript snapshot'),
  mcp: t('MCP server')
}
