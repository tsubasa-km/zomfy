import { NotebookPen, ShieldQuestion } from 'lucide-react'
import { answerPermission } from '@/daemon-connection'
import type { ThreadItem } from '@/session-store'
import { cn } from '@/lib/utils'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { shortenPaths } from './native-chat-transcript-model'
import { t } from '@/i18n/i18n'

type Permission = Extract<ThreadItem, { kind: 'permission' }>

function planOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || !('plan' in input)) return null
  return typeof input.plan === 'string' && input.plan.trim() ? input.plan : null
}

/** Orca's NativeChatApprovalCard; an ExitPlanMode request shows the plan it asks to start. */
export function NativeChatApprovalCard({ permission, cwd }: { permission: Permission; cwd: string }) {
  // Allow first, as Orca puts the primary choice first.
  const options = [...permission.options].sort(
    (a, b) => Number(b.kind.startsWith('allow')) - Number(a.kind.startsWith('allow'))
  )
  const plan = planOf(permission.input)
  const Icon = plan ? NotebookPen : ShieldQuestion
  return (
    <div className="min-h-0 shrink overflow-hidden bg-chat-canvas">
      <div className="mx-auto flex h-full max-h-full min-h-0 w-full max-w-(--chat-content-max-width) px-3 pt-2 pb-1 sm:px-4">
        <div
          role="group"
          aria-label={permission.title}
          className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden rounded-lg border border-input bg-card px-4 py-3 shadow-xs"
        >
          <div className="flex shrink-0 items-start gap-2">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold break-words text-foreground">
                {plan ? permission.title : t('Allow {action}?', { action: shortenPaths(permission.title, cwd) })}
              </p>
            </div>
          </div>
          {plan ? (
            <div className="scrollbar-sleek max-h-72 min-h-0 overflow-y-auto rounded-md border border-border px-3 py-2 text-sm">
              <NativeChatMarkdown rowKey={`plan:${permission.requestId}`} content={plan} className="text-sm" />
            </div>
          ) : null}
          <div className="flex shrink-0 flex-wrap gap-2">
            {options.map((option, i) => (
              <button
                key={option.optionId}
                data-approval-option={option.optionId}
                type="button"
                onClick={() => answerPermission(permission.requestId, option.optionId)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
                  i === 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border bg-background text-foreground hover:bg-accent'
                )}
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
