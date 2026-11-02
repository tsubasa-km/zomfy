import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, MousePointerClick } from 'lucide-react'
import { LOCAL_HOST, setDashboardOpen, useStore } from '@/session-store'
import { getAppOverlays, setTourOpen, useAppOverlays } from '@/stores/app-overlay-store'
import { getSetting, setSetting } from '@/stores/settings-store'
import { setTasks } from '@/stores/tasks-store'
import { openWorkflows } from '@/stores/workflows-store'
import { setAutomationsPageOpen } from '@/stores/automation-store'
import { setBoardOpen } from '@/stores/sidebar-store'
import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { cn } from '@/lib/utils'
import { TOUR_STEPS } from './tour-steps'
import { t } from '@/i18n/i18n'

// A guided tour over the live window: one part at a time is lit, the rest dimmed, with a card beside
// it. Shown once after setup; the command palette and Settings › General start it again.

const PAD = 6
const GAP = 12
const CARD_WIDTH = 340
const EDGE = 12
/** How long a stop waits for its part to appear (a page closing, a panel laying out). */
const FIND_MS = 600

type Rect = { left: number; top: number; width: number; height: number }

/** Pages that cover the workspace view close, so the tour shows the window people work in. */
export function startTour(): void {
  setTasks({ open: false })
  openWorkflows(null)
  setAutomationsPageOpen(false)
  setDashboardOpen(false)
  setBoardOpen(false)
  setTourOpen(true)
}

function endTour(): void {
  setSetting('tourDone', true)
  setTourOpen(false)
}

function visibleMatch(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return el
  }
  return null
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  const left = Math.max(EDGE / 2, r.left - PAD)
  const top = Math.max(EDGE / 2, r.top - PAD)
  return {
    left,
    top,
    width: Math.min(window.innerWidth - EDGE / 2, r.right + PAD) - left,
    height: Math.min(window.innerHeight - EDGE / 2, r.bottom + PAD) - top
  }
}

const same = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)

/** Beside the lit part where there is room (right, left, below, above); inside it when it fills the window. */
function cardPosition(target: Rect | null, cardHeight: number): { left: number; top: number } {
  const W = window.innerWidth
  const H = window.innerHeight
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), W - CARD_WIDTH - EDGE)
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), H - cardHeight - EDGE)
  if (!target) return { left: (W - CARD_WIDTH) / 2, top: clampY((H - cardHeight) / 2) }
  const right = target.left + target.width
  const bottom = target.top + target.height
  if (W - right - GAP >= CARD_WIDTH + EDGE) return { left: right + GAP, top: clampY(target.top) }
  if (target.left - GAP >= CARD_WIDTH + EDGE) return { left: target.left - GAP - CARD_WIDTH, top: clampY(target.top) }
  if (H - bottom - GAP >= cardHeight + EDGE) return { left: clampX(target.left), top: bottom + GAP }
  if (target.top - GAP >= cardHeight + EDGE) return { left: clampX(target.left), top: target.top - GAP - cardHeight }
  return { left: clampX(target.left + (target.width - CARD_WIDTH) / 2), top: clampY(target.top + (target.height - cardHeight) / 2) }
}

/** The first selector with a visible match, in the order given. */
function pick(target: string | string[]): HTMLElement | null {
  for (const selector of Array.isArray(target) ? target : [target]) {
    const el = visibleMatch(selector)
    if (el) return el
  }
  return null
}

/** Four panes around the lit part, so it alone takes the pointer on a try-it stop. */
function Surround({ hole }: { hole: Rect }) {
  const right = hole.left + hole.width
  const bottom = hole.top + hole.height
  return (
    <>
      <div className="pointer-events-auto absolute inset-x-0 top-0" style={{ height: hole.top }} />
      <div className="pointer-events-auto absolute inset-x-0 bottom-0" style={{ top: bottom }} />
      <div className="pointer-events-auto absolute left-0" style={{ top: hole.top, height: hole.height, width: hole.left }} />
      <div className="pointer-events-auto absolute right-0" style={{ top: hole.top, height: hole.height, left: right }} />
    </>
  )
}

const DONE_PAUSE_MS = 700

