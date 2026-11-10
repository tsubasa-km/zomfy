import { useState } from 'react'
import { ChevronRight, MessageCircleQuestion, Workflow } from 'lucide-react'
import type { PromptOrigin } from '@acp-harness/protocol'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { t } from '@/i18n/i18n'

// A prompt the harness wrote into a chat, not the person: a workflow step's question to the chat
// that started the run, or a step's instructions to its agent. It reads as a card from the left,
// apart from the person's own messages on the right.

export function NativeChatPromptOrigin({ origin, text, rowKey }: { origin: PromptOrigin; text: string; rowKey: string }) {
  if (origin.kind === 'step-question') {
    return (
      <div
        className="rounded-xl border border-border bg-muted/40 px-4 py-3"
        data-native-chat-prompt-origin="step-question"
        data-native-chat-message-text={text}
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-chat-foreground-faint">
          <MessageCircleQuestion className="size-3.5 shrink-0" />
          <span className="truncate">{t('Question from {from}', { from: senderLabel(origin.from) })}</span>
        </div>
        <NativeChatMarkdown rowKey={rowKey} content={origin.question} className="text-sm" />
      </div>
    )
  }
  return <StepTask origin={origin} text={text} />
}

/** "the workflow "X" (run …)" or ""step" (session …)" as the name alone. */
function senderLabel(from: string): string {
  const named = /^(?:the workflow )?"(.+)" \((?:run|session) [^)]+\)$/.exec(from)
  return named ? named[1]! : from
}

function StepTask({ origin, text }: { origin: Extract<PromptOrigin, { kind: 'step-task' }>; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-native-chat-prompt-origin="step-task" data-native-chat-message-text={text}>
      <CollapsibleTrigger className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-xs text-chat-foreground-faint hover:text-chat-foreground">
        <Workflow className="size-3.5 shrink-0" />
        <span className="truncate">{t('Instructions for "{step}" from the workflow "{workflow}"', { step: origin.step, workflow: origin.workflow })}</span>
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap text-chat-foreground select-text">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
