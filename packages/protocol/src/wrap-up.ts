// The wrap_up tool's card: what an agent hands the person at the end of a working turn. The tool
// call itself is the transcript item (its input is kept and replayed like any call's), so the
// window reads this shape straight from the call's input.

/** 'agent': the agent can do it next; 'person': the person must do or decide it; else whoever is named. */
export type WrapUpOwner = 'agent' | 'person' | (string & {})

export interface WrapUpStep {
  owner: WrapUpOwner
  text: string
}

export interface WrapUpQuestion {
  text: string
  /** Two to four answers; pressing one sends it as the next prompt. */
  options: string[]
}

export interface WrapUpCard {
  summary: string
  steps: WrapUpStep[]
  question?: WrapUpQuestion
}

/** The tool as agents name it inside the harness MCP server. */
export const WRAP_UP_TOOL_NAME = 'wrap_up'

/** Appended to a chat's instructions so agents find the tool, which loads through tool search. */
export const WRAP_UP_HINT = `When you end a turn in which you worked (changed files, ran commands, investigated), call the \`harness\` wrap_up tool before your final message: a 2-3 sentence summary, the next steps with who owns each, and, only when the first step waits on the person, a question with answer options. It returns at once and shows the person a Next steps card under your reply.`

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * A wrap_up call's input as a card, or null when it has nothing to show. Lenient: an agent's odd
 * step or option is dropped, not the whole card; owner names are matched loosely ("Claude" is the agent).
 */
export function normalizeWrapUp(input: unknown): WrapUpCard | null {
  if (typeof input !== 'object' || input === null) return null
  const fields = input as Record<string, unknown>
  const summary = text(fields.summary) ?? ''
  const steps = (Array.isArray(fields.steps) ? fields.steps : []).flatMap((step): WrapUpStep[] => {
    if (typeof step === 'string') return text(step) ? [{ owner: 'agent', text: step.trim() }] : []
    if (typeof step !== 'object' || step === null) return []
    const s = step as Record<string, unknown>
    const body = text(s.text)
    return body ? [{ owner: wrapUpOwner(text(s.owner) ?? 'agent'), text: body }] : []
  })
  const q = typeof fields.question === 'object' && fields.question !== null ? (fields.question as Record<string, unknown>) : null
  const options = q && Array.isArray(q.options) ? q.options.map(text).filter((o): o is string => o !== null).slice(0, 4) : []
  const question = q && text(q.text) && options.length > 0 ? { text: text(q.text)!, options } : undefined
  if (!summary && steps.length === 0 && !question) return null
  return { summary, steps, ...(question ? { question } : {}) }
}

/** An owner as written by an agent or in a recap's 〔…〕 tag, as the card's kinds. */
export function wrapUpOwner(raw: string): WrapUpOwner {
  const name = raw.trim()
  const key = name.toLowerCase()
  if (['agent', 'claude', 'assistant', 'ai', 'codex', 'gemini', 'me', 'わたし', '私'].includes(key)) return 'agent'
  if (['person', 'you', 'user', 'あなた', 'ユーザー', '本人'].includes(key)) return 'person'
  return name
}
