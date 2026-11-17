import type { ITheme } from '@xterm/xterm'
import { useDarkClass } from '@/components/editor/use-dark-class'
import { getSetting, useSetting } from '@/stores/settings-store'
import { CLASSIC_TERMINAL_THEMES } from './classic'
import { DEFAULT_TERMINAL_THEMES } from './defaults'
import { POPULAR_DARK_TERMINAL_THEMES } from './popular-dark'
import { POPULAR_LIGHT_TERMINAL_THEMES } from './popular-light'
import { mergeTerminalThemeCatalogs } from './shared'

// Orca's terminal theme catalog (src/shared/terminal-themes, MIT). Its two defaults are renamed
// "Default Dark" / "Default Light"; they are the colors terminals had before themes were picked.
// The terminal keeps one theme per app mode, so it can differ from the app's own colors.

export const DEFAULT_TERMINAL_THEME_DARK = 'Default Dark'
export const DEFAULT_TERMINAL_THEME_LIGHT = 'Default Light'

export const TERMINAL_THEME_CATALOG = mergeTerminalThemeCatalogs(
  DEFAULT_TERMINAL_THEMES,
  POPULAR_DARK_TERMINAL_THEMES,
  POPULAR_LIGHT_TERMINAL_THEMES,
  CLASSIC_TERMINAL_THEMES
)

export const TERMINAL_THEME_NAMES = Object.keys(TERMINAL_THEME_CATALOG)

/** The named theme, or the mode's default when the name is unknown (a theme dropped from the catalog). */
export function terminalTheme(name: string, dark: boolean): ITheme {
  return (
    TERMINAL_THEME_CATALOG[name] ?? TERMINAL_THEME_CATALOG[dark ? DEFAULT_TERMINAL_THEME_DARK : DEFAULT_TERMINAL_THEME_LIGHT]!
  )
}

/** Whether a theme draws dark text on a light background, by its background's luminance. */
export function isLightTerminalTheme(theme: ITheme): boolean {
  const hex = (theme.background ?? '#000000').replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.5
}

export function currentTerminalTheme(): ITheme {
  const dark = document.documentElement.classList.contains('dark')
  return terminalTheme(getSetting(dark ? 'terminalThemeDark' : 'terminalThemeLight'), dark)
}

/** The terminal theme for the app's current mode, following both the mode and the setting. */
export function useTerminalTheme(): ITheme {
  const dark = useDarkClass()
  const name = useSetting(dark ? 'terminalThemeDark' : 'terminalThemeLight')
  return terminalTheme(name, dark)
}
