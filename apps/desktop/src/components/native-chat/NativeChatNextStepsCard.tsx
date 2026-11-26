import { useContext, useState } from 'react'
import { toast } from 'sonner'
import { Check, ListChecks, ListPlus, Play } from 'lucide-react'
import { agentStepsOf, personActionsOf, type WrapUpStep } from '@zomfy/protocol'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
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
  /** The chat's agent's name, the tooltip of its steps' icon. */
  agentName: string
  /** The chat's agent (`claude`, `codex`…), whose icon marks its steps; Claude when absent. */
  agent?: string
  onFollowUp?: (text: string) => void
  /** Adds a step to the Inbox's To do list; settles once the daemon has it. */
  onAddTodo?: (text: string) => Promise<unknown>
}

/** The prompt "Ask to do this" sends; a step the agent offered, named so it knows which. */
export function stepFollowUp(step: WrapUpStep): string {
  return t('Please go ahead with this next step: {step}', { step: step.text })
}

const ICON_BUTTON =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none'

/** Shown while the pointer is on its line or focus is in it; always shown where nothing hovers. */
const REVEAL_ON_LINE =
  'transition-opacity can-hover:pointer-events-none can-hover:opacity-0 group-hover/line:pointer-events-auto group-hover/line:opacity-100 group-has-[:focus-visible]/line:pointer-events-auto group-has-[:focus-visible]/line:opacity-100'

const REVEAL =
  'transition-opacity can-hover:pointer-events-none can-hover:opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 [.group:has(:focus-visible)_&]:pointer-events-auto [.group:has(:focus-visible)_&]:opacity-100'

/**
 * A turn's Next steps (next-steps-card.md): the person's next actions are the card, numbered and
 * strong; the agent's question as buttons; the agent's own next steps quieter below, behind its
 * icon. No headings: whose step it is shows by weight and the agent's mark (ui-principles.md).
 */
export function NativeChatNextStepsCard({ row, rowKey, actions }: { row: NextStepsRow; rowKey: string; actions: NextStepsActions }) {
  // The thread's last card, its question unanswered, on the person's turn (composer-waiting-glow.md).
  const glow = useContext(NextStepsGlowContext) === row
  const recap = row.recap
  const yours = personActionsOf(row.card)
  const agents = agentStepsOf(row.card)
  const question = row.card.question
  const forPerson = yours.length > 0 || Boolean(question)
  const summary = row.card.summary
  const empty = !forPerson && agents.length === 0 && !summary
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
      {empty ? null : (
        <section
          data-native-chat-next-steps
          data-next-steps-for={forPerson ? 'person' : 'agent'}
          aria-label={t('Next steps')}
          className={cn(
            'min-w-0 rounded-lg border px-3 text-sm text-chat-foreground',
            // Only the agent goes on: the card steps back to a quiet line.
            forPerson ? 'border-border bg-card/60 py-2.5' : 'border-border/50 bg-transparent py-1.5'
          )}
        >
          {yours.length > 0 ? (
            <ol className="flex flex-col gap-1">
              {yours.map((step, index) => (
                <PersonAction key={`${index}:${step.text}`} step={step} index={index} rowKey={rowKey} actions={actions} />
              ))}
            </ol>
          ) : null}
          {question ? <Question question={question} followUp={row.followUp} actions={actions} glow={glow} divided={yours.length > 0} /> : null}
          {agents.length > 0 ? <AgentSteps steps={agents} row={row} rowKey={rowKey} actions={actions} ask={!forPerson} divided={forPerson} /> : null}
          {summary ? <EarlierSummary summary={summary} divided={forPerson || agents.length > 0} /> : null}
        </section>
      )}
    </div>
  )
}

