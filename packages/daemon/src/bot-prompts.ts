// A bot chat's questions and approvals, mirrored to the conversation's source
// (docs/specs/bots/daemon.md#questions-and-approvals). Every permission ask already goes to every
// window and phone at once (ask-every-client.ts); this observer also sends it to the source as a
// `prompt` event, answers it from an `answer` delivery, and sends `prompt-cleared` however it ended,
// so the first answer wins on every side.

import type * as acp from '@agentclientprotocol/sdk'
import { CHAT_META, QUESTION_OPTION_IDS, type QuestionAnswers } from '@zomfy/protocol'
import { limits, type BotEvent, type Conversation, type Delivery, type Prompt } from '@zomfy/relay-contract'
import type { AskObserver, AskSettledBy } from './ask-every-client'
import type { DeliveryResult } from './connector-client'
import { QUESTION_TOOL } from './ask-user-question'
import { clipBytes } from './bot-deliveries'

interface Question {
  question: string
  header?: string
  options: { label: string }[]
  multiSelect?: boolean
}

interface Pending {
  conversation: Conversation
  sessionId: string
  prompt: Prompt
  /** The question's text, the key of its answer; null for an approval. */
  question: string | null
}

export interface BotPromptsDeps {
  /** The conversation a session is linked to and the bot turn running there, or null. */
  linkFor(sessionId: string): { conversation: Conversation; turnId: string } | null
  emit(event: BotEvent): void
  /** Answers the ask from the source; false when it is no longer waiting. */
  answer(askId: string, response: acp.RequestPermissionResponse): boolean
}

/** The questions of an AskUserQuestion call, as Claude passes them. */
function questionsOf(rawInput: unknown): Question[] {
  const list = (rawInput as { questions?: unknown } | null)?.questions
  if (!Array.isArray(list)) return []
  return list.flatMap((q): Question[] => {
    if (!q || typeof q !== 'object' || typeof (q as Question).question !== 'string') return []
    const options = Array.isArray((q as Question).options)
      ? (q as Question).options.filter((o) => o && typeof o.label === 'string').map((o) => ({ label: o.label }))
      : []
    return [{ question: (q as Question).question, header: (q as Question).header, options, multiSelect: (q as Question).multiSelect === true }]
  })
}

/** What an approval is about, in a line or two: the tool's title, then its command, path or plan. */
function approvalSummary(request: acp.RequestPermissionRequest): string {
  const input = (request.toolCall.rawInput ?? {}) as Record<string, unknown>
  const parts = [request.toolCall.title ?? 'A tool call']
  for (const key of ['command', 'file_path', 'path', 'url', 'plan', 'description']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() && !parts[0]!.includes(value)) {
      parts.push(key === 'plan' ? value : `${key}: ${value}`)
      break
    }
  }
  return clipBytes(parts.join('\n'), limits.maxPromptTextBytes)
}

/** The ask as the contract's `prompt`: an approval, a question, or `unsupported` for what a source cannot show. */
export function toPrompt(request: acp.RequestPermissionRequest): { prompt: Prompt; question: string | null } {
  const tool = (request.toolCall._meta?.[CHAT_META.toolName] as string | undefined) ?? null
  if (tool === QUESTION_TOOL) {
    const questions = questionsOf(request.toolCall.rawInput)
    const only = questions.length === 1 ? questions[0]! : null
    if (!only || only.options.length > 8) {
      const text = questions.length
        ? `${questions.length > 1 ? `${questions.length} questions` : 'A question'}; answer in Zomfy:\n${questions.map((q) => `- ${q.question}`).join('\n')}`
        : 'A question; answer it in Zomfy.'
      return { prompt: { kind: 'unsupported', text: clipBytes(text, limits.maxPromptTextBytes) }, question: null }
    }
    return {
      prompt: {
        kind: 'question',
        text: clipBytes(only.question, limits.maxPromptTextBytes),
        ...(only.header ? { header: only.header.slice(0, 256) } : {}),
        options: only.options.map((o, i) => ({ id: `q${i}`, label: o.label.slice(0, 256) })),
        // A free-text question, or one that takes several picks, is answered by a reply.
        byReply: only.options.length === 0 || only.multiSelect === true
      },
      question: only.question
    }
  }
  const options = request.options.slice(0, 8).map((o) => ({ id: o.optionId.slice(0, 128), label: o.name.slice(0, 256), kind: o.kind.slice(0, 32) }))
  return {
    prompt: { kind: 'approval', tool: (tool ?? request.toolCall.title ?? 'tool').slice(0, 256), summary: approvalSummary(request), options },
    question: null
  }
}

