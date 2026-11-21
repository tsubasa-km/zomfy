import { normalizeWrapUp, wrapUpOwner, type WrapUpCard, type WrapUpStep } from '@zomfy/protocol'

// The Next steps card's two sources: an agent's wrap_up call, and, for replies made without it,
// the recap agents end a turn with ("### ネクストステップ" + a numbered list tagged 〔owner〕).

export type { WrapUpCard }

/** A recap section folded into the card's summary: "やったこと", "確認状況"… */
export type RecapSection = { title: string; body: string }

/** A final message whose last section is a next-steps list, split into its parts. */
export type ParsedRecap = {
  /** What comes before the recap, shown as the reply. */
  lead: string
  /** The recap's other sections, folded. */
  sections: RecapSection[]
  steps: WrapUpStep[]
}

/** wrap_up as agents name it: `mcp__harness__wrap_up` in Claude, other prefixes elsewhere. */
export function isWrapUpTool(name: string): boolean {
  return /(^|[_.:/])wrap_up$/.test(name)
}

export function wrapUpCardOf(input: unknown): WrapUpCard | null {
  return normalizeWrapUp(input)
}

const NEXT_STEPS_TITLES = /^(ネクストステップ|次のステップ|次にやること|next\s+steps?)$/i
const RECAP_TITLES = /^(やったこと|やった事|実施内容|変更内容|確認状況|確認|検証|未確認|what\s+i\s+did|what\s+changed|changes|done|verification|status|checked)$/i

/** A heading line's title (`### Title`, `**Title**`, `Title:`-less), or null for any other line. */
function headingTitle(line: string): string | null {
  const hashed = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
  const bold = /^\s{0,3}\*\*(.+?)\*\*\s*[:：]?\s*$/.exec(line)
  const title = (hashed?.[1] ?? bold?.[1])
    ?.replace(/\*\*/g, '')
    .replace(/[:：]\s*$/, '')
    // "確認状況（今回）", "Next steps (for you)"
    .replace(/\s*[（(][^）)]*[）)]\s*$/, '')
    .trim()
  return title || null
}

/** A step: a list item at the margin; indented lines (wrapped text, a nested list) carry on the one above. */
const STEP_LINE = /^(?:\d+[.)]|[-*+])\s+(.*)$/
const OWNER_TAG = /^(?:〔([^〕]+)〕|【([^】]+)】|\[([^\]]+)\](?!\())\s*(.*)$/s

/**
 * The recap at the end of a final message, or null when the message does not end with a
 * next-steps list in the shape agents write it. Anything it cannot place keeps the whole message
 * as it was: after the list only blank lines and the list items' own continuation lines may follow.
 */
export function parseRecap(text: string): ParsedRecap | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let fence = false
  const headings: { index: number; title: string }[] = []
  for (const [index, line] of lines.entries()) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const title = headingTitle(line)
    if (title) headings.push({ index, title })
  }
  const last = headings.at(-1)
  if (!last || !NEXT_STEPS_TITLES.test(last.title)) return null

  const steps: WrapUpStep[] = []
  for (const line of lines.slice(last.index + 1)) {
    if (!line.trim()) continue
    const item = STEP_LINE.exec(line)
    if (item) {
      steps.push(stepOf(item[1]!))
      continue
    }
    const previous = steps.at(-1)
    if (!previous || !/^\s+/.test(line)) return null
    previous.text = `${previous.text} ${line.trim()}`
  }
  if (steps.length === 0) return null

  // The recap starts at the first of the known sections that run, unbroken, up to next steps.
  let start = last.index
  const sections: RecapSection[] = []
  for (let i = headings.length - 2; i >= 0; i -= 1) {
    const heading = headings[i]!
    if (!RECAP_TITLES.test(heading.title)) break
    sections.unshift({ title: heading.title, body: lines.slice(heading.index + 1, start).join('\n').trim() })
    start = heading.index
  }
  return { lead: lines.slice(0, start).join('\n').trim(), sections, steps }
}

function stepOf(raw: string): WrapUpStep {
  const tagged = OWNER_TAG.exec(raw.trim())
  if (!tagged) return { owner: 'agent', text: raw.trim() }
  const owner = (tagged[1] ?? tagged[2] ?? tagged[3] ?? '').trim()
  return { owner: owner ? wrapUpOwner(owner) : 'agent', text: (tagged[4] ?? '').trim() }
}