function PersonAction({ step, index, rowKey, actions }: { step: WrapUpStep; index: number; rowKey: string; actions: NextStepsActions }) {
  const [adding, setAdding] = useState(false)
  // Done or not, a step already in the list was added: its mark stays, and opens the list.
  const inTodos = useInbox((s) => s.todos.some((todo) => todo.text === step.text))
  return (
    <li className="group/line flex min-w-0 items-start gap-2" data-next-step-owner={step.owner}>
      <span className="mt-px w-4 shrink-0 text-right text-sm font-semibold text-chat-foreground-faint tabular-nums">{index + 1}</span>
      {step.owner !== 'person' ? <OwnerChip owner={step.owner} /> : null}
      <div className="min-w-0 flex-1 font-medium text-chat-foreground-strong select-text [&_p]:my-0">
        <NativeChatMarkdown rowKey={`${rowKey}:step:${index}`} content={step.text} className="text-sm" />
      </div>
      {actions.onAddTodo ? (
        <button
          type="button"
          data-next-step-todo={inTodos ? 'added' : 'not-added'}
          disabled={adding}
          aria-label={inTodos ? t('In Inbox') : t('Add to Inbox')}
          title={inTodos ? t('In Inbox') : t('Add to Inbox')}
          className={cn(ICON_BUTTON, '-my-0.5', inTodos ? 'text-emerald-600 dark:text-emerald-400' : REVEAL_ON_LINE)}
          onClick={() => {
            if (inTodos) return openInboxTodos()
            const add = actions.onAddTodo
            if (!add) return
            setAdding(true)
            add(step.text)
              .then(() => toast.success(t('Added to Inbox'), { action: { label: t('Open Inbox'), onClick: openInboxTodos } }))
              .catch((error: unknown) =>
                toast.error(t('Could not add it to your Inbox'), { description: error instanceof Error ? error.message : String(error) })
              )
              .finally(() => setAdding(false))
          }}
        >
          {inTodos ? <ListChecks aria-hidden className="size-3.5" /> : <ListPlus aria-hidden className="size-3.5" />}
        </button>
      ) : null}
    </li>
  )
}

/** The agent's own next steps: smaller and fainter, behind the agent's icon; "Ask" only when nothing waits on the person. */
function AgentSteps({
  steps,
  row,
  rowKey,
  actions,
  ask,
  divided
}: {
  steps: WrapUpStep[]
  row: NextStepsRow
  rowKey: string
  actions: NextStepsActions
  ask: boolean
  /** Under the person's part: a rule above. */
  divided: boolean
}) {
  return (
    <div
      data-next-steps-agent
      aria-label={t('Next, {agent} will:', { agent: actions.agentName })}
      className={cn('flex min-w-0 items-start gap-2 text-xs text-chat-foreground-faint', divided && 'mt-2 border-t border-border/60 pt-1.5')}
    >
      <span className="mt-[3px] flex shrink-0 opacity-60" title={actions.agentName} aria-hidden="true">
        <TuiAgentIcon agent={actions.agent ?? 'claude'} size={12} />
      </span>
      <ul className="flex min-w-0 flex-1 flex-col gap-0.5">
        {steps.map((step, index) => (
          <li key={`${index}:${step.text}`} className="group/line flex min-w-0 items-start gap-1.5" data-next-step-owner="agent">
            <div className="min-w-0 flex-1 leading-relaxed select-text [&_p]:my-0">
              <NativeChatMarkdown rowKey={`${rowKey}:agent:${index}`} content={step.text} className="text-xs" />
            </div>
            {ask ? <AskButton step={step} row={row} actions={actions} /> : null}
          </li>
        ))}
      </ul>
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
      aria-label={asked ? t('Asked') : t('Ask to do this')}
      title={asked ? t('Asked') : t('Ask to do this')}
      className={cn(ICON_BUTTON, '-my-0.5 size-5', asked ? 'text-emerald-600 dark:text-emerald-400' : REVEAL_ON_LINE)}
      onClick={() => {
        setSent(true)
        actions.onFollowUp?.(prompt)
      }}
    >
      {asked ? <Check aria-hidden className="size-3" /> : <Play aria-hidden className="size-3" />}
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

/** An older card's summary: kept at the foot in faint small text, so nothing it said is lost. */
function EarlierSummary({ summary, divided }: { summary: string; divided: boolean }) {
  return (
    <p
      data-next-steps-summary
      className={cn('text-xs leading-relaxed break-words text-chat-foreground-faint select-text', divided && 'mt-2 border-t border-border/60 pt-1.5')}
    >
      {summary}
    </p>
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
    <div className={divided ? 'mt-2 border-t border-border pt-1.5' : '-mt-1'}>
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
