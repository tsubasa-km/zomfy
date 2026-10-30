import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, CornerDownLeft } from 'lucide-react'
import { LOCAL_HOST, useStore } from '@/session-store'
import { setOnboardingOpen, useAppOverlays } from '@/stores/app-overlay-store'
import { getSetting, setSetting } from '@/stores/settings-store'
import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { openAddProjectDialog, setOrcaImportOpen, type AddProjectStep } from '@/lib/project-dialogs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AgentStep, NotificationStep, ProjectStep, ThemeStep, WslStep } from './onboarding-steps'
import { t } from '@/i18n/i18n'

// Orca's OnboardingFlow.tsx: a full-window modal with progress bars, one step at a time, Esc or a
// click outside asks before skipping. Shown once on first run; Settings › General reopens it.

type StepId = 'agent' | 'theme' | 'wsl' | 'notifications' | 'project'

const STEP_COPY: Record<StepId, { title: string; subtitle: string; tooltip: string }> = {
  agent: {
    title: t('Pick your default agent'),
    subtitle: t("Zomfy works with every chat agent. Choose the one you'll reach for most. Switch any time."),
    tooltip: t('Default Agent')
  },
  theme: { title: t('Make it feel like home'), subtitle: t('Pick the look you want to stare at for hours.'), tooltip: t('Appearance') },
  wsl: { title: t('Connect WSL'), subtitle: t('Work inside a Linux distro with its own daemon, tools and agents.'), tooltip: 'WSL' },
  notifications: { title: t('Set up notifications'), subtitle: t('Zomfy will notify you when agents are done or need help.'), tooltip: t('Notifications') },
  project: { title: t('Add your first project'), subtitle: t('Agents work in projects: a repository or folder, with a workspace per task.'), tooltip: t('Project') }
}

const IS_WINDOWS = navigator.userAgent.includes('Windows')
const IS_MAC = navigator.userAgent.includes('Mac')
const STEPS: StepId[] = IS_WINDOWS ? ['agent', 'theme', 'wsl', 'notifications', 'project'] : ['agent', 'theme', 'notifications', 'project']

function finishOnboarding(): void {
  setSetting('onboardingDone', true)
  setOnboardingOpen(false)
}

