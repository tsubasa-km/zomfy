import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SaveChatAttachmentParams } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

/** Snapshots messages mention (terminal screens, chat transcripts); Claude may read them without asking. */
export const CHAT_ATTACHMENT_DIR = join(HARNESS_HOME, 'attachments')

/**
 * Writes the snapshot as `<chat>/<kind>/<source id>/<time>-<title>.txt`; the client reads kind,
 * source and title back out of the mention. Plain folders: Markdown and Claude's path checks both
 * read characters like `~` as something else. Returns the path.
 */
export async function saveChatAttachment(p: SaveChatAttachmentParams): Promise<string> {
  if (!/^[\w-]+$/.test(p.sessionId) || !/^[\w:.-]+$/.test(p.sourceId)) throw new Error('Invalid id')
  if (p.kind !== 'terminal' && p.kind !== 'chat') throw new Error('Invalid attachment kind')
  const dir = join(CHAT_ATTACHMENT_DIR, p.sessionId, p.kind, p.sourceId.replace(/:/g, '-'))
  await mkdir(dir, { recursive: true })
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  // Spaces become `_` (spaces again on the chip); characters no file name may hold, or that
  // Markdown reads as formatting, become `-`.
  const slug = (p.title.trim() || p.kind).replace(/\s+/g, '_').replace(/[\\/:*?"<>|%~`[\]]/g, '-').slice(0, 60)
  const path = join(dir, `${stamp}-${slug}.txt`)
  await writeFile(path, p.text.endsWith('\n') ? p.text : `${p.text}\n`, 'utf8')
  return path
}

const ATTACHMENT_MENTION = /@(\S*?[\\/]attachments[\\/][\w-]+[\\/](?:terminal|chat)[\\/][\w.-]+[\\/]\d{14}-\S+?\.txt)(?=\s|$)/g

/**
 * Claude Code inlines every @-mentioned file into the prompt; a snapshot is instead named as a
 * path the agent reads only as far as it needs. The transcript keeps the mention (a chip).
 */
export function deferAttachmentMentions(text: string): string {
  return text.replace(ATTACHMENT_MENTION, (_, path: string) => {
    const kind = /[\\/]chat[\\/]/.test(path) ? 'another chat' : 'a terminal'
    return `\`${path}\` (saved from ${kind}; read what you need)`
  })
}
