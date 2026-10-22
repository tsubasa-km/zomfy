import { useCallback, useRef, useSyncExternalStore, type ReactNode } from 'react'

// In-app drag and drop on pointer events, as Orca's dnd-kit pointer sensor. Tauri's webview owns
// OS drags (terminal-file-drop.ts takes dropped file paths from it), so HTML5 drag events never
// reach the page there. Targets are found under the pointer with elementFromPoint and bubble like
// DOM events: the innermost registered element that accepts the payload wins.

export interface DragPoint {
  x: number
  y: number
}

export interface DropAt {
  point: DragPoint
  /** The element under the pointer, for targets that cover many rows. */
  hit: Element
  /** The registered target element. */
  element: HTMLElement
}

export interface DropTarget<T> {
  /** False lets the drag fall through to an outer target. */
  accepts: (payload: T) => boolean
  over?: (payload: T, at: DropAt) => void
  leave?: () => void
  drop: (payload: T, at: DropAt) => void
}

export interface PointerDragOptions<T> {
  /** Read once the drag activates, so a plain click costs nothing; null declines the drag. */
  payload: () => T | null
  preview: ReactNode
  /** Size the preview like the source and keep the grab offset (Orca's tab DragOverlay). */
  previewMatchesSource?: boolean
  activationDistance?: number
  /** Scroll the container under the pointer near its edges, as native drags do. */
  autoScroll?: boolean
  onEnd?: () => void
}

export interface PointerDragChannel<T> {
  /** Call from onPointerDown; movement past the activation distance starts the drag. */
  begin: (event: React.PointerEvent<HTMLElement>, options: PointerDragOptions<T>) => void
  /** Ref callback registering an element as a drop target for this channel. */
  useDropTarget: (target: DropTarget<T> | null) => (element: HTMLElement | null) => void
  useActive: () => T | null
}

const DEFAULT_ACTIVATION_DISTANCE = 5
const SCROLL_EDGE = 28
const SCROLL_MAX_STEP = 14
const CURSOR_PREVIEW_OFFSET = 12

interface Preview {
  node: ReactNode
  width?: number
  height?: number
  offsetX: number
  offsetY: number
}

/** One gesture at a time; the innermost source's onPointerDown runs first and wins. */
let gesture: { event: Event; abort: () => void; active: () => boolean } | null = null
let preview: Preview | null = null
let previewPoint: DragPoint = { x: 0, y: 0 }
let previewElement: HTMLElement | null = null
const previewListeners = new Set<() => void>()

function setPreview(next: Preview | null): void {
  preview = next
  for (const listener of previewListeners) listener()
}

function previewTransform(): string {
  return `translate(${previewPoint.x - (preview?.offsetX ?? 0)}px, ${previewPoint.y - (preview?.offsetY ?? 0)}px)`
}

function movePreview(point: DragPoint): void {
  previewPoint = point
  if (previewElement) previewElement.style.transform = previewTransform()
}

export function usePointerDragPreview(): (Preview & { transform: string }) | null {
  const current = useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener)
      return () => previewListeners.delete(listener)
    },
    () => preview
  )
  return current && { ...current, transform: previewTransform() }
}

export function attachPointerDragPreview(element: HTMLElement | null): void {
  previewElement = element
}

function isScrollable(element: Element, axis: 'x' | 'y'): boolean {
  const style = getComputedStyle(element)
  const overflow = axis === 'y' ? style.overflowY : style.overflowX
  if (overflow !== 'auto' && overflow !== 'scroll') return false
  return axis === 'y' ? element.scrollHeight > element.clientHeight : element.scrollWidth > element.clientWidth
}

function edgeStep(position: number, start: number, end: number): number {
  if (position < start + SCROLL_EDGE) return -Math.ceil(((start + SCROLL_EDGE - position) / SCROLL_EDGE) * SCROLL_MAX_STEP)
  if (position > end - SCROLL_EDGE) return Math.ceil(((position - (end - SCROLL_EDGE)) / SCROLL_EDGE) * SCROLL_MAX_STEP)
  return 0
}

/** Scrolls the nearest scrollable ancestors under the point; true when anything moved. */
function autoScrollAt(point: DragPoint): boolean {
  let moved = false
  const done = { x: false, y: false }
  for (let el = document.elementFromPoint(point.x, point.y); el && !(done.x && done.y); el = el.parentElement) {
    const rect = el.getBoundingClientRect()
    for (const axis of ['y', 'x'] as const) {
      if (done[axis] || !isScrollable(el, axis)) continue
      done[axis] = true
      const step = axis === 'y' ? edgeStep(point.y, rect.top, rect.bottom) : edgeStep(point.x, rect.left, rect.right)
      if (step === 0) continue
      const before = axis === 'y' ? el.scrollTop : el.scrollLeft
      if (axis === 'y') el.scrollTop += step
      else el.scrollLeft += step
      if ((axis === 'y' ? el.scrollTop : el.scrollLeft) !== before) moved = true
    }
  }
  return moved
}