function OnboardingFlow() {
  const [index, setIndex] = useState(0)
  const [skipConfirm, setSkipConfirm] = useState(false)
  const step = STEPS[index] ?? 'agent'
  const copy = STEP_COPY[step]
  const last = index === STEPS.length - 1

  const next = useCallback(() => {
    if (last) finishOnboarding()
    else setIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }, [last])

  // The overlay sits above dialogs, so it closes before the Add Project dialog opens.
  const addProject = (step: AddProjectStep) => {
    finishOnboarding()
    openAddProjectDialog({ step })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (skipConfirm) return
      // Orca's screen-submit shortcut: Mod+Enter continues; plain Esc asks before skipping.
      if (event.key === 'Enter' && (IS_MAC ? event.metaKey : event.ctrlKey)) {
        event.preventDefault()
        next()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setSkipConfirm(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [next, skipConfirm])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/50 p-4 text-foreground backdrop-blur-[2px]"
      data-onboarding-overlay
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setSkipConfirm(true)
      }}
    >
      <section
        role="dialog"
        aria-label={t('Zomfy onboarding')}
        aria-modal="true"
        data-onboarding-modal
        className="relative flex h-[calc(100vh-2rem)] max-h-[960px] min-h-0 w-[calc(100vw-2rem)] max-w-[1100px] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
      >
        <div className="relative flex h-full min-h-0 flex-col px-6 pt-8 pb-6 sm:px-8 sm:pt-9 sm:pb-8">
          <div className="text-base font-semibold tracking-tight">Zomfy</div>

          <div className="mt-10 flex items-center gap-2">
            {STEPS.map((id, i) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      // The bars stay 4px tall; the invisible hit area makes them easy to target.
                      'relative h-1 rounded-full transition-all duration-300 outline-none before:absolute before:-inset-x-1 before:-inset-y-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                      i === index ? 'w-10 bg-foreground' : i < index ? 'w-6 bg-muted-foreground/70 hover:bg-foreground/80' : 'w-6 bg-muted-foreground/25 hover:bg-muted-foreground/45'
                    )}
                    aria-label={t('Go to onboarding step {n}: {step}', { n: i + 1, step: STEP_COPY[id].tooltip })}
                    aria-current={i === index ? 'step' : undefined}
                    onClick={() => setIndex(i)}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8} style={{ zIndex: 110 }}>
                  {STEP_COPY[id].tooltip}
                </TooltipContent>
              </Tooltip>
            ))}
            <span className="ml-3 text-xs font-medium text-muted-foreground">
              {t('{n} of {total}', { n: index + 1, total: STEPS.length })}
            </span>
          </div>

          <div className="mt-8 shrink-0">
            {index === 0 ? <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">{t('Welcome to Zomfy')}</div> : null}
            <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight text-foreground" data-onboarding-step={step}>
              {copy.title}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          </div>

          <div className={cn('mt-10 min-h-0 flex-1', step === 'agent' ? 'flex flex-col overflow-hidden' : 'scrollbar-sleek overflow-y-auto pr-1')}>
            {step === 'agent' ? <AgentStep /> : null}
            {step === 'theme' ? <ThemeStep /> : null}
            {step === 'wsl' ? <WslStep /> : null}
            {step === 'notifications' ? <NotificationStep /> : null}
            {step === 'project' ? (
              <ProjectStep
                onAddProject={addProject}
                onImportOrca={() => {
                  finishOnboarding()
                  setOrcaImportOpen(true)
                }}
              />
            ) : null}
          </div>

          <footer className="mt-6 flex flex-none items-center justify-between border-t border-border pt-5">
            {step !== 'project' ? (
              <button className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => setIndex(STEPS.length - 1)}>
                {t('Skip to project setup')}
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {index > 0 ? (
                <button
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-foreground hover:bg-muted"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="size-4" />
                  {t('Back')}
                </button>
              ) : null}
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                data-onboarding-primary
                onClick={next}
              >
                {last ? t('Finish') : t('Continue')}
                <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-primary-foreground/20 px-1.5 py-0.5 text-[10px] leading-none font-medium text-current/80">
                  <span>{IS_MAC ? '⌘' : 'Ctrl'}</span>
                  <CornerDownLeft className="size-3" />
                </span>
              </button>
            </div>
          </footer>
        </div>
      </section>
      <Dialog open={skipConfirm} onOpenChange={setSkipConfirm}>
        <DialogContent showCloseButton={false} overlayClassName="z-[120] bg-black/35" className="z-[130] sm:max-w-[360px]" data-onboarding-skip>
          <DialogHeader>
            <DialogTitle>{t('Skip onboarding?')}</DialogTitle>
            <DialogDescription>{t("It won't take long!")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={finishOnboarding}>
              {t('Skip')}
            </Button>
            <Button type="button" onClick={() => setSkipConfirm(false)}>
              {t('No, keep going')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Opens the flow once for a new user (no projects yet); someone already set up is never asked. */
export function OnboardingGate() {
  const open = useAppOverlays((s) => s.onboarding)
  const local = useStore((s) => s.hosts[LOCAL_HOST])
  const ready = local?.connection.kind === 'connected' && !!local.harness
  const hasProjects = (local?.harness?.projects.length ?? 0) > 0

  useEffect(() => {
    if (!ready || getSetting('onboardingDone')) return
    if (hasProjects) setSetting('onboardingDone', true)
    else setOnboardingOpen(true)
  }, [ready, hasProjects])

  return open ? <OnboardingFlow /> : null
}

export function installOnboardingCommands(): void {
  registerKeybindingDefinitions([
    { id: 'onboarding.open', title: 'Run Setup Again', group: 'Global', keywords: ['onboarding', 'welcome', 'first run', 'setup'], defaultBindings: [] }
  ])
  registerCommandHandler('onboarding.open', () => setOnboardingOpen(true))
}
