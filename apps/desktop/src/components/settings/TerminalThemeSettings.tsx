import type { ITheme } from '@xterm/xterm'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDarkClass } from '@/components/editor/use-dark-class'
import {
  DEFAULT_TERMINAL_THEME_DARK,
  DEFAULT_TERMINAL_THEME_LIGHT,
  TERMINAL_THEME_CATALOG,
  TERMINAL_THEME_NAMES,
  isLightTerminalTheme,
  terminalTheme
} from '@/lib/terminal-themes'
import { setSetting, useSetting } from '@/stores/settings-store'
import { SettingsRow } from './settings-form-controls'
import { SearchableSetting } from './SettingsSection'
import { t } from '@/i18n/i18n'

// Terminal colors apart from the app's: a theme for each app mode, each picked from the catalog,
// with a sample of the theme the terminal shows right now.

const DEFAULTS = new Set([DEFAULT_TERMINAL_THEME_DARK, DEFAULT_TERMINAL_THEME_LIGHT])
const OTHERS = TERMINAL_THEME_NAMES.filter((name) => !DEFAULTS.has(name)).sort((a, b) => a.localeCompare(b))
const DARK_THEMES = OTHERS.filter((name) => !isLightTerminalTheme(TERMINAL_THEME_CATALOG[name]!))
const LIGHT_THEMES = OTHERS.filter((name) => isLightTerminalTheme(TERMINAL_THEME_CATALOG[name]!))

function themeLabel(name: string): string {
  if (name === DEFAULT_TERMINAL_THEME_DARK) return t('Default (dark)')
  if (name === DEFAULT_TERMINAL_THEME_LIGHT) return t('Default (light)')
  return name
}

/** The theme's background with its six accent colors on it. */
function ThemeSwatch({ theme }: { theme: ITheme }) {
  const accents = [theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan]
  return (
    <span
      aria-hidden
      className="flex h-4 shrink-0 items-center gap-0.5 rounded-sm px-1 ring-1 ring-border/60"
      style={{ background: theme.background }}
    >
      {accents.map((color, i) => (
        <span key={i} className="size-1.5 rounded-full" style={{ background: color }} />
      ))}
    </span>
  )
}

function ThemeOption({ name }: { name: string }) {
  return (
    <SelectItem value={name}>
      <ThemeSwatch theme={TERMINAL_THEME_CATALOG[name]!} />
      {themeLabel(name)}
    </SelectItem>
  )
}

function TerminalThemeSelect({ mode }: { mode: 'dark' | 'light' }) {
  const key = mode === 'dark' ? 'terminalThemeDark' : 'terminalThemeLight'
  const stored = useSetting(key)
  // A theme no longer in the catalog shows, and runs, as the mode's default.
  const value = TERMINAL_THEME_CATALOG[stored] ? stored : mode === 'dark' ? DEFAULT_TERMINAL_THEME_DARK : DEFAULT_TERMINAL_THEME_LIGHT
  const label = mode === 'dark' ? t('Colors in Dark Mode') : t('Colors in Light Mode')
  return (
    <Select value={value} onValueChange={(name) => setSetting(key, name)}>
      <SelectTrigger className="h-8 w-56" aria-label={label} data-terminal-theme={mode}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <ThemeOption name={mode === 'dark' ? DEFAULT_TERMINAL_THEME_DARK : DEFAULT_TERMINAL_THEME_LIGHT} />
        <ThemeOption name={mode === 'dark' ? DEFAULT_TERMINAL_THEME_LIGHT : DEFAULT_TERMINAL_THEME_DARK} />
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>{t('Dark themes')}</SelectLabel>
          {DARK_THEMES.map((name) => (
            <ThemeOption key={name} name={name} />
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>{t('Light themes')}</SelectLabel>
          {LIGHT_THEMES.map((name) => (
            <ThemeOption key={name} name={name} />
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** A few lines of shell output in the theme, as a terminal would draw them. */
function TerminalThemePreview({ theme, fontFamily }: { theme: ITheme; fontFamily: string }) {
  const ansi = [
    theme.black,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.magenta,
    theme.cyan,
    theme.white,
    theme.brightBlack,
    theme.brightRed,
    theme.brightGreen,
    theme.brightYellow,
    theme.brightBlue,
    theme.brightMagenta,
    theme.brightCyan,
    theme.brightWhite
  ]
  return (
    <div
      data-terminal-theme-preview
      className="space-y-0.5 overflow-hidden rounded-md px-3 py-2.5 text-xs leading-5 whitespace-pre ring-1 ring-border/60"
      style={{ background: theme.background, color: theme.foreground, fontFamily }}
    >
      <div>
        <span style={{ color: theme.green }}>~/project</span> <span style={{ color: theme.blue }}>main</span> ${' '}
        git status
      </div>
      <div>
        {'  '}
        <span style={{ color: theme.red }}>modified: src/app.ts</span>
      </div>
      <div>
        {'  '}
        <span style={{ color: theme.green }}>new file: src/theme.ts</span>
      </div>
      <div>
        <span style={{ color: theme.yellow }}>warning:</span> <span style={{ color: theme.magenta }}>2 files</span> changed,{' '}
        <span style={{ color: theme.cyan }}>1 staged</span>
      </div>
      <div>
        <span style={{ color: theme.brightBlack }}>#</span>{' '}
        <span style={{ background: theme.selectionBackground, color: theme.selectionForeground }}>selected text</span>{' '}
        <span style={{ background: theme.cursor, color: theme.cursorAccent }}>&nbsp;</span>
      </div>
      <div className="flex gap-1 pt-1.5">
        {ansi.map((color, i) => (
          <span key={i} className="h-2.5 flex-1 rounded-sm" style={{ background: color }} />
        ))}
      </div>
    </div>
  )
}

export function TerminalThemeSettings() {
  const dark = useDarkClass()
  const name = useSetting(dark ? 'terminalThemeDark' : 'terminalThemeLight')
  const font = useSetting('terminalFontFamily')
  const monospace = font.trim() || 'var(--font-mono), Cascadia Code, Consolas, monospace'
  return (
    <>
      <SettingsRow
        label={t('Colors in Dark Mode')}
        description={t('The terminal theme while the app is dark.')}
        keywords={['terminal', 'theme', 'color', 'colour', 'palette', 'dark', 'scheme']}
        control={<TerminalThemeSelect mode="dark" />}
      />
      <SettingsRow
        label={t('Colors in Light Mode')}
        description={t('The terminal theme while the app is light. Pick a dark theme to keep the terminal dark.')}
        keywords={['terminal', 'theme', 'color', 'colour', 'palette', 'light', 'scheme']}
        control={<TerminalThemeSelect mode="light" />}
      />
      <SearchableSetting entry={{ title: t('Terminal Colors'), keywords: ['terminal', 'theme', 'color', 'colour', 'palette', 'preview'] }} className="py-3">
        <TerminalThemePreview theme={terminalTheme(name, dark)} fontFamily={monospace} />
      </SearchableSetting>
    </>
  )
}