/** The pointerup ending a drag still produces a click on the source; it is not one. */
function swallowNextClick(): void {
  const swallow = (click: MouseEvent) => {
    click.stopPropagation()
    click.preventDefault()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
}

/** Elements matching `selector` act as drop targets without registering (markup owned elsewhere). */
export interface DelegatedDropTarget<T> {
  selector: string
  target: DropTarget<T>
}

export function createPointerDragChannel<T>(delegates: DelegatedDropTarget<T>[] = []): PointerDragChannel<T> {
  const targets = new WeakMap<Element, { element: HTMLElement; target: { current: DropTarget<T> | null } }>()
  let active: T | null = null
  const listeners = new Set<() => void>()
  const setActive = (next: T | null) => {
    active = next
    for (const listener of listeners) listener()
  }

  function targetAt(payload: T, point: DragPoint): { target: DropTarget<T>; at: DropAt } | null {
    const hit = document.elementFromPoint(point.x, point.y)
    if (!hit) return null
    for (let el: Element | null = hit; el; el = el.parentElement) {
      const entry = targets.get(el)
      const target = entry?.target.current
      if (entry && target?.accepts(payload)) return { target, at: { point, hit, element: entry.element } }
      if (!(el instanceof HTMLElement)) continue
      for (const delegate of delegates) {
        if (el.matches(delegate.selector) && delegate.target.accepts(payload)) {
          return { target: delegate.target, at: { point, hit, element: el } }
        }
      }
    }
    return null
  }

  function begin(event: React.PointerEvent<HTMLElement>, options: PointerDragOptions<T>): void {
    if (event.button !== 0 || gesture?.event === event.nativeEvent || gesture?.active()) return
    // A press whose release never reached the window would otherwise block every later drag.
    gesture?.abort()
    const source = event.currentTarget
    const { pointerId } = event
    const start = { x: event.clientX, y: event.clientY }
    const distance = options.activationDistance ?? DEFAULT_ACTIVATION_DISTANCE
    let payload: T | null = null
    let point = start
    let current: DropTarget<T> | null = null
    let frame = 0

    const hover = () => {
      if (payload === null) return
      const found = targetAt(payload, point)
      if (found?.target !== current) current?.leave?.()
      current = found?.target ?? null
      if (found) found.target.over?.(payload, found.at)
    }
    const scrollTick = () => {
      frame = 0
      if (payload === null || !autoScrollAt(point)) return
      hover()
      frame = requestAnimationFrame(scrollTick)
    }

    const activate = () => {
      payload = options.payload()
      if (payload === null) return finish()
      try {
        source.setPointerCapture(pointerId)
      } catch {
        // The source may have left the DOM; the window listeners still see the gesture.
      }
      document.documentElement.dataset.pointerDragging = 'true'
      window.getSelection()?.removeAllRanges()
      const rect = source.getBoundingClientRect()
      setPreview(
        options.previewMatchesSource
          ? { node: options.preview, width: rect.width, height: rect.height, offsetX: start.x - rect.left, offsetY: start.y - rect.top }
          : { node: options.preview, offsetX: -CURSOR_PREVIEW_OFFSET, offsetY: -CURSOR_PREVIEW_OFFSET }
      )
      setActive(payload)
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      point = { x: e.clientX, y: e.clientY }
      if (payload === null) {
        if (Math.hypot(point.x - start.x, point.y - start.y) < distance) return
        activate()
        if (payload === null) return
      }
      e.preventDefault()
      movePreview(point)
      hover()
      if (options.autoScroll !== false && frame === 0) frame = requestAnimationFrame(scrollTick)
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (payload !== null) {
        point = { x: e.clientX, y: e.clientY }
        const found = targetAt(payload, point)
        if (found?.target !== current) current?.leave?.()
        current = found?.target ?? null
        if (found) found.target.drop(payload, found.at)
        current?.leave?.()
        current = null
        swallowNextClick()
      }
      finish()
    }
    const cancel = () => {
      current?.leave?.()
      current = null
      finish()
    }
    const onCancel = (e: PointerEvent) => e.pointerId === pointerId && cancel()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || payload === null) return
      e.preventDefault()
      e.stopPropagation()
      cancel()
      // The button is still down; its release must not click whatever it lands on.
      window.addEventListener('pointerup', swallowNextClick, { capture: true, once: true })
    }
    // A text or image inside the source could still start a native drag, which cancels pointers.
    const onNativeDrag = (e: DragEvent) => e.preventDefault()

    function finish() {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('dragstart', onNativeDrag, true)
      if (frame) cancelAnimationFrame(frame)
      gesture = null
      if (payload === null) return
      payload = null
      if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId)
      delete document.documentElement.dataset.pointerDragging
      setPreview(null)
      setActive(null)
      options.onEnd?.()
    }

    gesture = { event: event.nativeEvent, abort: finish, active: () => payload !== null }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('dragstart', onNativeDrag, true)
  }

  function useDropTarget(target: DropTarget<T> | null): (element: HTMLElement | null) => void {
    const latest = useRef(target)
    latest.current = target
    return useCallback((element: HTMLElement | null) => {
      if (element) targets.set(element, { element, target: latest })
    }, [])
  }

  function useActive(): T | null {
    return useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => active
    )
  }

  return { begin, useDropTarget, useActive }
}
