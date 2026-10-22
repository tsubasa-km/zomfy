/** How long the highlight holds, then how long it fades. */
const HOLD_MS = 500
const FADE_MS = 600
/** A view opened by navigation can take a few frames to mount. */
const FIND_TIMEOUT_MS = 1000

function visible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * Outlines what `selector` finds once it is on screen, so the eye lands where a jump went. An
 * overlay that follows the element: the target's own children (xterm canvases) cannot cover it.
 */
export function flashWhenShown(selector: string, { afterMs = 0, pick }: { afterMs?: number; pick?: (el: Element) => Element | null } = {}): void {
  const started = performance.now()
  const find = () => {
    const found = [...document.querySelectorAll(selector)].map((el) => (pick ? pick(el) : el)).find((el) => el && visible(el))
    if (found) window.setTimeout(() => flash(found), afterMs)
    else if (performance.now() - started < FIND_TIMEOUT_MS) requestAnimationFrame(find)
  }
  requestAnimationFrame(find)
}

function flash(target: Element): void {
  const overlay = document.createElement('div')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.dataset.mentionFlash = ''
  Object.assign(overlay.style, {
    position: 'fixed',
    zIndex: '60',
    pointerEvents: 'none',
    borderRadius: '8px',
    boxShadow: '0 0 0 2px var(--mention-foreground)',
    background: 'color-mix(in srgb, var(--mention-foreground) 10%, transparent)',
    transition: `opacity ${FADE_MS}ms ease-out`
  })
  document.body.append(overlay)
  const start = performance.now()
  const follow = () => {
    if (!overlay.isConnected) return
    const rect = target.getBoundingClientRect()
    Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    if (performance.now() - start < HOLD_MS + FADE_MS) requestAnimationFrame(follow)
  }
  follow()
  window.setTimeout(() => (overlay.style.opacity = '0'), HOLD_MS)
  window.setTimeout(() => overlay.remove(), HOLD_MS + FADE_MS + 50)
}