function GuidedTour() {
  const [index, setIndex] = useState(0)
  // Which way the person is going, so an optional stop with nothing to show is passed in that direction.
  const direction = useRef<1 | -1>(1)
  const [target, setTarget] = useState<Rect | null>(null)
  const [searching, setSearching] = useState(true)
  // A try-it stop: the person did it (the card says so a moment, then the tour goes on), or stepped aside.
  const [done, setDone] = useState(false)
  const [aside, setAside] = useState(false)
  const element = useRef<HTMLElement | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(200)
  const step = TOUR_STEPS[index]!
  const action = step.action
  const last = index === TOUR_STEPS.length - 1

  const go = useCallback((delta: 1 | -1) => {
    direction.current = delta
    setIndex((i) => {
      const next = i + delta
      if (next >= TOUR_STEPS.length) {
        endTour()
        return i
      }
      return Math.max(0, next)
    })
  }, [])

  // Find the stop's part, then follow it as the window lays out around it. A try-it stop looks again
  // each time, since what it lights changes as the person uses it (a drawer opening, closing).
  useEffect(() => {
    setSearching(true)
    setDone(false)
    setAside(false)
    element.current = null
    if (!step.target) {
      setTarget(null)
      setSearching(false)
      return
    }
    const wanted = step.target
    const started = Date.now()
    let current: Rect | null = null
    let seen = false
    const timer = setInterval(() => {
      const kept = element.current
      const found = !step.action && kept?.isConnected ? kept : pick(wanted)
      element.current = found
      if (!found) {
        if (seen || Date.now() - started < FIND_MS) return
        clearInterval(timer)
        if (step.optional) {
          // Nothing to show here; the first stop always has its card, so going back never runs off the start.
          setIndex((i) => Math.min(TOUR_STEPS.length - 1, Math.max(0, i + direction.current)))
          return
        }
        setTarget(null)
        setSearching(false)
        return
      }
      if (!seen) found.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      seen = true
      const next = rectOf(found)
      if (!same(current, next)) {
        current = next
        setTarget(next)
      }
      setSearching(false)
    }, 100)
    return () => clearInterval(timer)
  }, [step])

  // Watches for what a try-it stop asks: a click or the pointer on the lit part, or a palette or page
  // opened and closed again.
  useEffect(() => {
    if (!action) return
    let finished = false
    let wasAside = false
    let pause: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (finished) return
      finished = true
      setDone(true)
      pause = setTimeout(() => go(1), DONE_PAUSE_MS)
    }
    const hit = (event: Event) => {
      const lit = element.current
      const node = event.target
      if (!lit || !(node instanceof Node) || !lit.contains(node)) return
      if (action.within && !(node instanceof Element && node.closest(action.within))) return
      finish()
    }
    const type = action.on === 'hover' ? 'pointerover' : action.on === 'click' ? 'click' : null
    if (type) document.addEventListener(type, hit, true)
    const timer = action.aside
      ? setInterval(() => {
          const now = action.aside!()
          if (now !== wasAside) setAside(now)
          if (wasAside && !now) finish()
          wasAside = now
        }, 150)
      : undefined
    return () => {
      if (type) document.removeEventListener(type, hit, true)
      clearInterval(timer)
      clearTimeout(pause)
    }
  }, [action, go])

  useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight
    if (height && height !== cardHeight) setCardHeight(height)
  })

  useEffect(() => {
    // Stepped aside, the keys belong to what the person opened (Esc closes the palette, not the tour).
    if (aside) return
    const onKeyDown = (event: KeyboardEvent) => {
      const keys: Record<string, () => void> = {
        Escape: endTour,
        ArrowRight: () => go(1),
        Enter: () => go(1),
        ArrowLeft: () => go(-1)
      }
      const act = keys[event.key]
      if (!act) return
      event.preventDefault()
      event.stopPropagation()
      act()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [go, aside])

  if (aside) return null
  const position = cardPosition(target, cardHeight)
  const chapterStops = TOUR_STEPS.filter((s) => s.chapter === step.chapter)
  return (
    <div className="pointer-events-none fixed inset-0 z-[90]" data-tour role="dialog" aria-modal aria-label={t('Zomfy tour')}>
      {/* Takes the clicks: the lit part is shown, not used, unless the stop asks the person to try it. */}
      {action && target ? <Surround hole={target} /> : <div className={cn('pointer-events-auto absolute inset-0', !target && 'bg-black/45')} />}
      {target && (
        <div
          aria-hidden
          data-tour-spotlight
          className="pointer-events-none absolute rounded-lg ring-2 ring-highlight transition-all duration-200 ease-out"
          style={{ ...target, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
        />
      )}
      {/* A try-it stop's part breathes, so it reads as something to use. */}
      {target && action && !done && (
        <div aria-hidden className="pointer-events-none absolute animate-pulse rounded-lg ring-4 ring-highlight/60" style={target} />
      )}
      <div
        ref={cardRef}
        data-tour-card
        data-tour-step={index}
        className={cn(
          'pointer-events-auto absolute rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl transition-[left,top,opacity] duration-200 ease-out',
          searching && 'opacity-0'
        )}
        style={{ ...position, width: CARD_WIDTH }}
      >
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium tracking-wide text-highlight uppercase">{step.chapter}</span>
          <span className="text-muted-foreground tabular-nums">
            {index + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <h2 className="mt-1.5 text-[15px] font-semibold">{step.title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>
        {action && (
          <div
            data-tour-try={done ? 'done' : 'waiting'}
            className={cn(
              'mt-3 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[13px] leading-snug',
              done ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' : 'bg-highlight/12 text-foreground'
            )}
          >
            {done ? <Check className="mt-0.5 size-3.5 shrink-0" /> : <MousePointerClick className="mt-0.5 size-3.5 shrink-0 text-highlight" />}
            <span>{done ? t('Nice, that’s it.') : action.prompt}</span>
          </div>
        )}
        {chapterStops.length > 1 && (
          <div className="mt-3 flex gap-1" aria-hidden>
            {chapterStops.map((s) => (
              <span key={s.title} className={cn('h-1 flex-1 rounded-full', s === step ? 'bg-highlight' : 'bg-muted')} />
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={endTour} data-tour-skip>
            {last ? t('Close') : t('End tour')}
          </button>
          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button
                type="button"
                aria-label={t('Back')}
                className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => go(-1)}
                data-tour-back
              >
                <ChevronLeft className="size-4" />
              </button>
            )}
            {action && !done ? (
              // The way on is doing it; this passes the stop by.
              <button
                type="button"
                className="flex h-7 items-center gap-1 rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => go(1)}
                data-tour-next
              >
                {t('Skip')}
                <ChevronRight className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                autoFocus
                className="flex h-7 items-center gap-1 rounded-md bg-highlight px-3 text-xs font-medium text-white hover:bg-highlight/90"
                onClick={() => go(1)}
                data-tour-next
              >
                {last ? t('Done') : index === 0 ? t('Start') : t('Next')}
                {!last && <ChevronRight className="size-3.5" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Starts the tour once for someone who has finished setup and has a project to look at. */
export function TourGate() {
  const open = useAppOverlays((s) => s.tour)
  const onboarding = useAppOverlays((s) => s.onboarding)
  const local = useStore((s) => s.hosts[LOCAL_HOST])
  const ready = local?.connection.kind === 'connected' && !!local.harness
  const hasProjects = (local?.harness?.projects.length ?? 0) > 0

  useEffect(() => {
    if (!ready || !hasProjects || onboarding || open || getSetting('tourDone') || !getSetting('onboardingDone')) return
    // Waits for the window to settle and for any dialog (adding the first project) to close.
    const timer = setInterval(() => {
      if (getSetting('tourDone') || getAppOverlays().onboarding) return clearInterval(timer)
      if (document.querySelector('[role="dialog"]:not([data-tour])')) return
      clearInterval(timer)
      startTour()
    }, 1500)
    return () => clearInterval(timer)
  }, [ready, hasProjects, onboarding, open])

  return open ? <GuidedTour /> : null
}

export function installTourCommands(): void {
  registerKeybindingDefinitions([
    { id: 'tour.open', title: 'Take the Tour', group: 'Global', keywords: ['tour', 'tutorial', 'guide', 'help', 'walkthrough'], defaultBindings: [] }
  ])
  registerCommandHandler('tour.open', startTour)
}
