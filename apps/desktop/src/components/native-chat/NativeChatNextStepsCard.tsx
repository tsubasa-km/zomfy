import { useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronRight, ListTodo, MessageSquareReply, SquareArrowRight } from 'lucide-react'
import type { WrapUpStep } from '@zomfy/protocol'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { openInboxTodos, useInbox } from '@/stores/inbox-store'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { NativeChatCopyButton } from './NativeChatCopyButton'
import { NATIVE_CHAT_QUOTE_SOURCE_PROPS } from './NativeChatSelectionQuote'
import type { NextStepsRow } from './native-chat-transcript-model'
import type { RecapSection } from './next-steps'
import { t } from '@/i18n/i18n'

/** What the card does with a press; absent where the chat cannot take a prompt. */
export type NextStepsActions = {
  /** The chat's agent, as its own steps' chip names it. */
  agentName: string
  onFollowUp?: (text: string) => void
  /** Adds a step to the Inbox's To do list; settles once the daemon has it. */
  onAddTodo?: (text: string) => Promise<unknown>
}

/** The prompt "Ask to do this" sends; a step the agent offered, named so it knows which. */
export function stepFollowUp(step: WrapUpStep): string {
  return t('Please go ahead with this next step: {step}', { step: step.text })
}

const SMALL_BUTTON =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-chat-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60'

/**
 * A turn's Next steps, as the Claude app's wrap-up box: a short summary (or the folded recap),
 * each step with who owns it and a button to hand it on, and the agent's question as buttons.
 * A recap read from the reply keeps the reply itself one toggle away.
 */
