import { allWorkspaces, useStore } from '@/session-store'
import { setOnboardingOpen, useAppOverlays } from '@/stores/app-overlay-store'
import { setSetting, useSetting } from '@/stores/settings-store'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { HideSidebarMenu } from './sidebar-nav-controls'
import { t } from '@/i18n/i18n'

// Orca's SetupGuideSidebarEntry and SetupGuideProgressRing: an "Onboarding checklist" row with a
// progress ring, shown until the core setup steps are done or the user hides it.

function useSetupProgress(): { done: number; total: number } {
  const onboardingDone = useSetting('onboardingDone')
  const notifications = useSetting('notificationsEnabled')
  const workspaceCount = useStore((s) => allWorkspaces(s).filter((w) => w.projectId !== null).length)
  const projectCount = useStore((s) => Object.values(s.hosts).reduce((n, h) => n + (h.harness?.projects.length ?? 0), 0))
  const steps = [onboardingDone, projectCount > 0, workspaceCount >= 2, notifications]
  return { done: steps.filter(Boolean).length, total: steps.length }
}

function SetupProgressRing({ done, total }: { done: number; total: number }) {
  const bounded = Math.min(Math.max(done, 0), Math.max(total, 1))
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - bounded / Math.max(total, 1))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          aria-label={t('{done} of {total} setup steps complete', { done: bounded, total })}
        >
          <svg className="size-4 -rotate-90" viewBox="0 0 20 20" aria-hidden>
            <circle cx={10} cy={10} r={radius} fill="none" stroke="currentColor" strokeWidth={2} className="opacity-25" />
            <circle
              cx={10}
              cy={10}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {`${bounded}/${total}`}
      </TooltipContent>
    </Tooltip>
  )
}

export function SetupChecklistSidebarEntry() {
  const dismissed = useSetting('setupGuideSidebarDismissed')
  const active = useAppOverlays((s) => s.onboarding)
  const hostsReady = useStore((s) => Object.values(s.hosts).some((h) => h.harness))
  const progress = useSetupProgress()
  if (dismissed || !hostsReady || progress.done >= progress.total) return null
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => setOnboardingOpen(true)}
          aria-current={active ? 'page' : undefined}
          data-sidebar-nav="setup-checklist"
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
            active
              ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
              : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
          )}
        >
          <SetupProgressRing done={progress.done} total={progress.total} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{t('Onboarding checklist')}</span>
          </span>
        </button>
      </ContextMenuTrigger>
      <HideSidebarMenu onHide={() => setSetting('setupGuideSidebarDismissed', true)} />
    </ContextMenu>
  )
}
