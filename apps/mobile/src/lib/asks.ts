// Pending asks (approvals and AskUserQuestion questions) across every paired host. The daemon asks
// every client at once and the first answer wins (permission-asks.ts); when another client answers,
// `_harness/permissions/resolved` names the ask and its card goes away here.

import type * as acp from '@agentclientprotocol/sdk'
import {
  CHAT_META,
  PERMISSION_ASK_META,
  QUESTION_OPTION_IDS,
  type PermissionAskResolved,
  type QuestionAnswers
} from '@zomfy/protocol'
import { Observable } from './observable'

export const QUESTION_TOOL = 'AskUserQuestion'

export interface QuestionOption {
  label: string
  description?: string
}

export interface AgentQuestion {
  question: string
  header?: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface PendingAsk {
  /** Unique across hosts: `<hostId>/<askId or local id>`. */
  key: string
  hostId: string
  sessionId: string
  /** The daemon's ask id (the same on every client); null from daemons that predate it. */
  askId: string | null
  title: string
  toolName?: string
  input: unknown
  options: acp.PermissionOption[]
  /** Set when the ask is an agent's questions rather than a tool to allow. */
  questions: AgentQuestion[] | null
  receivedAt: number
}

export type AskResponder = (response: acp.RequestPermissionResponse) => void

/** The questions of an AskUserQuestion ask, or null for any other ask. */
export function questionsOf(request: acp.RequestPermissionRequest): AgentQuestion[] | null {
  const toolName = request.toolCall._meta?.[CHAT_META.toolName]
  const input = request.toolCall.rawInput as { questions?: unknown } | null | undefined
  if (toolName !== QUESTION_TOOL || !Array.isArray(input?.questions)) return null
  const questions = input.questions.flatMap((raw): AgentQuestion[] => {
    const q = raw as Record<string, unknown> | null
    if (!q || typeof q.question !== 'string') return []
    const options = Array.isArray(q.options)
      ? q.options.flatMap((o): QuestionOption[] => {
          const option = o as Record<string, unknown> | null
          if (!option || typeof option.label !== 'string') return []
          return [{ label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) }]
        })
      : []
    return [
      {
        question: q.question,
        ...(typeof q.header === 'string' ? { header: q.header } : {}),
        options,
        multiSelect: q.multiSelect === true
      }
    ]
  })
  return questions.length > 0 ? questions : null
}

/** The response that answers an agent's questions; answers are keyed by question text. */
export function questionResponse(answers: Record<string, string>): acp.RequestPermissionResponse {
  const meta: QuestionAnswers = { answers }
  return { outcome: { outcome: 'selected', optionId: QUESTION_OPTION_IDS.answer }, _meta: { [CHAT_META.answers]: meta } }
}

export const skipQuestionsResponse = (): acp.RequestPermissionResponse => ({
  outcome: { outcome: 'selected', optionId: QUESTION_OPTION_IDS.skip }
})

export const optionResponse = (optionId: string): acp.RequestPermissionResponse => ({
  outcome: { outcome: 'selected', optionId }
})

export const cancelledResponse = (): acp.RequestPermissionResponse => ({ outcome: { outcome: 'cancelled' } })

export class AskStore {
  readonly asks = new Observable<readonly PendingAsk[]>([])
  private readonly responders = new Map<string, AskResponder>()
  private localIds = 0

  /** Records an ask; `respond` sends the answer back on the connection it came on. */
  add(hostId: string, request: acp.RequestPermissionRequest, respond: AskResponder, now = Date.now()): PendingAsk {
    const askIdValue = request._meta?.[PERMISSION_ASK_META.askId]
    const askId = typeof askIdValue === 'string' ? askIdValue : null
    const key = `${hostId}/${askId ?? `local-${++this.localIds}`}`
    const toolName = request.toolCall._meta?.[CHAT_META.toolName]
    const ask: PendingAsk = {
      key,
      hostId,
      sessionId: request.sessionId,
      askId,
      title: request.toolCall.title ?? 'Permission',
      ...(typeof toolName === 'string' ? { toolName } : {}),
      input: request.toolCall.rawInput ?? null,
      options: request.options,
      questions: questionsOf(request),
      receivedAt: now
    }
    this.responders.set(key, respond)
    this.asks.update((list) => [...list.filter((a) => a.key !== key), ask])
    return ask
  }

  /** Answers an ask from this phone; false when it is already gone (answered elsewhere). */
  answer(key: string, response: acp.RequestPermissionResponse): boolean {
    const respond = this.responders.get(key)
    if (!respond) return false
    this.remove(key)
    respond(response)
    return true
  }

  /** Another client answered (or the ask was withdrawn): close its card. */
  resolved(hostId: string, resolved: PermissionAskResolved): void {
    this.remove(`${hostId}/${resolved.askId}`)
  }

  /** The host's connection closed: its asks can no longer be answered on it. */
  dropHost(hostId: string): void {
    for (const ask of this.asks.get()) if (ask.hostId === hostId) this.responders.delete(ask.key)
    this.asks.update((list) => (list.some((a) => a.hostId === hostId) ? list.filter((a) => a.hostId !== hostId) : list))
  }

  forHost(hostId: string): PendingAsk[] {
    return this.asks.get().filter((a) => a.hostId === hostId)
  }

  forSession(hostId: string, sessionId: string): PendingAsk[] {
    return this.asks.get().filter((a) => a.hostId === hostId && a.sessionId === sessionId)
  }

  private remove(key: string): void {
    this.responders.delete(key)
    this.asks.update((list) => (list.some((a) => a.key === key) ? list.filter((a) => a.key !== key) : list))
  }
}
