import { getSetting, onSettingsChange, useSetting, type ThemePreference } from '@/stores/settings-store'

// Orca's document theme (lib/document-theme.ts): the palette keys off `.dark` on <html>, with a
// mirrored `.light`; transitions pause for a frame so the swap does not fade piecemeal.

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function resolveDark(theme: ThemePreference): boolean {
  return theme === 'dark' || (theme === 'system' && media.matches)
}

function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement
  const dark = resolveDark(theme)
  if (root.classList.contains('dark') === dark && root.classList.contains('light') === !dark) return
  root.classList.add('theme-transition-disabled')
  root.classList.toggle('dark', dark)
  root.classList.toggle('light', !dark)
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-transition-disabled')))
}

function applyAppFont(family: string): void {
  const root = document.documentElement.style
  if (family.trim()) {
    root.setProperty('--app-font-family', `${family.trim()}, 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
  } else {
    root.removeProperty('--app-font-family')
  }
}

/** Applies the theme and IDE font settings now and whenever they or the OS scheme change. */
export function installTheme(): void {
  applyTheme(getSetting('theme'))
  applyAppFont(getSetting('appFontFamily'))
  media.addEventListener('change', () => applyTheme(getSetting('theme')))
  onSettingsChange((next, previous) => {
    if (next.theme !== previous.theme) applyTheme(next.theme)
    if (next.appFontFamily !== previous.appFontFamily) applyAppFont(next.appFontFamily)
  })
}

export function useThemePreference(): ThemePreference {
  return useSetting('theme')
}
