import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HARNESS_HOME } from './harness-home.ts'

/** Command output saved for a chat; Claude may read it without asking (an additional directory). */
export const TERMINAL_OUTPUT_DIR = join(HARNESS_HOME, 'terminal-output')

/** Writes `text` under the chat's folder, named after the time and the command; returns the path. */
export async function saveTerminalOutput(sessionId: string, title: string, text: string): Promise<string> {
  if (!/^[\w-]+$/.test(sessionId)) throw new Error('Invalid session id')
  const dir = join(TERMINAL_OUTPUT_DIR, sessionId)
  await mkdir(dir, { recursive: true })
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  // Spaces become `_` (shown as spaces again in the chat); characters no file name may hold become `-`.
  const slug = (title.trim() || 'output').replace(/\s+/g, '_').replace(/[\\/:*?"<>|%]/g, '-').slice(0, 60)
  const path = join(dir, `${stamp}-${slug}.txt`)
  await writeFile(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
  return path
}

const OUTPUT_MENTION = /@(\S*?[\/]terminal-output[\/][\w-]+[\/]\d{14}-\S+?\.txt)(?=\s|$)/g

/**
 * Claude Code inlines every @-mentioned file into the prompt; saved output is instead named as a
 * path the agent reads only as far as it needs. The transcript keeps the mention (shown as a chip).
 */
export function deferTerminalOutputMentions(text: string): string {
  return text.replace(OUTPUT_MENTION, (_, path: string) => `\`${path}\` (saved command output; read what you need)`)
}
