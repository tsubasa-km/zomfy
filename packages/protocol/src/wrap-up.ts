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

/**
 * A card as the window shows it. New calls send `personActions` (instructions to the person) and
 * `agentSteps`; both land in `steps`, the person's first, owned 'person' and 'agent'. Older calls
 * send `summary` and owner-tagged `steps`, kept as they were.
 */
export interface WrapUpCard {
  /** Older calls only; '' for new ones (the recap belongs in the reply). */
  summary: string
  steps: WrapUpStep[]
  question?: WrapUpQuestion
}

/** What the card leads with: the person's actions, and steps for someone they must chase. */
export function personActionsOf(card: WrapUpCard): WrapUpStep[] {
  return card.steps.filter((step) => step.owner !== 'agent')
}

/** The agent's own next steps, shown quieter below the person's. */
export function agentStepsOf(card: WrapUpCard): WrapUpStep[] {
  return card.steps.filter((step) => step.owner === 'agent')
}

/** The tool as agents name it inside the harness MCP server. */
export const WRAP_UP_TOOL_NAME = 'wrap_up'

/** Appended to a chat's instructions so agents find the tool, which loads through tool search. */
export const WRAP_UP_HINT = `When you end a turn in which you worked (changed files, ran commands, investigated), finish in this order. First write your complete answer as reply text, not in your thinking; what you did and checked belongs there. Only then, as the very last step, call the \`harness\` wrap_up tool (load it with tool search at that point if it is not loaded). It shows the person a Next steps card that holds only what comes next: personActions, what the person should do next as short instructions to them ("Update the app to 0.2.60", "Decide X"), empty if nothing needs them; optionally agentSteps, your own next steps; and, when their first action is a decision, a question with answer options. After it, end the turn without repeating your answer (one short line at most).`

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
  const list = (value: unknown, owner: WrapUpOwner): WrapUpStep[] =>
    (Array.isArray(value) ? value : []).flatMap((step): WrapUpStep[] => {
      if (typeof step === 'string') return text(step) ? [{ owner, text: step.trim() }] : []
      if (typeof step !== 'object' || step === null) return []
      const s = step as Record<string, unknown>
      const body = text(s.text)
      return body ? [{ owner: wrapUpOwner(text(s.owner) ?? owner), text: body }] : []
    })
  // New calls: the person's actions, then the agent's; older ones: owner-tagged steps.
  const steps = [...list(fields.personActions, 'person'), ...list(fields.agentSteps, 'agent'), ...list(fields.steps, 'agent')]
  const q = typeof fields.question === 'object' && fields.question !== null ? (fields.question as Record<string, unknown>) : null
  const options = q && Array.isArray(q.options) ? q.options.map(text).filter((o): o is string => o !== null).slice(0, 4) : []
  const question = q && text(q.text) && options.length > 0 ? { text: text(q.text)!, options } : undefined
  // An empty personActions is a card too: it says nothing needs the person.
  if (!summary && steps.length === 0 && !question && !Array.isArray(fields.personActions)) return null
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
