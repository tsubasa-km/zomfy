import { useContext, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronRight, ListTodo, MessageSquareReply, SquareArrowRight } from 'lucide-react'
import { agentStepsOf, personActionsOf, type WrapUpStep } from '@zomfy/protocol'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { openInboxTodos, useInbox } from '@/stores/inbox-store'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { NativeChatCopyButton } from './NativeChatCopyButton'
import { NATIVE_CHAT_QUOTE_SOURCE_PROPS } from './NativeChatSelectionQuote'
import type { NextStepsRow } from './native-chat-transcript-model'
import { useWaitingGlow } from './composer-waiting-glow'
import { NextStepsGlowContext } from './waiting-glow-target'
import { t } from '@/i18n/i18n'

/** What the card does with a press; absent where the chat cannot take a prompt. */
export type NextStepsActions = {
  /** The chat's agent, as its own steps' line names it. */
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

const REVEAL =
  'transition-opacity can-hover:pointer-events-none can-hover:opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 [.group:has(:focus-visible)_&]:pointer-events-auto [.group:has(:focus-visible)_&]:opacity-100'

/**
 * A turn's Next steps: what the person should do next as the headline (or one line saying nothing
 * needs them), the agent's question as buttons, and the agent's own next steps quieter below
 * (next-steps-card.md). A recap read from the reply shows the reply above the card.
 */
export function NativeChatNextStepsCard({ row, rowKey, actions }: { row: NextStepsRow; rowKey: string; actions: NextStepsActions }) {
  // The thread's last card, its question unanswered, on the person's turn (composer-waiting-glow.md).
  const glow = useContext(NextStepsGlowContext) === row
  const recap = row.recap
  const yours = personActionsOf(row.card)
  const agents = agentStepsOf(row.card)
  const question = row.card.question
  const nothing = yours.length === 0 && !question
  return (
    <div className="flex min-w-0 flex-col gap-2" {...(recap ? { 'data-native-chat-message-text': recap.text } : {})}>
      {recap?.parsed.body ? (
        <div className="group relative max-w-full text-sm leading-relaxed text-chat-foreground select-text">
          <div {...NATIVE_CHAT_QUOTE_SOURCE_PROPS}>
            <NativeChatMarkdown rowKey={`${rowKey}:body`} content={recap.parsed.body} className="text-sm" />
          </div>
          <div data-native-chat-find-skip className={cn('mt-1 flex w-fit items-center gap-1 select-none', REVEAL)}>
            <NativeChatCopyButton text={recap.text} />
          </div>
        </div>
      ) : null}
      <section
        data-native-chat-next-steps
        data-next-steps-for={nothing ? 'agent' : 'person'}
        aria-label={t('Next steps')}
        className="min-w-0 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm text-chat-foreground"
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-chat-foreground-faint">
          <SquareArrowRight aria-hidden className="size-3.5" />
          <span className="flex-1">{nothing ? t('Next steps') : t('For you')}</span>
        </div>
        {nothing ? (
          <NothingForYou first={agents[0]} row={row} rowKey={rowKey} actions={actions} />
        ) : yours.length > 0 ? (
          <ol className="mt-1.5 flex flex-col gap-1.5">
            {yours.map((step, index) => (
              <PersonAction key={`${index}:${step.text}`} step={step} index={index} rowKey={rowKey} actions={actions} />
            ))}
          </ol>
        ) : null}
        {question ? <Question question={question} followUp={row.followUp} actions={actions} glow={glow} divided={yours.length > 0} /> : null}
        {nothing ? (
          agents.length > 1 ? (
            <AgentSteps label={t('Then, {agent} will:', { agent: actions.agentName })} steps={agents.slice(1)} row={row} rowKey={rowKey} actions={actions} ask />
          ) : null
        ) : agents.length > 0 ? (
          <AgentSteps label={t('Next, {agent} will:', { agent: actions.agentName })} steps={agents} row={row} rowKey={rowKey} actions={actions} ask={false} />
        ) : null}
        {row.card.summary ? <EarlierSummary summary={row.card.summary} /> : null}
      </section>
    </div>
  )
}

/** Nothing for the person: one line, naming what the agent goes on with. */
function NothingForYou({ first, row, rowKey, actions }: { first: WrapUpStep | undefined; row: NextStepsRow; rowKey: string; actions: NextStepsActions }) {
  if (!first) {
    return (
      <p data-next-steps-nothing className="mt-1.5 leading-relaxed">
        {t('Nothing needs you right now.')}
      </p>
    )
  }
  return (
    <div data-next-steps-nothing className="mt-1.5 flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1 leading-relaxed select-text [&_p]:my-0">
        <NativeChatMarkdown
          rowKey={`${rowKey}:nothing`}
          content={t('Nothing needs you — {agent} continues with: {step}', { agent: actions.agentName, step: first.text })}
          className="text-sm"
        />
      </div>
      <AskButton step={first} row={row} actions={actions} />
    </div>
  )
}

function PersonAction({ step, index, rowKey, actions }: { step: WrapUpStep; index: number; rowKey: string; actions: NextStepsActions }) {
  const [adding, setAdding] = useState(false)
  // Done or not, a step already in the list was added: the button says so rather than adding it again.
  const inTodos = useInbox((s) => s.todos.some((todo) => todo.text === step.text))
  return (
    <li className="flex min-w-0 items-start gap-2" data-next-step-owner={step.owner}>
      <span className="mt-px w-4 shrink-0 text-right text-sm font-medium text-chat-foreground-faint tabular-nums">{index + 1}.</span>
      {step.owner !== 'person' ? <OwnerChip owner={step.owner} /> : null}
      <div className="min-w-0 flex-1 font-medium text-chat-foreground-strong select-text [&_p]:my-0">
        <NativeChatMarkdown rowKey={`${rowKey}:step:${index}`} content={step.text} className="text-sm" />
      </div>
      {actions.onAddTodo ? (
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

/** The agent's own next steps: quieter, below the person's part; "Ask" only when nothing else waits. */
function AgentSteps({
  label,
  steps,
  row,
  rowKey,
  actions,
  ask
}: {
  label: string
  steps: WrapUpStep[]
  row: NextStepsRow
  rowKey: string
  actions: NextStepsActions
  ask: boolean
}) {
  const single = steps.length === 1 ? steps[0] : undefined
  return (
    <div data-next-steps-agent className="mt-2 border-t border-border/60 pt-1.5 text-xs text-chat-foreground-faint">
      {single ? (
        <div className="flex min-w-0 items-start gap-2" data-next-step-owner="agent">
          <div className="min-w-0 flex-1 leading-relaxed select-text [&_p]:my-0">
            <span className="mr-1">{label}</span>
            <span className="inline [&_div]:inline [&_p]:inline">
              <NativeChatMarkdown rowKey={`${rowKey}:agent:0`} content={single.text} className="text-xs" />
            </span>
          </div>
          {ask ? <AskButton step={single} row={row} actions={actions} /> : null}
        </div>
      ) : (
        <>
          <p>{label}</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {steps.map((step, index) => (
              <li key={`${index}:${step.text}`} className="flex min-w-0 items-start gap-1.5" data-next-step-owner="agent">
                <span aria-hidden className="shrink-0">
                  ·
                </span>
                <div className="min-w-0 flex-1 leading-relaxed select-text [&_p]:my-0">
                  <NativeChatMarkdown rowKey={`${rowKey}:agent:${index}`} content={step.text} className="text-xs" />
                </div>
                {ask ? <AskButton step={step} row={row} actions={actions} /> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function AskButton({ step, row, actions }: { step: WrapUpStep; row: NextStepsRow; actions: NextStepsActions }) {
  const [sent, setSent] = useState(false)
  if (!actions.onFollowUp) return null
  const prompt = stepFollowUp(step)
  const asked = sent || row.followUp === prompt
  return (
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
  )
}

/** Someone the person must chase, named on an older card's step. */
function OwnerChip({ owner }: { owner: string }) {
  return (
    <span
      className="mt-0.5 max-w-28 shrink-0 truncate rounded-full bg-accent px-1.5 py-px text-[length:var(--text-2xs)] leading-4 font-medium text-accent-foreground"
      title={owner}
    >
      {owner}
    </span>
  )
}

/** An older card's summary: kept, out of the way, so nothing it said is lost. */
function EarlierSummary({ summary }: { summary: string }) {
  return (
    <Collapsible className="mt-2 border-t border-border/60 pt-1">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-next-steps-summary
          className="group/summary flex min-h-6 w-full min-w-0 items-center gap-1 rounded-md text-left text-xs text-chat-foreground-faint transition-colors hover:text-chat-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRight aria-hidden className="size-3.5 shrink-0 transition-transform group-data-[state=open]/summary:rotate-90 motion-reduce:transition-none" />
          <span className="min-w-0 truncate">{t('Earlier summary')}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-0.5 pl-4.5 text-xs leading-relaxed break-words text-chat-foreground-faint select-text">{summary}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Question({
  question,
  followUp,
  actions,
  glow,
  divided
}: {
  question: { text: string; options: string[] }
  followUp: string | undefined
  actions: NextStepsActions
  glow: boolean
  /** Under the person's actions: a rule above; the card's headline otherwise. */
  divided: boolean
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const answer = picked ?? (followUp !== undefined && question.options.includes(followUp) ? followUp : null)
  const glowing = useWaitingGlow(glow && answer === null)
  return (
    <div className={divided ? 'mt-2.5 border-t border-border pt-2' : 'mt-1'}>
      {/* Its own border, clear until the question glows, so the glow moves nothing. */}
      <div
        data-next-steps-question
        data-waiting-glow={glowing}
        style={{ '--composer-glow-surface': 'color-mix(in oklab, var(--card) 60%, var(--chat-canvas))' } as React.CSSProperties}
        className="-mx-2 rounded-lg border border-transparent px-2 py-1.5"
      >
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
    </div>
  )
}