export function NativeChatNextStepsCard({ row, rowKey, actions }: { row: NextStepsRow; rowKey: string; actions: NextStepsActions }) {
  const [original, setOriginal] = useState(false)
  const recap = row.recap
  if (recap && original) {
    return (
      <div className="group relative max-w-full text-sm leading-relaxed text-chat-foreground select-text" data-native-chat-message-text={recap.text}>
        <div {...NATIVE_CHAT_QUOTE_SOURCE_PROPS}>
          <NativeChatMarkdown rowKey={rowKey} content={recap.text} className="text-sm" />
        </div>
        <div data-native-chat-find-skip className="mt-1 flex w-fit items-center gap-1 select-none">
          <NativeChatCopyButton text={recap.text} />
          <button type="button" data-next-steps-original className={cn(SMALL_BUTTON, 'border-transparent bg-transparent text-chat-foreground-faint')} onClick={() => setOriginal(false)}>
            {t('Show as card')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-2" {...(recap ? { 'data-native-chat-message-text': recap.text } : {})}>
      {recap?.parsed.lead ? (
        <div className="max-w-full text-sm leading-relaxed text-chat-foreground select-text" {...NATIVE_CHAT_QUOTE_SOURCE_PROPS}>
          <NativeChatMarkdown rowKey={`${rowKey}:lead`} content={recap.parsed.lead} className="text-sm" />
        </div>
      ) : null}
      <section
        data-native-chat-next-steps
        aria-label={t('Next steps')}
        className="min-w-0 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm text-chat-foreground"
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-chat-foreground-faint">
          <SquareArrowRight aria-hidden className="size-3.5" />
          <span className="flex-1">{t('Next steps')}</span>
          {recap ? (
            <span data-native-chat-find-skip className="flex items-center gap-1 select-none">
              <NativeChatCopyButton text={recap.text} />
              <button
                type="button"
                data-next-steps-original
                className="rounded px-1 text-xs font-normal text-chat-foreground-faint transition-colors hover:text-chat-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => setOriginal(true)}
              >
                {t('Show original')}
              </button>
            </span>
          ) : null}
        </div>
        {row.card.summary ? <p className="mt-1.5 leading-relaxed break-words select-text">{row.card.summary}</p> : null}
        {recap && recap.parsed.sections.length > 0 ? <RecapSummary sections={recap.parsed.sections} rowKey={rowKey} /> : null}
        {row.card.steps.length > 0 ? (
          <ol className="mt-2 flex flex-col gap-1.5">
            {row.card.steps.map((step, index) => (
              <StepRow key={`${index}:${step.text}`} step={step} index={index} row={row} rowKey={rowKey} actions={actions} />
            ))}
          </ol>
        ) : null}
        {row.card.question ? <Question question={row.card.question} followUp={row.followUp} actions={actions} /> : null}
      </section>
    </div>
  )
}

function RecapSummary({ sections, rowKey }: { sections: RecapSection[]; rowKey: string }) {
  return (
    // Open at first: what was done and checked is the part of the recap read most (next-steps-card.md).
    <Collapsible defaultOpen className="mt-1.5">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-next-steps-recap
          className="group/recap flex min-h-6 w-full min-w-0 items-center gap-1 rounded-md text-left text-xs text-chat-foreground-faint transition-colors hover:text-chat-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRight aria-hidden className="size-3.5 shrink-0 transition-transform group-data-[state=open]/recap:rotate-90 motion-reduce:transition-none" />
          <span className="min-w-0 truncate">{sections.map((s) => s.title).join(' · ')}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex flex-col gap-2 border-l border-border pl-3 select-text">
          {sections.map((section, index) => (
            <div key={`${index}:${section.title}`} className="min-w-0">
              <p className="text-xs font-medium text-chat-foreground-faint">{section.title}</p>
              {section.body ? <NativeChatMarkdown rowKey={`${rowKey}:recap:${index}`} content={section.body} className="text-sm" /> : null}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function StepRow({ step, index, row, rowKey, actions }: { step: WrapUpStep; index: number; row: NextStepsRow; rowKey: string; actions: NextStepsActions }) {
  const [sent, setSent] = useState(false)
  const [adding, setAdding] = useState(false)
  // Done or not, a step already in the list was added: the button says so rather than adding it again.
  const inTodos = useInbox((s) => s.todos.some((todo) => todo.text === step.text))
  const mine = step.owner === 'agent'
  const prompt = stepFollowUp(step)
  const asked = sent || row.followUp === prompt
  return (
    <li className="flex min-w-0 items-start gap-2" data-next-step-owner={step.owner}>
      <span className="mt-0.5 w-4 shrink-0 text-right text-xs text-chat-foreground-faint tabular-nums">{index + 1}.</span>
      <OwnerChip owner={step.owner} agentName={actions.agentName} />
      <div className="min-w-0 flex-1 select-text [&_p]:my-0">
        <NativeChatMarkdown rowKey={`${rowKey}:step:${index}`} content={step.text} className="text-sm" />
      </div>
      {mine && actions.onFollowUp ? (
        <button
          type="button"
          data-next-step-ask
          disabled={asked}
          title={t('Sends {agent} a message in this chat asking it to do this step.', { agent: actions.agentName })}
          className={SMALL_BUTTON}
          onClick={() => {
            setSent(true)
            actions.onFollowUp?.(prompt)
          }}
        >
          {asked ? <Check aria-hidden className="size-3" /> : <MessageSquareReply aria-hidden className="size-3" />}
          {asked ? t('Asked') : t('Ask to do this')}
        </button>
      ) : null}
      {!mine && actions.onAddTodo ? (
        <button
          type="button"
          data-next-step-todo={inTodos ? 'added' : 'not-added'}
          disabled={adding}
          title={
            inTodos
              ? t('This step is in the To do list of your Inbox. Click to open it.')
              : t("Adds this step to the To do list in your Inbox (in the status bar), linked to this chat. Nothing is sent to {agent}.", {
                  agent: actions.agentName
                })
          }
          className={SMALL_BUTTON}
          onClick={() => {
            if (inTodos) return openInboxTodos()
            const add = actions.onAddTodo
            if (!add) return
            setAdding(true)
            add(step.text)
              .then(() => toast.success(t("Added to your Inbox's To do list"), { action: { label: t('Open Inbox'), onClick: openInboxTodos } }))
              .catch((error: unknown) =>
                toast.error(t('Could not add it to your Inbox'), { description: error instanceof Error ? error.message : String(error) })
              )
              .finally(() => setAdding(false))
          }}
        >
          {inTodos ? <Check aria-hidden className="size-3" /> : <ListTodo aria-hidden className="size-3" />}
          {inTodos ? t('In Inbox') : t('Add to Inbox')}
        </button>
      ) : null}
    </li>
  )
}

function OwnerChip({ owner, agentName }: { owner: string; agentName: string }) {
  const label = owner === 'agent' ? agentName : owner === 'person' ? t('You') : owner
  return (
    <span
      className={cn(
        'mt-0.5 max-w-28 shrink-0 truncate rounded-full px-1.5 py-px text-[length:var(--text-2xs)] leading-4 font-medium',
        owner === 'agent' ? 'bg-muted text-muted-foreground' : owner === 'person' ? 'bg-primary/15 text-primary' : 'bg-accent text-accent-foreground'
      )}
      title={label}
    >
      {label}
    </span>
  )
}

function Question({
  question,
  followUp,
  actions
}: {
  question: { text: string; options: string[] }
  followUp: string | undefined
  actions: NextStepsActions
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const answer = picked ?? (followUp !== undefined && question.options.includes(followUp) ? followUp : null)
  return (
    <div className="mt-2.5 border-t border-border pt-2" data-next-steps-question>
      <p className="font-medium break-words text-chat-foreground-strong select-text">{question.text}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {question.options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={!actions.onFollowUp || answer !== null}
            aria-pressed={answer === option}
            className={cn(
              'inline-flex min-h-7 items-center gap-1 rounded-md border px-2.5 py-1 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none',
              answer === option
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-chat-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50'
            )}
            onClick={() => {
              setPicked(option)
              actions.onFollowUp?.(option)
            }}
          >
            {answer === option ? <Check aria-hidden className="size-3" /> : null}
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
