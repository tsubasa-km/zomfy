import { QUESTION_OPTION_IDS } from '@zomfy/protocol'

// An agent's questions (Claude's AskUserQuestion), read from its permission ask, and the answers the
// person's picks make: an option's label, several joined by ", ", or their own words ("Other").

export interface AgentQuestionOption {
  label: string
  description: string
}

export interface AgentQuestion {
  question: string
  /** A short tag for the question (Claude keeps it to 12 characters). */
  header: string
  multiSelect: boolean
  allowOther?: boolean
  options: AgentQuestionOption[]
}

/** What the person has picked for one question. */
export interface QuestionPick {
  labels: string[]
  /** "Other" is picked; its words are `otherText`. */
  other: boolean
  otherText: string
}

export const EMPTY_PICK: QuestionPick = { labels: [], other: false, otherText: '' }

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The questions an ask carries; none when it is an ordinary tool approval. */
export function agentQuestionsOf(input: unknown): AgentQuestion[] {
  if (typeof input !== 'object' || input === null || !('questions' in input) || !Array.isArray(input.questions)) return []
  return input.questions.flatMap((q: unknown): AgentQuestion[] => {
    if (typeof q !== 'object' || q === null) return []
    const record = q as Record<string, unknown>
    const question = text(record.question).trim()
    if (!question) return []
    const options = Array.isArray(record.options)
      ? record.options.flatMap((o: unknown): AgentQuestionOption[] => {
          if (typeof o !== 'object' || o === null) return []
          const option = o as Record<string, unknown>
          const label = text(option.label).trim()
          return label ? [{ label, description: text(option.description) }] : []
        })
      : []
    return [{
      question, header: text(record.header), multiSelect: record.multiSelect === true, options,
      ...(record.allowOther === false ? { allowOther: false } : {})
    }]
  })
}

/** A pick after the person chose `label` (or "Other", with `label` null). */
export function togglePick(pick: QuestionPick, label: string | null, multiSelect: boolean): QuestionPick {
  if (!multiSelect) return label === null ? { ...pick, labels: [], other: true } : { ...pick, labels: [label], other: false }
  if (label === null) return { ...pick, other: !pick.other }
  return { ...pick, labels: pick.labels.includes(label) ? pick.labels.filter((l) => l !== label) : [...pick.labels, label] }
}

/** The answer a pick makes, in the options' order; empty while nothing is picked. */
export function answerOf(question: AgentQuestion, pick: QuestionPick): string {
  const labels = question.options.map((o) => o.label).filter((label) => pick.labels.includes(label))
  const own = pick.other ? pick.otherText.trim() : ''
  return [...labels, ...(own ? [own] : [])].join(', ')
}

/** Every question's answer, keyed by its text; null while one has none. */
export function answersOf(questions: AgentQuestion[], picks: QuestionPick[]): Record<string, string> | null {
  const answers: Record<string, string> = {}
  for (const [i, question] of questions.entries()) {
    const answer = answerOf(question, picks[i] ?? EMPTY_PICK)
    if (!answer) return null
    answers[question.question] = answer
  }
  return answers
}

/**
 * The questions of an ask the person answers by picking choices: only when the daemon takes answers
 * back (it offers the answer option); an older one's ask stays an approval.
 */
export function questionsToAnswer(ask: { input?: unknown; options: { optionId: string }[] }): AgentQuestion[] {
  return ask.options.some((o) => o.optionId === QUESTION_OPTION_IDS.answer) ? agentQuestionsOf(ask.input) : []
}
