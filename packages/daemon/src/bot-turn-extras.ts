// What a bot turn's reply carries besides its text (docs/specs/bots/daemon.md#turns-and-replies):
// links to the pull requests the turn opened, review notes the bot wrote for a pull request, its
// live activity, and where in a source a conversation's thread is.

import type * as acp from '@agentclientprotocol/sdk'
import { limits, type BotEvent, type Conversation } from '@zomfy/relay-contract'

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('\n')
  if (value && typeof value === 'object') {
    const v = value as { type?: string; text?: unknown; content?: unknown }
    if (typeof v.text === 'string') return v.text
    if (v.content !== undefined) return textOf(v.content)
  }
  return ''
}

/**
 * Pull requests the turn opened: URLs printed by a `gh pr create` (or a tool named for creating a
 * pull request), then any the reply itself names. At most `maxWorkLinks`.
 */
export function turnPrLinks(updates: acp.SessionUpdate[], reply: string): string[] {
  const opening = new Set<string>()
  const links: string[] = []
  const add = (text: string) => {
    for (const url of text.match(PR_URL) ?? []) if (!links.includes(url)) links.push(url)
  }
  for (const u of updates) {
    if (u.sessionUpdate !== 'tool_call' && u.sessionUpdate !== 'tool_call_update') continue
    const input = JSON.stringify(u.rawInput ?? '') + (u.title ?? '')
    if (u.sessionUpdate === 'tool_call' && /gh\s+pr\s+create|create_pull_request|createPullRequest/i.test(input)) opening.add(u.toolCallId)
    if (!opening.has(u.toolCallId)) continue
    add(textOf(u.content) + '\n' + textOf(u.rawOutput))
  }
  add(reply)
  return links.slice(0, limits.maxWorkLinks)
}

export interface ReviewNote {
  path: string
  line?: number
  side?: 'LEFT' | 'RIGHT'
  body: string
}

/** The fenced block a bot ends its reply with to leave review notes (the bot's AGENTS.md says how). */
const REVIEW_BLOCK = /```zomfy-review\s*\n([\s\S]*?)```\s*/

/** Takes the review notes out of a reply: the text without the block, and the notes it held. */
export function takeReviewNotes(reply: string): { text: string; notes: ReviewNote[] } {
  const match = REVIEW_BLOCK.exec(reply)
  if (!match) return { text: reply, notes: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1]!)
  } catch {
    return { text: reply, notes: [] }
  }
  const notes = (Array.isArray(parsed) ? parsed : []).flatMap((n): ReviewNote[] => {
    if (!n || typeof n !== 'object' || typeof n.path !== 'string' || typeof n.body !== 'string') return []
    const line = Number.isInteger(n.line) && n.line > 0 ? (n.line as number) : undefined
    return [
      {
        path: n.path.slice(0, limits.maxReviewNotePathChars),
        ...(line ? { line } : {}),
        ...(n.side === 'LEFT' || n.side === 'RIGHT' ? { side: n.side } : {}),
        body: n.body.slice(0, limits.maxReviewNoteChars)
      }
    ]
  })
  return { text: (reply.slice(0, match.index) + reply.slice(match.index + match[0].length)).trim(), notes: notes.slice(0, limits.maxReviewNotes) }
}

type Steps = Extract<BotEvent, { kind: 'activity' }>['steps']

const STEP_STATUS: Record<string, Steps[number]['status']> = { pending: 'pending', in_progress: 'running', completed: 'done', failed: 'failed' }

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > limits.maxActivityChars ? `${line.slice(0, limits.maxActivityChars - 1)}…` : line
}

/** The activity a turn shows in its source's status message: its latest tool call and its plan. */
export class TurnActivity {
  text = ''
  steps: Steps = []
  private readonly titles = new Map<string, string>()

  /** Takes one update; true when what the source would show changed. */
  take(update: acp.SessionUpdate): boolean {
    const before = JSON.stringify([this.text, this.steps])
    if (update.sessionUpdate === 'tool_call') {
      this.titles.set(update.toolCallId, update.title)
      this.text = clip(update.title)
    } else if (update.sessionUpdate === 'tool_call_update' && update.title) {
      this.titles.set(update.toolCallId, update.title)
      this.text = clip(update.title)
    } else if (update.sessionUpdate === 'plan') {
      this.steps = update.entries.slice(0, limits.maxActivitySteps).map((e) => ({ text: clip(e.content), status: STEP_STATUS[e.status] ?? 'pending' }))
    } else {
      return false
    }
    return JSON.stringify([this.text, this.steps]) !== before
  }
}

/** Where a conversation's thread is, as a ref the source's `reply` and `post` take; null when it has none. */
export function conversationRef(conversation: Conversation): string | null {
  const parts = conversation.externalId.split(':')
  switch (conversation.source) {
    case 'slack':
      return parts.length === 3 ? `slack:${conversation.externalId}` : null
    case 'github':
      return /^[^:]+:[^/:\s]+\/[^/:\s]+:\d+$/.test(conversation.externalId) ? `github:${conversation.externalId}` : null
    case 'linear':
      return parts.length === 2 ? `linear:${conversation.externalId}` : null
    case 'discord':
      // A mention's thread is started from its message and takes the message's id.
      return parts.length === 3 && /^\d+$/.test(parts[2]!) ? `discord:${parts[0]}:${parts[1]}:${parts[2]}` : null
    default:
      return null
  }
}
