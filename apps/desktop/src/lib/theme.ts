// Orca's palette keys off a `.dark` class on <html>; follow the OS scheme until there is a setting.
const media = window.matchMedia('(prefers-color-scheme: dark)')

function applyScheme(): void {
  document.documentElement.classList.toggle('dark', media.matches)
}

export function installSystemTheme(): void {
  applyScheme()
  media.addEventListener('change', applyScheme)
}

export function useThemePreference(): 'system' {
  return 'system'
}