/** The answer of a question prompt from a pressed option or a reply: a number or a label picks that option. */
export function questionAnswer(prompt: Extract<Prompt, { kind: 'question' }>, optionId?: string, text?: string): string | null {
  if (optionId) return prompt.options.find((o) => o.id === optionId)?.label ?? null
  const reply = text?.trim()
  if (!reply) return null
  const n = /^\d+$/.test(reply) ? Number(reply) : NaN
  if (n >= 1 && n <= prompt.options.length) return prompt.options[n - 1]!.label
  return prompt.options.find((o) => o.label.toLowerCase() === reply.toLowerCase())?.label ?? reply
}

export class BotPrompts implements AskObserver {
  private readonly pending = new Map<string, Pending>()

  constructor(private readonly deps: BotPromptsDeps) {}

  asked(askId: string, request: acp.RequestPermissionRequest): void {
    const link = this.deps.linkFor(request.sessionId)
    if (!link) return
    const { prompt, question } = toPrompt(request)
    this.pending.set(askId, { conversation: link.conversation, sessionId: request.sessionId, prompt, question })
    this.deps.emit({ kind: 'prompt', conversation: link.conversation, sessionId: request.sessionId, turnId: link.turnId, promptId: askId, prompt })
  }

  settled(askId: string, _request: acp.RequestPermissionRequest, _response: acp.RequestPermissionResponse, by: AskSettledBy): void {
    const entry = this.pending.get(askId)
    if (!entry) return
    this.pending.delete(askId)
    this.deps.emit({
      kind: 'prompt-cleared',
      conversation: entry.conversation,
      promptId: askId,
      by: by === 'outside' ? 'source' : by === 'client' ? 'zomfy' : 'expired'
    })
  }

  /** Prompts still waiting, for tests. */
  waiting(): string[] {
    return [...this.pending.keys()]
  }

  /** An `answer` delivery: the option pressed or the reply typed in the source. */
  answer(delivery: Extract<Delivery, { kind: 'answer' }>): DeliveryResult {
    const entry = this.pending.get(delivery.promptId)
    // Answered already (in Zomfy, on a phone, or by an earlier press), or its turn ended.
    if (!entry) return { outcome: 'expired' }
    if (entry.conversation.source !== delivery.conversation.source || entry.conversation.externalId !== delivery.conversation.externalId) {
      return { outcome: 'unknown' }
    }
    const response = this.response(entry, delivery)
    if (!response) return { outcome: 'refused' }
    return this.deps.answer(delivery.promptId, response) ? { outcome: 'accepted' } : { outcome: 'expired' }
  }

  private response(entry: Pending, delivery: Extract<Delivery, { kind: 'answer' }>): acp.RequestPermissionResponse | null {
    const { prompt } = entry
    if (prompt.kind === 'approval') {
      const option = prompt.options.find((o) => o.id === delivery.optionId)
      return option ? { outcome: { outcome: 'selected', optionId: option.id } } : null
    }
    if (prompt.kind === 'question' && entry.question !== null) {
      const answer = questionAnswer(prompt, delivery.optionId, delivery.text)
      if (!answer) return null
      return {
        outcome: { outcome: 'selected', optionId: QUESTION_OPTION_IDS.answer },
        _meta: { [CHAT_META.answers]: { answers: { [entry.question]: answer } } satisfies QuestionAnswers }
      }
    }
    return null
  }
}
