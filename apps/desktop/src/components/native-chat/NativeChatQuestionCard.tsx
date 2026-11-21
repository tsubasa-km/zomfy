import { useState } from 'react'
import { Check, MessageCircleQuestion } from 'lucide-react'
import { QUESTION_OPTION_IDS } from '@zomfy/protocol'
import { answerPermission } from '@/daemon-connection'
import type { ThreadItem } from '@/session-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'
import { answersOf, EMPTY_PICK, togglePick, type AgentQuestion, type QuestionPick } from './agent-questions'

type Permission = Extract<ThreadItem, { kind: 'permission' }>

// An agent's questions (Claude's AskUserQuestion) in place of an approval card, as the Claude apps
// show them: each question with its choices and an "Other" to answer in the person's own words.
// Sending gives the agent the answers; skipping tells it the person did not answer.

function Choice({
  selected,
  multiSelect,
  label,
  description,
  onPick,
  data
}: {
  selected: boolean
  multiSelect: boolean
  label: string
  description?: string
  onPick: () => void
  data: string
}) {
  return (
    <button
      type="button"
      role={multiSelect ? 'checkbox' : 'radio'}
      aria-checked={selected}
      data-question-option={data}
      onClick={onPick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-accent'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
          multiSelect ? 'rounded-[4px]' : 'rounded-full',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium break-words text-foreground">{label}</span>
        {description ? <span className="block text-xs break-words text-muted-foreground">{description}</span> : null}
      </span>
    </button>
  )
}

function QuestionBlock({ question, pick, onPick }: { question: AgentQuestion; pick: QuestionPick; onPick: (pick: QuestionPick) => void }) {
  return (
    <div role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.question} className="flex flex-col gap-1.5" data-agent-question>
      <div className="flex min-w-0 items-start gap-2">
        {question.header ? (
          <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{question.header}</span>
        ) : null}
        <p className="min-w-0 text-sm font-semibold break-words text-foreground">
          {question.question}
          {question.multiSelect ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t('Pick any that apply')}</span> : null}
        </p>
      </div>
      {question.options.map((option) => (
        <Choice
          key={option.label}
          data={option.label}
          selected={pick.labels.includes(option.label)}
          multiSelect={question.multiSelect}
          label={option.label}
          description={option.description}
          onPick={() => onPick(togglePick(pick, option.label, question.multiSelect))}
        />
      ))}
      <Choice
        data="other"
        selected={pick.other}
        multiSelect={question.multiSelect}
        label={t('Other')}
        onPick={() => onPick(togglePick(pick, null, question.multiSelect))}
      />
      {pick.other ? (
        <input
          autoFocus
          type="text"
          value={pick.otherText}
          aria-label={t('Your answer to "{question}"', { question: question.question })}
          placeholder={t('Type your answer')}
          data-question-other-input
          onChange={(e) => onPick({ ...pick, otherText: e.target.value })}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : null}
    </div>
  )
}

export function NativeChatQuestionCard({ permission, questions, from }: { permission: Permission; questions: AgentQuestion[]; from?: string }) {
  const [picks, setPicks] = useState<QuestionPick[]>(() => questions.map(() => EMPTY_PICK))
  const answers = answersOf(questions, picks)
  return (
    <div className="min-h-0 shrink overflow-hidden bg-chat-canvas">
      <div className="mx-auto flex h-full max-h-full min-h-0 w-full max-w-(--chat-content-max-width) px-3 pt-2 pb-1 sm:px-4">
        <div
          role="group"
          aria-label={t('Questions from the agent')}
          data-question-card
          className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden rounded-lg border border-input bg-card px-4 py-3 shadow-xs"
        >
          <div className="flex shrink-0 items-center gap-2">
            <MessageCircleQuestion className="size-4 shrink-0 text-agent-question-text" />
            <div className="min-w-0 flex-1">
              {from ? (
                <p className="truncate text-xs text-muted-foreground" data-approval-from>
                  {t('From "{helper}", working for this thread', { helper: from })}
                </p>
              ) : null}
              <p className="text-sm font-semibold text-foreground">
                {questions.length === 1 ? t('The agent has a question') : t('The agent has {n} questions', { n: questions.length })}
              </p>
            </div>
          </div>
          <div className="scrollbar-sleek flex min-h-0 flex-col gap-4 overflow-y-auto">
            {questions.map((question, i) => (
              <QuestionBlock
                key={question.question}
                question={question}
                pick={picks[i] ?? EMPTY_PICK}
                onPick={(pick) => setPicks((all) => all.map((p, j) => (j === i ? pick : p)))}
              />
            ))}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              data-approval-option={QUESTION_OPTION_IDS.answer}
              disabled={!answers}
              onClick={() => answers && answerPermission(permission.requestId, QUESTION_OPTION_IDS.answer, answers)}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              {t('Send answers')}
            </button>
            <button
              type="button"
              data-approval-option={QUESTION_OPTION_IDS.skip}
              onClick={() => answerPermission(permission.requestId, QUESTION_OPTION_IDS.skip)}
              className="rounded-md border border-border bg-background px-4 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('Skip')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
