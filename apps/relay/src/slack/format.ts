// What the relay posts in Slack (docs/specs/bots/sources/slack.md): Markdown turned into mrkdwn,
// answers cut into 3,000-character sections, and the Block Kit for status, Stop, questions,
// approvals and access requests. Button ids are Discord's (`z1:<prompt>:<i>`, `z1s:<turn>`,
// `z1r:<bot>`), so one parser reads both.

import type { Prompt } from '../contract'
import { customId } from '../discord/format'
import { splitMessage } from '../discord/format'
import type { Style } from '../sources/common'

/** A section's text limit. */
export const SECTION_LIMIT = 3000
/** Sections in one message; an answer that needs more is uploaded as a file. */
export const MAX_SECTIONS = 10
/** Slack's action_id limit. */
export const ACTION_ID_LIMIT = 255

export const slackStyle: Style = {
  small: (text) => `_${text}_`,
  time: (ms) => `<!date^${Math.floor(ms / 1000)}^{date_short_pretty} {time}|${new Date(ms).toISOString()}>`
}

/** Escapes the three characters Slack reads as control. */
export const escapeSlack = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Markdown as Slack's mrkdwn: `**bold**` → `*bold*`, `[t](u)` → `<u|t>`, headings → bold lines,
 * `~~x~~` → `~x~`, `- item` → `• item`. Code spans and blocks are kept as they are (escaped).
 */
export function toMrkdwn(markdown: string): string {
  const out: string[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      out.push(line.trim().startsWith('~~~') ? '```' : '```')
      continue
    }
    if (inFence) {
      out.push(escapeSlack(line))
      continue
    }
    // Split out code spans so their insides stay literal.
    const parts = line.split(/(`[^`]*`)/)
    const converted = parts
      .map((part, i) => {
        if (i % 2 === 1) return escapeSlack(part)
        let t = escapeSlack(part)
        t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<$2|$1>')
        t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<$2|$1>')
        t = t.replace(/\*\*([^*]+)\*\*/g, '*$1*').replace(/__([^_]+)__/g, '*$1*')
        t = t.replace(/~~([^~]+)~~/g, '~$1~')
        return t
      })
      .join('')
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(converted)
    if (heading) out.push(`*${heading[1]!.replace(/\*/g, '')}*`)
    else out.push(converted.replace(/^(\s*)[-*+]\s+\[([ xX])\]\s+/, (_m, indent, mark) => `${indent}${mark === ' ' ? '☐' : '☑'} `).replace(/^(\s*)[-*+]\s+/, '$1• '))
  }
  return out.join('\n')
}

export type Block = Record<string, unknown>

const plain = (text: string) => ({ type: 'plain_text', text: text.length > 75 ? `${text.slice(0, 74)}…` : text || '…', emoji: true })
const section = (text: string): Block => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, SECTION_LIMIT) || ' ' } })
const contextLine = (text: string): Block => ({ type: 'context', elements: [{ type: 'mrkdwn', text: text.slice(0, SECTION_LIMIT) }] })

/** A message's sections from Markdown; more than MAX_SECTIONS means the answer goes as a file. */
export function answerSections(markdown: string): string[] {
  return splitMessage(toMrkdwn(markdown), SECTION_LIMIT)
}

export function textBlocks(sections: string[]): Block[] {
  return sections.map(section)
}

/** The fallback `text` of a message (notifications, screen readers). */
export const fallback = (text: string) => (text.length > 3000 ? `${text.slice(0, 2999)}…` : text)

/** A key that fits an action_id: the id itself when short enough, else `#<n>`. */
export function slackKey(id: string, n: number): string {
  return id.length + 12 <= ACTION_ID_LIMIT && !id.includes(':') ? id : `#${n}`
}

export function statusBlocks(line: string, steps: { text: string; status: string }[], turnKey: string | null): Block[] {
  const blocks: Block[] = [contextLine(`:hourglass_flowing_sand: ${escapeSlack(line)}`)]
  if (steps.length) {
    const mark = (s: string) => (s === 'done' ? ':white_check_mark:' : s === 'running' ? ':arrow_forward:' : s === 'failed' ? ':x:' : ':white_large_square:')
    blocks.push(section(steps.map((s) => `${mark(s.status)} ${escapeSlack(s.text)}`).join('\n')))
  }
  if (turnKey) {
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: plain('Stop'), style: 'danger', action_id: customId.stop(turnKey), value: turnKey }] })
  }
  return blocks
}

export function accessBlocks(text: string, botId: string): Block[] {
  return [section(text), { type: 'actions', elements: [{ type: 'button', text: plain('Request access'), style: 'primary', action_id: customId.access(botId), value: botId }] }]
}

function optionStyle(kind: string | undefined, label: string): 'primary' | 'danger' | undefined {
  const k = `${kind ?? ''} ${label}`.toLowerCase()
  if (/deny|reject|cancel/.test(k)) return 'danger'
  if (/allow|approve|accept|yes/.test(k)) return 'primary'
  return undefined
}

/** The message showing a question or approval: one button per option, and Answer in Zomfy. */
export function promptMessage(prompt: Prompt, promptKey: string, botName: string): { text: string; blocks: Block[] } {
  if (prompt.kind === 'unsupported') {
    const text = `*${escapeSlack(botName)}* needs you in Zomfy:\n${toMrkdwn(prompt.text)}`
    return { text: fallback(`${botName} needs you in Zomfy`), blocks: [section(text), contextLine('Open the chat in Zomfy to answer.')] }
  }
  const head =
    prompt.kind === 'approval'
      ? `*${escapeSlack(botName)}* asks to use *${escapeSlack(prompt.tool)}*:\n${toMrkdwn(prompt.summary)}`
      : `${prompt.header ? `*${escapeSlack(prompt.header)}*\n` : ''}${toMrkdwn(prompt.text)}`
  const buttons = prompt.options.slice(0, 24).map((o, i) => {
    const style = optionStyle(o.kind, o.label)
    return { type: 'button', text: plain(o.label), action_id: customId.option(promptKey, i), value: String(i), ...(style ? { style } : {}) }
  })
  buttons.push({ type: 'button', text: plain('Answer in Zomfy'), action_id: customId.option(promptKey, 'z'), value: 'z' })
  const blocks: Block[] = [section(head), { type: 'actions', elements: buttons }]
  if (prompt.kind === 'question' && prompt.byReply) blocks.push(contextLine('Reply in this thread to answer.'))
  return { text: fallback(prompt.kind === 'approval' ? `${botName} asks to use ${prompt.tool}` : prompt.text), blocks }
}

/** The prompt once answered: its text, without buttons, and who answered. */
export function clearedPrompt(prompt: Prompt, botName: string, note: string): { text: string; blocks: Block[] } {
  const shown = promptMessage(prompt, '-', botName)
  return { text: shown.text, blocks: [shown.blocks[0]!, contextLine(note)] }
}

export const noteBlocks = (text: string): Block[] => [section(text)]
