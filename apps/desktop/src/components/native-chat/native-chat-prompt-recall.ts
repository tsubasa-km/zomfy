import type { ThreadItem } from '@/session-store'
import { splitTaskNotifications } from './native-chat-task-notification'

// ArrowUp in an empty composer brings back the last prompt sent in the chat, again the one before;
// ArrowDown comes forward and, past the newest, empties the composer (as T3 Code's composer does).
// Once the text is edited the arrows move the caret as usual. Only the words come back, not the
// images sent with them.

/** The prompt an arrow brought back; it counts while the composer's text is still exactly it. */
export interface RecalledPrompt {
  index: number
  text: string
}

/** What the person typed in a chat, oldest first: a workflow's, another agent's or the CLI's own messages are not theirs to recall. */
export function sentPrompts(items: readonly ThreadItem[]): string[] {
  const prompts: string[] = []
  for (const item of items) {
    if (item.kind !== 'user' || item.origin || item.resumed) continue
    const text = splitTaskNotifications(item.text).rest.trim()
    if (text && prompts.at(-1) !== text) prompts.push(text)
  }
  return prompts
}

/**
 * What an arrow key does to the composer: the text to show and what is then recalled, 'hold' when
 * the key is taken and nothing changes (no older prompt), or null when the key is the caret's.
 */
export function recallStep(
  key: 'ArrowUp' | 'ArrowDown',
  draft: string,
  caret: number,
  recalled: RecalledPrompt | null,
  prompts: readonly string[]
): { text: string; recalled: RecalledPrompt | null } | 'hold' | null {
  const at = recalled && draft !== '' && recalled.text === draft ? recalled : null
  if (key === 'ArrowUp') {
    // Inside a recalled prompt of several lines the caret climbs to its first line first.
    if (at ? draft.slice(0, caret).includes('\n') : draft !== '') return null
    const index = at ? Math.min(at.index, prompts.length) - 1 : prompts.length - 1
    const text = prompts[index]
    if (text === undefined) return at ? 'hold' : null
    return { text, recalled: { index, text } }
  }
  if (!at || draft.slice(caret).includes('\n')) return null
  const text = prompts[at.index + 1]
  return text === undefined ? { text: '', recalled: null } : { text, recalled: { index: at.index + 1, text } }
}
