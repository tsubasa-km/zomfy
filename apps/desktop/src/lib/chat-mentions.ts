import { t } from '@/i18n/i18n'
// Mentions in a message: `@path` for a workspace file (the composer's @ menu), and `@…/attachments/…`
// for a snapshot of a terminal or another chat saved on the chat's host. Both travel as text; the
// composer and the transcript draw them as chips that lead back to what they name.

export type ChatMentionKind = 'file' | 'terminal' | 'chat'

export interface ChatMention {
  kind: ChatMentionKind
  from: number
  to: number
  /** The workspace-relative file, or the snapshot's path on the daemon host. */
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

// lucide icons (file, square-terminal, message-square) for chips drawn outside React.
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
export const MENTION_ICON_SVG: Record<ChatMentionKind, string> = {
  file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  terminal: svg('<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>')
}

export const MENTION_TITLE: Record<ChatMentionKind, string> = {
  file: t('File in this workspace'),
  terminal: t('Terminal snapshot'),
  chat: t('Chat transcript snapshot')
}
