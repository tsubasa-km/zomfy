import { isTauri } from '@tauri-apps/api/core'
import { getSetting, onSettingsChange, setSetting } from '@/stores/settings-store'

// Orca's UI zoom (shared/ui-zoom-level.ts, MIT): Chromium-style levels, 1.2× per level.
export const UI_ZOOM_STEP = 0.5
export const UI_ZOOM_MIN = -3
export const UI_ZOOM_MAX = 5

export function zoomFactor(level: number): number {
  return 1.2 ** level
}

export function zoomPercent(level: number): number {
  return Math.round(100 * zoomFactor(level))
}

export function stepZoom(direction: 'in' | 'out' | 'reset'): void {
  const current = getSetting('uiZoomLevel')
  const next = direction === 'reset' ? 0 : current + (direction === 'in' ? UI_ZOOM_STEP : -UI_ZOOM_STEP)
  setSetting('uiZoomLevel', Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, next)))
}

/** The desktop app scales the webview natively; a browser preview falls back to CSS zoom. */
async function applyZoom(level: number): Promise<void> {
  const factor = zoomFactor(level)
  document.documentElement.style.setProperty('--ui-zoom-factor', String(factor))
  if (isTauri()) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    await getCurrentWebview().setZoom(factor)
    return
  }
  // Zoom #root and shrink its box by the same factor so the scaled app still fills the window.
  const root = document.getElementById('root')
  if (!root) return
  root.style.zoom = level === 0 ? '' : String(factor)
  root.style.width = level === 0 ? '' : `calc(100vw / ${factor})`
  root.style.height = level === 0 ? '' : `calc(100vh / ${factor})`
}

export function installUiZoom(): void {
  void applyZoom(getSetting('uiZoomLevel')).catch(() => {})
  onSettingsChange((next, previous) => {
    if (next.uiZoomLevel !== previous.uiZoomLevel) void applyZoom(next.uiZoomLevel).catch(() => {})
  })
}
