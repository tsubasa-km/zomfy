import { BotMessageSquare } from 'lucide-react'
import { t } from '@/i18n/i18n'

const EXAMPLES = [
  t('What is every agent doing right now, on every host?'),
  t('Start Claude in a new worktree of <project> to fix <bug>, then report back when it is done.'),
  t('Which sessions are waiting on me, and what do they need?')
]

/** The Manager chat's empty state: what it can do, instead of this folder's past conversations. */
export function ManagerEmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center" data-manager-empty>
      <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <BotMessageSquare className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium">{t('Manager')}</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          {t(
            'Sees and drives agent sessions across this computer, WSL and SSH hosts: lists them, reads their transcripts, starts agents in workspaces, sends prompts, waits for results, and forwards decisions to your inbox.'
          )}
        </p>
      </div>
      <ul className="flex max-w-md flex-col gap-1 text-left text-xs text-muted-foreground">
        {EXAMPLES.map((example) => (
          <li key={example} className="rounded-md border border-border/60 px-2.5 py-1.5">
            {example}
          </li>
        ))}
      </ul>
    </div>
  )
}
